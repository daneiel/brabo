defmodule Engine.Gates.QaAgentServer do
  @moduledoc """
  QAAgent (Fase 4a) — um por projeto (`Engine.Gates.Registry`, chave
  `{project_id, "qa"}`). Ativado quando uma task entra em `awaiting_qa`:
  acha o worktree do dev (`Engine.Dev.DevAgentState.find_by_task_id/2`),
  roda a suite via `terminal` (ToolLoop/LLM — cruzar regra de negócio com
  teste é julgamento semântico, diferente do SecOps determinístico) e
  registra o parecer com `emit_qa_verdict` (`Engine.Gates.Tools.EmitQaVerdict`
  — só aceita aprovar com suite verde). `changes_requested` devolve pro
  `Engine.Dev.DevAgentServer.correct/3` NO MESMO worktree/branch;
  `approved` dispara o `Engine.Gates.SecOpsAgentServer`.
  """

  use GenServer, restart: :temporary

  alias Engine.Dev.{ContextBuilder, DevAgentServer, DevAgentState}
  alias Engine.Gates.{Dispatcher, QaTools}
  alias Engine.Gates.Hooks.Termination
  alias Engine.Harness.ToolLoop
  alias Engine.Harness.Hooks
  alias Engine.Harness.Hooks.{ActionPipeline, EventLog}
  alias Engine.Sessions.EngineApiClient

  def start_link(project_id) do
    GenServer.start_link(__MODULE__, project_id, name: via(project_id))
  end

  def via(project_id), do: {:via, Registry, {Engine.Gates.Registry, {project_id, "qa"}}}

  @doc "Dispara a revisão de QA pra `task_id`."
  def run(project_id, task_id), do: GenServer.cast(via(project_id), {:run, task_id})

  @impl true
  def init(project_id), do: {:ok, %{project_id: project_id}}

  @impl true
  def handle_cast({:run, task_id}, state) do
    case DevAgentState.find_by_task_id(state.project_id, task_id) do
      nil -> :ok
      dev_state -> run_qa(state.project_id, dev_state, task_id)
    end

    {:noreply, state}
  end

  defp run_qa(project_id, dev_state, task_id) do
    session_id = dev_state.session_id

    case ContextBuilder.fetch(project_id, session_id, task_id) do
      {:ok, dev_context} ->
        project_id
        |> build_ctx(session_id, dev_state.worktree_path, dev_context)
        |> ToolLoop.run()
        |> handle_outcome(project_id, dev_state, task_id)

      {:error, _reason} ->
        :ok
    end
  end

  defp build_ctx(project_id, session_id, worktree_path, %{
         task: task,
         story: story,
         business_rules_units: business_rules_units,
         task_state_units: task_state_units
       }) do
    %{
      project_id: project_id,
      session_id: session_id,
      agent: "qa",
      workspace_root: worktree_path,
      tools: QaTools.registry(),
      hooks: qa_hooks(),
      business_rules_units: business_rules_units,
      task_state_units: task_state_units,
      messages: [initial_message(task, story)],
      context_window: 128_000
    }
  end

  defp qa_hooks do
    Hooks.new()
    |> Hooks.register(:pre_tool_use, ActionPipeline)
    |> Hooks.register(:post_tool_use, EventLog)
    |> Hooks.register(:post_tool_use, Termination)
  end

  defp initial_message(task, story) do
    %{
      "role" => "user",
      "content" =>
        "Revise a implementação da task \"#{task["title"]}\" da story \"#{story["title"]}\". " <>
          "Rode a suite de testes do projeto via `terminal`. Monte a matriz de cobertura " <>
          "cruzando os requisitos/regras da story com os testes que encontrar via `read_file`/" <>
          "`search_workspace`. Registre o parecer com `emit_qa_verdict` — só aprove com a " <>
          "suite verde (exit 0).",
      :pinned => true
    }
  end

  defp handle_outcome(
         {:halted, {"emit_qa_verdict", verdict}, _ctx},
         project_id,
         dev_state,
         task_id
       ) do
    emit_verdict_artifact(project_id, dev_state.session_id, task_id, verdict)
    apply_verdict(project_id, dev_state, task_id, verdict.veredito, verdict.resumo, verdict.itens)
  end

  defp handle_outcome(_other, project_id, dev_state, task_id) do
    # Limite de iterações ou o modelo parou sem sinalizar — nunca deixa a
    # task presa em awaiting_qa sem desfecho: trata como changes_requested
    # com diagnóstico genérico, devolvendo pro dev.
    emit(project_id, dev_state.session_id, "dev.error", %{
      agentId: "qa",
      reason: "QA não concluiu o parecer"
    })

    apply_verdict(
      project_id,
      dev_state,
      task_id,
      "changes_requested",
      "QA não conseguiu concluir a análise (limite de iterações)",
      ["revisão manual necessária"]
    )
  end

  defp apply_verdict(project_id, dev_state, task_id, veredito, resumo, itens) do
    result =
      EngineApiClient.record_gate_verdict(
        project_id,
        dev_state.session_id,
        task_id,
        "qa",
        veredito,
        resumo,
        itens,
        dev_state.max_gate_corrections
      )

    case result do
      {:ok, %{"nextAction" => "correct"}} ->
        DevAgentServer.correct(project_id, dev_state.agent_id, %{
          gate: "qa",
          reason: resumo,
          diagnosis: Enum.join(itens, "; ")
        })

      {:ok, %{"nextAction" => "run_secops"}} ->
        :ok = Dispatcher.run_secops(project_id, task_id)

      _ ->
        :ok
    end
  end

  defp emit_verdict_artifact(project_id, session_id, task_id, verdict) do
    emit(project_id, session_id, "artifact.qa_verdict", %{
      taskId: task_id,
      veredito: verdict.veredito,
      resumo: verdict.resumo,
      itens: verdict.itens,
      coverageMatrix: verdict.coverage_matrix
    })
  end

  defp emit(project_id, session_id, type, payload) do
    Engine.Sessions.LiveBroadcast.event_appended(session_id, type, "qa", payload)

    EngineApiClient.append_event(project_id, session_id, %{
      type: type,
      actorKind: "agent",
      actorId: "qa",
      payload: payload
    })
  end
end
