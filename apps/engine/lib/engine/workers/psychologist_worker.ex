defmodule Engine.Workers.PsychologistWorker do
  @moduledoc """
  Psicólogo real (Fase 4b) — consumer de `session.closed`/
  `session.closed_abnormally` (qualquer causa), roteado pelo
  `Engine.Outbox.Drain`.

  Roda o `ToolLoop` UMA vez por fechamento de sessão, montando o ctx do
  mesmo jeito que `Engine.Gates.QaAgentServer` — mas sem GenServer:
  Psicólogo é one-shot e o próprio Oban já dá processo supervisionado
  com retentativa, então não há o que endereçar depois.

  **Idempotência**: pré-checa `alreadyAnalyzed` (análise current da
  sessão já existe) e curto-circuita no caminho automático, sem gastar
  nada. Um run que NUNCA conclui (limite/orçamento estourado) não grava
  linha em `psychologist_analyses` — de propósito: distingue "duplicar
  uma análise concluída" (bloqueado pelo índice parcial único) de
  "retentar uma que falhou" (permitido, inclusive pelo max_attempts do
  Oban). Reprocessamento explícito (`triggeredBy: "manual"`) sempre roda
  e supersede a anterior (sem apagar).

  **Kill pós-restart**: quem devolve um job morto em `executing` para
  `available` é o `Oban.Plugins.Lifeline` (ver `config/config.exs`) — sem
  ele o job ficaria órfão para sempre e a retentativa aqui nunca
  aconteceria.
  """

  use Oban.Worker, queue: :default, max_attempts: 5

  alias Engine.Harness.Hooks
  alias Engine.Harness.Hooks.EventLog
  alias Engine.Harness.ToolLoop
  alias Engine.Psychologist.{ContextBuilder, TerminationClassifier, Tools, Triage}
  alias Engine.Psychologist.Hooks.Termination
  alias Engine.Sessions.EngineApiClient
  alias Engine.Telemetry.Span

  @impl true
  def perform(%Oban.Job{
        args:
          %{
            "aggregate_id" => session_id,
            "payload" => %{"projectId" => project_id} = payload
          } = args
      }) do
    # Ver o comentário equivalente no SessionLifecycleWorker: o `session_id` em
    # toda linha, e a análise pendurada na trace da sessão que a originou. Aqui
    # importa mais que em qualquer outro job — a análise do Psicólogo é o
    # trabalho assíncrono mais caro do sistema, e era o mais difícil de
    # correlacionar.
    Logger.metadata(session_id: session_id)

    Span.with_session(
      args["traceparent"],
      "outbox.psychologist",
      %{"brabo.session_id" => session_id, "brabo.project_id" => project_id},
      fn -> analisar_sessao(project_id, session_id, payload) end
    )
  end

  defp analisar_sessao(project_id, session_id, payload) do
    triggered_by = Map.get(payload, "triggeredBy", "auto")

    case ContextBuilder.fetch(project_id, session_id) do
      {:ok, %{already_analyzed: true}} when triggered_by == "auto" ->
        # Já analisada — retentativa do Oban (ou reentrega do outbox) não
        # refaz o trabalho nem gasta orçamento.
        :ok

      {:ok, context} ->
        analyze(project_id, session_id, triggered_by, context)

      {:error, reason} ->
        # Contexto indisponível (api fora, sessão sumiu): PRECISA ser
        # `{:error, _}` — `:ok` marcaria o job `completed` e a análise
        # sumiria em silêncio, deixando o `max_attempts: 5` como peso
        # morto neste branch (só socorreria exceção levantada).
        #
        # Sem narrar `analysis_failed` aqui de propósito: o caminho de
        # narração é a própria api, que é justamente quem está fora.
        # Quem registra o desfecho enquanto isso é a linha do job.
        {:error, reason}
    end
  end

  defp analyze(project_id, session_id, triggered_by, context) do
    event_count = context.event_count
    tier = Triage.decide(event_count)

    # O tier decide o teto, então os eventos só são lidos DEPOIS da
    # triagem — ver ContextBuilder.
    events = ContextBuilder.recent_events(session_id, Triage.max_prompt_events(tier))

    cause =
      TerminationClassifier.classify(
        context.termination_reason,
        context.session_status
      )

    project_id
    |> build_ctx(session_id, triggered_by, tier, event_count, cause, context, events)
    |> ToolLoop.run()
    |> handle_outcome(project_id, session_id, tier)
  end

  defp handle_outcome({:halted, {"emit_hypotheses", _}, _ctx}, _project_id, _session_id, _tier),
    do: :ok

  # Qualquer outro desfecho: o modelo não conseguiu emitir um lote válido
  # dentro do teto. Narra o fracasso (nunca deixa sem desfecho) e NÃO
  # grava análise — ver moduledoc.
  defp handle_outcome(outcome, project_id, session_id, tier) do
    emit_failure(project_id, session_id, tier, reason_for(outcome))
    :ok
  end

  defp reason_for({:limit_reached, _ctx}), do: "limite de iterações"
  defp reason_for({:budget_exceeded, _ctx}), do: "orçamento excedido"

  # `{:ok, ctx}` com `:last_error` é falha de INFRAESTRUTURA (provider fora,
  # timeout, erro no corpo da resposta — ver ToolLoop), não o modelo
  # desistindo. Sem olhar `last_error` o operador recebia "encerrou sem
  # emitir hipóteses" para um provider caído, sem nada em que agir — mesma
  # armadilha já fechada no QA (`QaAgentServer`) e no Dev (`DevAgentServer`).
  defp reason_for({:ok, ctx}) do
    case Map.get(ctx, :last_error) do
      nil -> "encerrou sem emitir hipóteses"
      error -> "falha no provider: #{error}"
    end
  end

  defp reason_for(_other), do: "desfecho inesperado"

  defp emit_failure(project_id, session_id, tier, reason) do
    EngineApiClient.append_event(project_id, session_id, %{
      type: "psychologist.analysis_failed",
      actorKind: "agent",
      actorId: Triage.agent_for(tier),
      payload: %{tier: to_string(tier), reason: reason}
    })
  end

  defp build_ctx(project_id, session_id, triggered_by, tier, event_count, cause, context, events) do
    %{
      project_id: project_id,
      session_id: session_id,
      agent: Triage.agent_for(tier),
      tools: Tools.registry(),
      hooks: psychologist_hooks(),
      messages: [initial_message(cause, context, events, event_count)],
      context_window: 128_000,
      max_iterations: Triage.max_iterations(tier),
      token_budget_micros: Triage.token_budget_micros(tier),
      # Lidos pelo EmitHypotheses na hora de chamar a api.
      tier: tier,
      triggered_by: triggered_by,
      event_count: event_count,
      # A api valida `terminationAnalysis` a partir DESTA causa, não do
      # status terminal — ver TerminationClassifier.abnormal?/1.
      cause: cause
    }
  end

  # Sem `:pre_tool_use` aqui: o registry do Psicólogo tem uma tool só,
  # `emit_hypotheses`, que é `:direct` (o Psicólogo é read-only, nunca
  # propõe ação com efeito externo). O ActionPipeline registrado antes era
  # no-op permanente.
  defp psychologist_hooks do
    Hooks.new()
    |> Hooks.register(:post_tool_use, EventLog)
    |> Hooks.register(:post_tool_use, Termination)
  end

  defp initial_message(cause, context, events, event_count) do
    %{
      "role" => "user",
      "content" => """
      A sessão abaixo foi encerrada (#{TerminationClassifier.label(cause)}).
      Analise o comportamento dos agentes e produza hipóteses estruturadas.

      Cada hipótese PRECISA de evidência apontando para ids de eventos REAIS
      do log abaixo — hipótese sem evidência válida é rejeitada e você terá
      que corrigi-la. Registre tudo numa única chamada de `emit_hypotheses`.
      #{termination_instruction(cause)}

      REGRAS DE NEGÓCIO DO PROJETO:
      #{format_business_rules(context.business_rules)}

      HIPÓTESES ANTERIORES (não descartadas):
      #{format_prior_hypotheses(context.prior_hypotheses)}

      LOG DE EVENTOS DA SESSÃO:#{omission_note(events, event_count)}
      #{format_events(events)}
      """,
      :pinned => true
    }
  end

  # O corte tem que ser VISÍVEL pro modelo: ele só pode citar ids que vê, e
  # sem essa nota ele concluiria que a sessão inteira cabe no que leu.
  defp omission_note(events, event_count) do
    omitidos = event_count - length(events)

    if omitidos > 0 do
      " (só os #{length(events)} mais recentes de #{event_count};" <>
        " #{omitidos} evento(s) mais antigo(s) omitido(s) — cite apenas ids presentes abaixo)"
    else
      ""
    end
  end

  defp termination_instruction(:normal), do: ""

  defp termination_instruction(cause) do
    """

    A sessão terminou ANORMALMENTE (#{TerminationClassifier.label(cause)}) — ao menos
    uma hipótese precisa trazer `terminationAnalysis` com {causa, estadoDaSessao,
    analise}, analisando a causa e o estado da sessão no momento do término.
    """
  end

  defp format_business_rules([]), do: "(nenhuma)"

  defp format_business_rules(rules),
    do: Enum.map_join(rules, "\n", &"- #{Map.get(&1, "title", "(sem título)")}")

  defp format_prior_hypotheses([]), do: "(nenhuma)"

  defp format_prior_hypotheses(hypotheses) do
    Enum.map_join(hypotheses, "\n", fn h ->
      "- [#{Map.get(h, "agenteAlvo")}] #{Map.get(h, "hipotese")} " <>
        "(confiança #{Map.get(h, "confiancaPercent")}%)"
    end)
  end

  defp format_events([]), do: "(nenhum evento)"

  defp format_events(events) do
    Enum.map_join(events, "\n", fn e ->
      "#{e.id} | seq=#{e.seq} | #{e.type} | ator=#{e.actor_id} | #{format_payload(e.payload)}"
    end)
  end

  # Payload de `agent.response`/`tool.result` carrega turno de LLM inteiro —
  # sem corte, meia dúzia deles come a janela sozinha. O id fica intacto (é
  # o que a evidência cita); só o payload é truncado.
  defp format_payload(payload) do
    texto = inspect(payload)
    teto = Triage.max_payload_chars()

    if String.length(texto) > teto do
      String.slice(texto, 0, teto) <> "… (payload truncado)"
    else
      texto
    end
  end
end
