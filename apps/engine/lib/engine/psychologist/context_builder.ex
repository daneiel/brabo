defmodule Engine.Psychologist.ContextBuilder do
  @moduledoc """
  Monta o contexto da análise do Psicólogo (Fase 4b): o contexto da api
  (`get_psychologist_context` — idempotência, status/motivo de término,
  regras de negócio do projeto, hipóteses anteriores não descartadas)
  mais o event log da sessão, lido direto do Postgres (read-only) — mais
  barato que uma ida HTTP.

  **Contagem e leitura são separadas de propósito.** `fetch/2` traz só as
  contagens (COUNT, não carrega linha), porque são elas que decidem se e
  como analisar; só depois, já sabendo o tier, o worker chama
  `recent_events/2` com o teto daquele tier. Carregar o log inteiro pra
  contar era desperdício em sessão longa — e o log inteiro nunca cabe no
  prompt de qualquer jeito (ver `Engine.Psychologist.Triage`).

  São DUAS contagens, e elas não se substituem: `event_count` é o log
  cru e dimensiona o trabalho (qual tier); `analisaveis` desconta o que
  os analistas escreveram e o provisionamento de repositório, e responde
  se há trabalho (ver `Engine.SessionEvents.Event.count_analisaveis/1`).

  **Relevância via RAG (onda de consumo do grafo).** `fetch/2` também
  consulta `EngineApiClient.rag_search/4` — o GATILHO da análise (a causa
  de término já classificada por `TerminationClassifier`, mesmo rótulo
  que vai pro prompt) vira a query. Os trechos voltam ao lado dos eventos
  recentes, NUNCA em substituição: "N mais recentes" continua vindo de
  `recent_events/2`, intocado, e os trechos entram como
  `relevant_excerpts`. A chamada é estritamente ADITIVA — qualquer
  desfecho que não seja uma lista de hits (erro, resposta inesperada)
  degrada pro comportamento ATUAL (`relevant_excerpts: []`), sem propagar
  erro: a análise do Psicólogo não pode depender do RAG estar de pé.
  `rag_degraded` tem TRÊS valores, e eles não se confundem: `nil` (RAG
  não consultado com sucesso — indisponível ou erro), `false` (consultado
  com embedding disponível) e `true` (consultado, mas caiu pra
  léxico-only) — só o último precisa aparecer como aviso no prompt.
  """

  alias Engine.Psychologist.{TerminationClassifier, Triage}
  alias Engine.Sessions.EngineApiClient

  @type t :: %{
          already_analyzed: boolean(),
          session_status: String.t(),
          termination_reason: String.t() | nil,
          business_rules: [map()],
          prior_hypotheses: [map()],
          event_count: non_neg_integer(),
          analisaveis: non_neg_integer(),
          relevant_excerpts: [map()],
          rag_degraded: boolean() | nil
        }

  @spec fetch(String.t(), String.t()) :: {:ok, t()} | {:error, term()}
  def fetch(project_id, session_id) do
    case EngineApiClient.get_psychologist_context(project_id, session_id) do
      {:ok, ctx} -> {:ok, build(ctx, project_id, session_id)}
      {:error, reason} -> {:error, reason}
    end
  end

  @doc """
  Os `limit` eventos MAIS RECENTES da sessão, em ordem de seq crescente.

  A cauda é o que importa pra análise comportamental: é onde está o estado
  da sessão no momento do término (justamente o que a seção de término
  precisa descrever). Mesmo raciocínio do `latest: true` do feed da UI.
  """
  @spec recent_events(String.t(), pos_integer()) :: [map()]
  def recent_events(session_id, limit) do
    session_id
    |> Engine.SessionEvents.Event.list_recent(limit)
    |> Enum.map(fn event ->
      %{
        id: event.id,
        seq: event.seq,
        type: event.type,
        actor_id: event.actor_id,
        payload: event.payload
      }
    end)
  end

  defp build(ctx, project_id, session_id) do
    base = %{
      already_analyzed: Map.get(ctx, "alreadyAnalyzed", false),
      session_status: Map.get(ctx, "sessionStatus", "closed"),
      termination_reason: Map.get(ctx, "terminationReason"),
      business_rules: Map.get(ctx, "businessRules", []),
      prior_hypotheses: Map.get(ctx, "priorHypotheses", []),
      event_count: Engine.SessionEvents.Event.count(session_id),
      analisaveis: Engine.SessionEvents.Event.count_analisaveis(session_id)
    }

    Map.merge(base, fetch_relevant_excerpts(project_id, base))
  end

  defp fetch_relevant_excerpts(project_id, %{
         session_status: status,
         termination_reason: reason
       }) do
    query = "sessão de agente encerrada: #{gatilho_label(reason, status)}"
    top_k = Triage.rag_top_k()

    case EngineApiClient.rag_search(project_id, query, top_k) do
      {:ok, %{"hits" => hits} = resp} when is_list(hits) ->
        %{
          relevant_excerpts: Enum.take(hits, top_k),
          rag_degraded: Map.get(resp, "degraded", false)
        }

      _falha_ou_resposta_inesperada ->
        # ADITIVO: falha do RAG (api fora, erro de rede, resposta que não
        # bate o contrato) nunca vira `{:error, _}` do fetch/2 — degrada
        # pro comportamento anterior a esta onda.
        %{relevant_excerpts: [], rag_degraded: nil}
    end
  end

  defp gatilho_label(reason, status),
    do: TerminationClassifier.label(TerminationClassifier.classify(reason, status))
end
