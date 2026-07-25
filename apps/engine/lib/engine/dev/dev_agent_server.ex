defmodule Engine.Dev.DevAgentServer do
  @moduledoc """
  Dev agent supervisionado por {project_id, agent_id} (Fase 4a). Ciclo de
  task: reivindica (claim atômico na api), monta um worktree isolado, monta o
  contexto rico da task (`Engine.Dev.ContextBuilder`) e implementa via o
  `Engine.Harness.ToolLoop` real — o modelo lê/escreve arquivos e roda a
  suite via `terminal`, TUDO escopado ao worktree (`workspace_root`). Só abre
  PR quando o modelo sinaliza `report_done` (que por sua vez só aceita depois
  de um `terminal` com exit 0 — ver `Engine.Dev.Tools.ReportDone`); qualquer
  outro desfecho (`report_blocked`, limite de iterações, orçamento de tokens
  estourado, ou o modelo parar sem sinalizar) devolve a task com diagnóstico
  (`blocked`), nunca abre PR vermelha nem entra em loop infinito. Estado
  durável em `dev_agent_states` (rehydration no boot).
  """

  use GenServer, restart: :temporary

  alias Engine.Dev.{AgentIo, ContextBuilder, Tools}
  alias Engine.Dev.Hooks.Termination
  alias Engine.Gates.Dispatcher
  alias Engine.Harness.ToolLoop
  alias Engine.Harness.Hooks
  alias Engine.Harness.Hooks.{ActionPipeline, EventLog}
  alias Engine.Sessions.EngineApiClient

  # Marca da implementação no estado durável: a reidratação sobe o server
  # certo a partir dela (ver Engine.Dev.DevRehydrator).
  @impl_tag "real"

  def start_link(
        {project_id, agent_id, module, session_id, task_budget_micros, max_gate_corrections}
      ) do
    GenServer.start_link(
      __MODULE__,
      {project_id, agent_id, module, session_id, task_budget_micros, max_gate_corrections},
      name: via(project_id, agent_id)
    )
  end

  defdelegate via(project_id, agent_id), to: AgentIo

  @doc "Dispara o ciclo de trabalho (chamado num start FRESCO, não em rehydration)."
  def work(project_id, agent_id), do: GenServer.cast(via(project_id, agent_id), :work)

  @doc """
  Devolução pro dev (Fase 4a — gates): um gate (QA/SecOps) reprovou e o dev
  corrige NO MESMO worktree/branch — distinto de `work/2`, que reivindica
  uma task NOVA. `findings` é `%{gate:, reason:, diagnosis:}`.
  """
  def correct(project_id, agent_id, findings),
    do: GenServer.cast(via(project_id, agent_id), {:correct, findings})

  # --- Callbacks ---

  @impl true
  def init({project_id, agent_id, module, session_id, task_budget_micros, max_gate_corrections}) do
    state = %{
      project_id: project_id,
      agent_id: agent_id,
      module: module,
      session_id: session_id,
      task_id: nil,
      worktree: nil,
      branch: nil,
      impl: @impl_tag,
      task_budget_micros: task_budget_micros,
      max_gate_corrections: max_gate_corrections
    }

    AgentIo.persist(state)

    {:ok, state}
  end

  @impl true
  def handle_cast(:work, state) do
    AgentIo.emit(state, "dev.started", %{agentId: state.agent_id, module: state.module})

    case AgentIo.claim_task(state) do
      {:ok, nil} ->
        AgentIo.emit(state, "dev.idle", %{agentId: state.agent_id, reason: "sem task pegável"})
        {:noreply, state}

      {:ok, task} ->
        {:noreply, run_task(state, task)}

      {:error, reason} ->
        AgentIo.emit(state, "dev.error", %{agentId: state.agent_id, reason: inspect(reason)})
        {:noreply, state}
    end
  end

  @impl true
  def handle_cast({:correct, findings}, state) do
    case ContextBuilder.fetch(state.project_id, state.session_id, state.task_id) do
      {:ok, dev_context} ->
        {:noreply, implement_correction(state, dev_context, findings)}

      {:error, reason} ->
        AgentIo.emit(state, "dev.error", %{agentId: state.agent_id, reason: inspect(reason)})
        {:noreply, state}
    end
  end

  # --- Ciclo do DevAgent ---

  defp run_task(state, task) do
    task_id = Map.get(task, "id")
    slug = "task-" <> String.slice(to_string(task_id), 0, 8)

    # task_id entra no state ANTES de montar o worktree: se a criação
    # falhar, a task já foi reivindicada (está `in_progress` na api) e
    # block_task precisa saber qual devolver — senão ela fica órfã, sem
    # dono vivo e invisível pro claim (que só pega `todo`).
    state = %{state | task_id: task_id}

    case AgentIo.worktree_manager().create(state.project_id, state.agent_id, slug) do
      {:ok, %{path: path, branch: branch}} ->
        state = %{state | worktree: path, branch: branch}
        AgentIo.persist(state)

        AgentIo.emit(state, "dev.working", %{
          agentId: state.agent_id,
          taskId: task_id,
          branch: branch
        })

        case ContextBuilder.fetch(state.project_id, state.session_id, task_id) do
          {:ok, dev_context} ->
            implement(state, dev_context)

          {:error, reason} ->
            AgentIo.block_task(state, "falha ao montar contexto da task", inspect(reason))
        end

      {:error, reason} ->
        AgentIo.emit(state, "dev.error", %{agentId: state.agent_id, reason: inspect(reason)})
        AgentIo.block_task(state, "falha ao preparar o worktree", inspect(reason))
    end
  end

  defp implement(state, %{
         task: task,
         story: story,
         business_rules_units: business_rules_units,
         task_state_units: task_state_units
       }) do
    ctx = %{
      project_id: state.project_id,
      session_id: state.session_id,
      agent: state.agent_id,
      workspace_root: state.worktree,
      tools: Tools.registry(),
      hooks: dev_hooks(),
      token_budget_micros: state.task_budget_micros,
      business_rules_units: business_rules_units,
      task_state_units: task_state_units,
      messages: [initial_message(task, story)],
      # Janela grande o bastante pra uma task inteira (vários terminals/reads)
      # não disparar compactação no meio do trabalho — o ContextManager ainda
      # roda: só não some com histórico recente por um cálculo de janela
      # pequena demais. TODO: usar a janela real do modelo resolvido quando o
      # turno de LLM devolver isso pro engine.
      context_window: 128_000
    }

    ctx
    |> ToolLoop.run()
    |> handle_outcome(state, task, story)
  end

  defp dev_hooks do
    Hooks.new()
    |> Hooks.register(:pre_tool_use, ActionPipeline)
    |> Hooks.register(:post_tool_use, EventLog)
    |> Hooks.register(:post_tool_use, Termination)
  end

  defp initial_message(task, story) do
    %{
      "role" => "user",
      "content" =>
        "Implemente a task \"#{task["title"]}\" da story \"#{story["title"]}\". " <>
          "Rode a suite de testes do projeto via `terminal` e só sinalize conclusão com " <>
          "`report_done` depois de vê-la passar (exit 0). Se não conseguir concluir, " <>
          "use `report_blocked` com o diagnóstico do que foi tentado e por que falhou.",
      :pinned => true
    }
  end

  # --- Correção pedida por um gate (mesmo worktree/branch — sem novo claim) ---

  defp implement_correction(
         state,
         %{
           task: task,
           story: story,
           business_rules_units: business_rules_units,
           task_state_units: task_state_units
         },
         findings
       ) do
    ctx = %{
      project_id: state.project_id,
      session_id: state.session_id,
      agent: state.agent_id,
      workspace_root: state.worktree,
      tools: Tools.registry(),
      hooks: dev_hooks(),
      token_budget_micros: state.task_budget_micros,
      business_rules_units: business_rules_units,
      task_state_units: task_state_units,
      messages: [initial_message(task, story), correction_message(findings)],
      context_window: 128_000
    }

    ctx
    |> ToolLoop.run()
    |> handle_correction_outcome(state, findings)
  end

  defp correction_message(findings) do
    %{
      "role" => "user",
      "content" =>
        "O gate \"#{findings.gate}\" pediu correção nesta PR (mesma branch, mesmo worktree). " <>
          "Motivo: #{findings.reason}. Diagnóstico: #{findings.diagnosis}. Corrija o " <>
          "necessário, rode a suite de novo via `terminal`, e só sinalize conclusão com " <>
          "`report_done` depois de vê-la passar (exit 0). Se ainda não conseguir, use " <>
          "`report_blocked`.",
      :pinned => true
    }
  end

  defp handle_correction_outcome(
         {:halted, {"report_done", %{summary: summary}}, _ctx},
         state,
         findings
       ) do
    # A PR já existe (mesma branch) — só commit+push, sem propose_pr de novo.
    AgentIo.propose_commit(state, summary)
    AgentIo.propose_push(state)
    trigger_gate_recheck(state, findings.gate)
    state
  end

  defp handle_correction_outcome(
         {:halted, {"report_blocked", %{reason: reason, diagnosis: diagnosis}}, _ctx},
         state,
         _findings
       ) do
    AgentIo.block_task(state, reason, diagnosis)
  end

  defp handle_correction_outcome({:limit_reached, ctx}, state, _findings) do
    AgentIo.block_task(state, "limite de iterações atingido (correção)", last_terminal_output(ctx))
  end

  defp handle_correction_outcome({:budget_exceeded, ctx}, state, _findings) do
    AgentIo.block_task(
      state,
      "orçamento de tokens excedido (correção)",
      "gasto: #{ctx.tokens_spent_micros} micro-USD (teto: #{ctx.token_budget_micros})"
    )
  end

  defp handle_correction_outcome({:ok, _ctx}, state, _findings) do
    AgentIo.block_task(state, "parou sem concluir nem reportar bloqueio (correção)", "")
  end

  defp trigger_gate_recheck(state, "qa"),
    do: :ok = Dispatcher.run_qa(state.project_id, state.task_id)

  defp trigger_gate_recheck(state, "secops"),
    do: :ok = Dispatcher.run_secops(state.project_id, state.task_id)

  defp handle_outcome({:halted, {"report_done", %{summary: summary}}, _ctx}, state, task, story) do
    AgentIo.propose_commit(state, summary)
    AgentIo.propose_push(state)
    propose_pr(state, task, story)

    _ =
      EngineApiClient.mark_task(
        state.project_id,
        state.session_id,
        state.task_id,
        "in_review",
        state.agent_id
      )

    _ =
      EngineApiClient.open_gate(state.project_id, state.session_id, state.task_id, state.agent_id)

    :ok = Dispatcher.run_qa(state.project_id, state.task_id)

    state
  end

  defp handle_outcome(
         {:halted, {"report_blocked", %{reason: reason, diagnosis: diagnosis}}, _ctx},
         state,
         _task,
         _story
       ) do
    AgentIo.block_task(state, reason, diagnosis)
  end

  defp handle_outcome({:limit_reached, ctx}, state, _task, _story) do
    AgentIo.block_task(state, "limite de iterações atingido", last_terminal_output(ctx))
  end

  defp handle_outcome({:budget_exceeded, ctx}, state, _task, _story) do
    AgentIo.block_task(
      state,
      "orçamento de tokens excedido",
      "gasto: #{ctx.tokens_spent_micros} micro-USD (teto: #{ctx.token_budget_micros})"
    )
  end

  defp handle_outcome({:ok, _ctx}, state, _task, _story) do
    AgentIo.block_task(state, "parou sem concluir nem reportar bloqueio", "")
  end

  defp last_terminal_output(ctx) do
    ctx
    |> Map.get(:messages, [])
    |> Enum.filter(&(Map.get(&1, "role") == "tool" and Map.get(&1, "name") == "terminal"))
    |> List.last()
    |> case do
      nil -> "(nenhum terminal rodado)"
      msg -> Map.get(msg, "content", "")
    end
  end

  defp propose_pr(state, task, story) do
    AgentIo.propose_pr(
      state,
      "#{story["title"]} — #{task["title"]}",
      pr_body(task, story)
    )
  end

  defp pr_body(task, story) do
    checklist =
      case Map.get(story, "dod", []) do
        [] -> "(sem DoD registrado)"
        items -> Enum.map_join(items, "\n", &"- [ ] #{&1}")
      end

    "Task: #{task["title"]}\n#{task["description"]}\n\n## Definition of Done\n#{checklist}"
  end

end
