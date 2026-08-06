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
  """

  alias Engine.Sessions.EngineApiClient

  @type t :: %{
          already_analyzed: boolean(),
          session_status: String.t(),
          termination_reason: String.t() | nil,
          business_rules: [map()],
          prior_hypotheses: [map()],
          event_count: non_neg_integer(),
          analisaveis: non_neg_integer()
        }

  @spec fetch(String.t(), String.t()) :: {:ok, t()} | {:error, term()}
  def fetch(project_id, session_id) do
    case EngineApiClient.get_psychologist_context(project_id, session_id) do
      {:ok, ctx} -> {:ok, build(ctx, session_id)}
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

  defp build(ctx, session_id) do
    %{
      already_analyzed: Map.get(ctx, "alreadyAnalyzed", false),
      session_status: Map.get(ctx, "sessionStatus", "closed"),
      termination_reason: Map.get(ctx, "terminationReason"),
      business_rules: Map.get(ctx, "businessRules", []),
      prior_hypotheses: Map.get(ctx, "priorHypotheses", []),
      event_count: Engine.SessionEvents.Event.count(session_id),
      analisaveis: Engine.SessionEvents.Event.count_analisaveis(session_id)
    }
  end
end
