defmodule Engine.Anamnese.ContextBuilder do
  @moduledoc """
  Monta o contexto de uma rodada da Anamnese (Fase 4b): o contexto da api
  (catálogo permitido, membros elegíveis, fila de hipóteses aceitas,
  perfis atuais, instruções vigentes) mais a JANELA de eventos lida
  direto do Postgres — mesma divisão do Psicólogo (mais barato que
  trafegar o log por HTTP).

  A janela vai do fim da última rodada até agora; sem rodada anterior,
  usa uma janela inicial fixa pra não varrer o projeto inteiro na
  primeira execução.

  Desde a fundação do grafo de conhecimento (ADR 0099/0100), o contexto
  também carrega TRECHOS RELEVANTES do projeto (`rag_search`, RN-414) —
  EM COMPOSIÇÃO com a janela temporal, nunca em substituição: a janela
  continua sendo o sinal primário (interações reais do usuário), e o RAG
  só acrescenta contexto de código/docs sobre as competências do catálogo
  que a rodada ainda não cobriu. A query é montada SÓ com nomes de
  competência (lista fechada e técnica) — nunca com texto livre de
  hipótese/rationale, que poderia mencionar a PESSOA: mesma cautela da
  proibição de inferir saúde/personalidade/idade/gênero que já vale para
  o resto da Anamnese.

  A chamada é estritamente ADITIVA: `rag_search` fora do ar, erro, ou
  catálogo sem competência descoberta degrada pro comportamento ATUAL
  (só a janela temporal), sem impedir a rodada — nunca é requisito.
  """

  alias Engine.Anamnese.Triage
  alias Engine.Sessions.EngineApiClient

  # Quantos trechos do RAG entram no prompt, no máximo. PRÓPRIA (RN-150):
  # nunca reaproveita o teto de outra tool/consumidor do rag_search.
  @rag_top_k 5

  @type t :: %{
          competency_catalog: [String.t()],
          members: [map()],
          queued_hypotheses: [map()],
          current_profiles: [map()],
          instructions: [map()],
          decisions: [map()],
          window_from: DateTime.t(),
          window_to: DateTime.t(),
          events: [map()],
          total_event_count: non_neg_integer(),
          # `nil` = RAG não consultado (catálogo sem competência descoberta) OU
          # a consulta falhou — os dois casos degradam igual, pro comportamento
          # atual. `[]` = consultado com sucesso, zero hits.
          relevant_snippets: [map()] | nil,
          relevant_snippets_degraded: boolean()
        }

  @spec fetch(String.t()) :: {:ok, t()} | {:error, term()}
  def fetch(project_id) do
    case EngineApiClient.get_anamnese_context(project_id) do
      {:ok, ctx} -> {:ok, build(project_id, ctx)}
      {:error, reason} -> {:error, reason}
    end
  end

  defp build(project_id, ctx) do
    window_to = DateTime.utc_now()
    window_from = parse_window_from(Map.get(ctx, "windowFrom"), window_to)

    total =
      Engine.SessionEvents.Event.count_for_project_window(project_id, window_from, window_to)

    competency_catalog = Map.get(ctx, "competencyCatalog", [])
    current_profiles = Map.get(ctx, "currentProfiles", [])

    # Orçamento COMPARTILHADO com os trechos do RAG, não por fora dele: até
    # @rag_top_k eventos da janela deixam de caber no prompt pra abrir espaço
    # pros trechos relevantes — reservado SEMPRE, ganhe ou não resultado a
    # busca, senão o teto do prompt varia por rodada dependendo de o RAG ter
    # respondido a tempo. Trade-off aceito de propósito (ver moduledoc).
    events_budget = max(Triage.max_prompt_events() - @rag_top_k, 0)
    events = list_events(project_id, window_from, window_to, events_budget)

    {relevant_snippets, relevant_snippets_degraded} =
      fetch_relevant_snippets(project_id, competency_catalog, current_profiles)

    %{
      competency_catalog: competency_catalog,
      members: Map.get(ctx, "members", []),
      queued_hypotheses: Map.get(ctx, "queuedHypotheses", []),
      current_profiles: current_profiles,
      instructions: Map.get(ctx, "instructions", []),
      # Aprovações/negações do usuário na janela — o quarto sinal do
      # enunciado, que não existe no event log (mora em proposed_actions).
      decisions: Map.get(ctx, "decisions", []),
      window_from: window_from,
      window_to: window_to,
      events: events,
      total_event_count: total,
      relevant_snippets: relevant_snippets,
      relevant_snippets_degraded: relevant_snippets_degraded
    }
  end

  # Busca no RAG do projeto trechos sobre as competências do catálogo que a
  # rodada ainda não cobre (perfil ainda não registrado pra nenhum membro) —
  # é o "o que está sendo avaliado" desta rodada. Sem competência descoberta
  # (tudo já tem perfil, ou catálogo vazio), não há query com sinal — pula a
  # chamada em vez de gastar rede com o catálogo inteiro sempre.
  #
  # Qualquer falha (`{:error, _}`, resposta em formato inesperado) degrada
  # pro comportamento ATUAL — `nil` é lido pelo formatador do worker como
  # "sem trechos", nunca como erro que interrompe a rodada.
  defp fetch_relevant_snippets(project_id, catalog, current_profiles) do
    case query_relevancia(catalog, current_profiles) do
      "" ->
        {nil, false}

      query ->
        case EngineApiClient.rag_search(project_id, query, @rag_top_k) do
          {:ok, %{"hits" => hits} = resp} when is_list(hits) ->
            {hits, Map.get(resp, "degraded", false)}

          _ ->
            {nil, false}
        end
    end
  end

  # SÓ nomes de competência do catálogo fechado — nunca hipótese/rationale
  # (texto livre que pode falar da PESSOA). Prioriza as competências ainda
  # sem perfil registrado; se todas já têm, usa o catálogo inteiro (revisão
  # ainda é sinal válido de relevância).
  defp query_relevancia(catalog, current_profiles) do
    cobertas =
      current_profiles
      |> Enum.map(&Map.get(&1, "competency"))
      |> Enum.reject(&is_nil/1)
      |> MapSet.new()

    descobertas = Enum.reject(catalog, &MapSet.member?(cobertas, &1))
    alvo = if descobertas == [], do: catalog, else: descobertas

    Enum.join(alvo, " ")
  end

  defp parse_window_from(nil, window_to),
    do: DateTime.add(window_to, -Triage.initial_window_days() * 24 * 3600, :second)

  defp parse_window_from(iso, window_to) when is_binary(iso) do
    case DateTime.from_iso8601(iso) do
      {:ok, dt, _offset} -> dt
      _ -> parse_window_from(nil, window_to)
    end
  end

  # O teto vem do CHAMADOR (Triage.max_prompt_events/0 menos o orçamento
  # reservado pro RAG — ver build/2): a janela vai numa mensagem pinned, que o
  # ContextManager não pode compactar, então quem protege o contexto é o corte.
  defp list_events(project_id, window_from, window_to, limit) do
    project_id
    |> Engine.SessionEvents.Event.list_for_project_window(window_from, window_to, limit)
    |> Enum.map(fn event ->
      %{
        id: event.id,
        seq: event.seq,
        type: event.type,
        actor_kind: event.actor_kind,
        actor_id: event.actor_id,
        payload: event.payload,
        created_at: event.created_at
      }
    end)
  end
end
