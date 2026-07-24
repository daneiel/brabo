defmodule Engine.Workers.AnamneseWorker do
  @moduledoc """
  Uma rodada da Anamnese pra UM projeto (Fase 4b) — enfileirado pelo
  `AnamneseSchedulerWorker` (tick periódico) ou manualmente.

  Analisa a janela do event log desde a última rodada (interações do
  usuário: linguagem, correções nos agentes, o que aprova/nega, nível das
  perguntas), mantém o `proficiency_profile` por usuário+competência e,
  quando o perfil sugere um ajuste com valor, propõe um
  `instruction_patch`.

  **Pula sem gastar nada** quando não há material novo (ver
  `Engine.Anamnese.Triage.should_run?/2`) — mas hipótese aceita na fila
  SEMPRE força a rodada, senão o loop fechado do Psicólogo nunca
  completaria. Rodada que não conclui não grava `anamnese_runs`, então a
  janela é reprocessada na próxima (mesma disciplina do Psicólogo).
  """

  use Oban.Worker, queue: :default, max_attempts: 3

  alias Engine.Anamnese.{ContextBuilder, Tools, Triage}
  alias Engine.Anamnese.Hooks.Termination
  alias Engine.Harness.Hooks
  alias Engine.Harness.Hooks.{ActionPipeline, EventLog}
  alias Engine.Harness.ToolLoop
  alias Engine.Sessions.EngineApiClient

  @impl true
  def perform(%Oban.Job{args: %{"project_id" => project_id} = args}) do
    session_id = Map.get(args, "session_id")

    case ContextBuilder.fetch(project_id) do
      {:ok, context} -> maybe_analyze(project_id, session_id, context)
      # Contexto indisponível: deixa o Oban retentar em vez de gravar
      # rodada pela metade.
      {:error, _reason} -> :ok
    end
  end

  # Sem sessão pra atribuir eventos/custo, a rodada não tem onde narrar —
  # o scheduler escolhe a sessão; se não houver nenhuma no projeto, não
  # há nada a analisar mesmo.
  defp maybe_analyze(_project_id, nil, _context), do: :ok

  defp maybe_analyze(project_id, session_id, context) do
    event_count = length(context.events)
    queued_count = length(context.queued_hypotheses)

    if Triage.should_run?(event_count, queued_count) do
      analyze(project_id, session_id, context, event_count)
    else
      :ok
    end
  end

  defp analyze(project_id, session_id, context, event_count) do
    project_id
    |> build_ctx(session_id, context, event_count)
    |> ToolLoop.run()
    |> handle_outcome(project_id, session_id)
  end

  defp handle_outcome({:halted, {"emit_proficiency", _}, _ctx}, _project_id, _session_id),
    do: :ok

  defp handle_outcome(outcome, project_id, session_id) do
    emit_failure(project_id, session_id, reason_for(outcome))
    :ok
  end

  defp reason_for({:limit_reached, _ctx}), do: "limite de iterações"
  defp reason_for({:budget_exceeded, _ctx}), do: "orçamento excedido"
  defp reason_for({:ok, _ctx}), do: "encerrou sem emitir perfis"
  defp reason_for(_other), do: "desfecho inesperado"

  defp emit_failure(project_id, session_id, reason) do
    EngineApiClient.append_event(project_id, session_id, %{
      type: "anamnese.run_failed",
      actorKind: "agent",
      actorId: Triage.agent(),
      payload: %{reason: reason}
    })
  end

  defp build_ctx(project_id, session_id, context, event_count) do
    %{
      project_id: project_id,
      session_id: session_id,
      agent: Triage.agent(),
      tools: Tools.registry(),
      hooks: anamnese_hooks(),
      messages: [initial_message(context)],
      context_window: 128_000,
      max_iterations: Triage.max_iterations(),
      token_budget_micros: Triage.token_budget_micros(),
      # Lidos pelas tools na hora de chamar a api.
      window_from: context.window_from,
      window_to: context.window_to,
      event_count: event_count,
      queued_ids: Enum.map(context.queued_hypotheses, & &1["queueId"])
    }
  end

  defp anamnese_hooks do
    Hooks.new()
    |> Hooks.register(:pre_tool_use, ActionPipeline)
    |> Hooks.register(:post_tool_use, EventLog)
    |> Hooks.register(:post_tool_use, Termination)
  end

  defp initial_message(context) do
    %{
      "role" => "user",
      "content" => """
      Analise a janela do log abaixo e mantenha o perfil de proficiência dos
      membros deste projeto. Observe as INTERAÇÕES DO USUÁRIO: a linguagem que
      usa, as correções que faz nos agentes, o que aprova ou nega, e o nível das
      perguntas que faz.

      REGRAS INEGOCIÁVEIS:
      - Só competências do catálogo abaixo. NUNCA infira saúde, traços de
        personalidade, idade, gênero ou qualquer característica pessoal — perfis
        com competência fora do catálogo são rejeitados.
      - Toda entrada precisa de evidência apontando para ids de eventos REAIS
        da janela, e de um `rationale` explicando o porquê do nível.
      - Feche a rodada com UMA chamada de `emit_proficiency`.
      #{queued_instruction(context.queued_hypotheses)}

      CATÁLOGO DE COMPETÊNCIAS PERMITIDAS:
      #{format_list(context.competency_catalog)}

      MEMBROS ELEGÍVEIS:
      #{format_members(context.members)}

      PERFIS ATUAIS (revise, não duplique):
      #{format_profiles(context.current_profiles)}

      #{format_instructions(context.instructions)}

      JANELA DO LOG (#{DateTime.to_iso8601(context.window_from)} → #{DateTime.to_iso8601(context.window_to)}):
      #{format_events(context.events)}
      """,
      :pinned => true
    }
  end

  defp queued_instruction([]), do: ""

  defp queued_instruction(queued) do
    """

    HIPÓTESES ACEITAS PELO USUÁRIO (input PRIORIZADO — trate como sinal forte):
    #{Enum.map_join(queued, "\n", &format_queued/1)}

    Se alguma delas sugerir um ajuste com valor real no arquivo de instrução do
    agente alvo, chame `propose_instruction_patch` ANTES de fechar a rodada,
    passando o `hypothesisId` correspondente.
    """
  end

  defp format_queued(q) do
    "- [#{q["agenteAlvo"]}] (#{q["hypothesisId"]}) #{q["hipotese"]} — sugestão: #{q["sugestao"]} (confiança #{q["confiancaPercent"]}%)"
  end

  defp format_list([]), do: "(nenhuma)"
  defp format_list(items), do: Enum.map_join(items, "\n", &"- #{&1}")

  defp format_members([]), do: "(nenhum membro elegível)"

  defp format_members(members) do
    Enum.map_join(members, "\n", fn m ->
      "- #{m["userId"]} | #{m["name"] || m["email"]} | papel=#{m["role"]}"
    end)
  end

  defp format_profiles([]), do: "(nenhum ainda)"

  defp format_profiles(profiles) do
    Enum.map_join(profiles, "\n", fn p ->
      "- #{p["userId"]} | #{p["competency"]} = #{p["level"]} (#{p["rationale"]})"
    end)
  end

  defp format_instructions([]), do: ""

  defp format_instructions(instructions) do
    """
    INSTRUÇÕES VIGENTES DOS AGENTES ALVO:
    #{Enum.map_join(instructions, "\n\n", fn i -> "### #{i["agent"]} (v#{i["version"]})\n#{i["content"]}" end)}
    """
  end

  defp format_events([]), do: "(nenhum evento na janela)"

  defp format_events(events) do
    Enum.map_join(events, "\n", fn e ->
      "#{e.id} | #{e.type} | #{e.actor_kind}:#{e.actor_id} | #{inspect(e.payload)}"
    end)
  end
end
