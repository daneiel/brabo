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
  """

  use Oban.Worker, queue: :default, max_attempts: 5

  alias Engine.Harness.Hooks
  alias Engine.Harness.Hooks.{ActionPipeline, EventLog}
  alias Engine.Harness.ToolLoop
  alias Engine.Psychologist.{ContextBuilder, TerminationClassifier, Tools, Triage}
  alias Engine.Psychologist.Hooks.Termination
  alias Engine.Sessions.EngineApiClient

  @impl true
  def perform(%Oban.Job{
        args: %{
          "aggregate_id" => session_id,
          "payload" => %{"projectId" => project_id} = payload
        }
      }) do
    triggered_by = Map.get(payload, "triggeredBy", "auto")

    case ContextBuilder.fetch(project_id, session_id) do
      {:ok, %{already_analyzed: true}} when triggered_by == "auto" ->
        # Já analisada — retentativa do Oban (ou reentrega do outbox) não
        # refaz o trabalho nem gasta orçamento.
        :ok

      {:ok, context} ->
        analyze(project_id, session_id, triggered_by, context)

      {:error, _reason} ->
        # Contexto indisponível (api fora, sessão sumiu): deixa o Oban
        # retentar em vez de gravar uma análise pela metade.
        :ok
    end
  end

  defp analyze(project_id, session_id, triggered_by, context) do
    event_count = length(context.events)
    tier = Triage.decide(event_count)

    cause =
      TerminationClassifier.classify(
        context.termination_reason,
        context.session_status
      )

    project_id
    |> build_ctx(session_id, triggered_by, tier, event_count, cause, context)
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
  defp reason_for({:ok, _ctx}), do: "encerrou sem emitir hipóteses"
  defp reason_for(_other), do: "desfecho inesperado"

  defp emit_failure(project_id, session_id, tier, reason) do
    EngineApiClient.append_event(project_id, session_id, %{
      type: "psychologist.analysis_failed",
      actorKind: "agent",
      actorId: Triage.agent_for(tier),
      payload: %{tier: to_string(tier), reason: reason}
    })
  end

  defp build_ctx(project_id, session_id, triggered_by, tier, event_count, cause, context) do
    %{
      project_id: project_id,
      session_id: session_id,
      agent: Triage.agent_for(tier),
      tools: Tools.registry(),
      hooks: psychologist_hooks(),
      messages: [initial_message(cause, context)],
      context_window: 128_000,
      max_iterations: Triage.max_iterations(tier),
      token_budget_micros: Triage.token_budget_micros(tier),
      # Lidos pelo EmitHypotheses na hora de chamar a api.
      tier: tier,
      triggered_by: triggered_by,
      event_count: event_count
    }
  end

  defp psychologist_hooks do
    Hooks.new()
    |> Hooks.register(:pre_tool_use, ActionPipeline)
    |> Hooks.register(:post_tool_use, EventLog)
    |> Hooks.register(:post_tool_use, Termination)
  end

  defp initial_message(cause, context) do
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

      LOG DE EVENTOS DA SESSÃO:
      #{format_events(context.events)}
      """,
      :pinned => true
    }
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
      "#{e.id} | seq=#{e.seq} | #{e.type} | ator=#{e.actor_id} | #{inspect(e.payload)}"
    end)
  end
end
