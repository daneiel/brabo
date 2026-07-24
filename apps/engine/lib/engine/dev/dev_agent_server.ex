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

  alias Engine.Dev.{ContextBuilder, DevAgentState, Tools}
  alias Engine.Dev.Hooks.Termination
  alias Engine.Harness.ToolLoop
  alias Engine.Harness.Hooks
  alias Engine.Harness.Hooks.{ActionPipeline, EventLog}
  alias Engine.Sessions.EngineApiClient

  # WorktreeManager trocável em teste (sem git/banco de repo real).
  defp worktree_manager,
    do: Application.get_env(:engine, :worktree_manager, Engine.Dev.WorktreeManager)

  def start_link({project_id, agent_id, module, session_id, task_budget_micros}) do
    GenServer.start_link(
      __MODULE__,
      {project_id, agent_id, module, session_id, task_budget_micros},
      name: via(project_id, agent_id)
    )
  end

  def via(project_id, agent_id),
    do: {:via, Registry, {Engine.Dev.Registry, {project_id, agent_id}}}

  @doc "Dispara o ciclo de trabalho (chamado num start FRESCO, não em rehydration)."
  def work(project_id, agent_id), do: GenServer.cast(via(project_id, agent_id), :work)

  # --- Callbacks ---

  @impl true
  def init({project_id, agent_id, module, session_id, task_budget_micros}) do
    DevAgentState.upsert!(%{
      project_id: project_id,
      agent_id: agent_id,
      module: module,
      session_id: session_id,
      status: "working",
      task_budget_micros: task_budget_micros
    })

    {:ok,
     %{
       project_id: project_id,
       agent_id: agent_id,
       module: module,
       session_id: session_id,
       task_id: nil,
       worktree: nil,
       branch: nil,
       task_budget_micros: task_budget_micros
     }}
  end

  @impl true
  def handle_cast(:work, state) do
    emit(state, "dev.started", %{agentId: state.agent_id, module: state.module})

    case EngineApiClient.claim_task(
           state.project_id,
           state.session_id,
           state.module,
           state.agent_id
         ) do
      {:ok, nil} ->
        emit(state, "dev.idle", %{agentId: state.agent_id, reason: "sem task pegável"})
        {:noreply, state}

      {:ok, task} ->
        {:noreply, run_task(state, task)}

      {:error, reason} ->
        emit(state, "dev.error", %{agentId: state.agent_id, reason: inspect(reason)})
        {:noreply, state}
    end
  end

  # --- Ciclo do DevAgent ---

  defp run_task(state, task) do
    task_id = Map.get(task, "id")
    slug = "task-" <> String.slice(to_string(task_id), 0, 8)

    case worktree_manager().create(state.project_id, state.agent_id, slug) do
      {:ok, %{path: path, branch: branch}} ->
        state = %{state | task_id: task_id, worktree: path, branch: branch}
        persist(state)

        emit(state, "dev.working", %{
          agentId: state.agent_id,
          taskId: task_id,
          branch: branch
        })

        case ContextBuilder.fetch(state.project_id, state.session_id, task_id) do
          {:ok, dev_context} ->
            implement(state, dev_context)

          {:error, reason} ->
            block_task(state, "falha ao montar contexto da task", inspect(reason))
        end

      {:error, reason} ->
        emit(state, "dev.error", %{agentId: state.agent_id, reason: inspect(reason)})
        state
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

  defp handle_outcome({:halted, {"report_done", %{summary: summary}}, _ctx}, state, task, story) do
    propose_commit(state, summary)
    propose_push(state)
    propose_pr(state, task, story)

    _ =
      EngineApiClient.mark_task(
        state.project_id,
        state.session_id,
        state.task_id,
        "in_review",
        state.agent_id
      )

    state
  end

  defp handle_outcome(
         {:halted, {"report_blocked", %{reason: reason, diagnosis: diagnosis}}, _ctx},
         state,
         _task,
         _story
       ) do
    block_task(state, reason, diagnosis)
  end

  defp handle_outcome({:limit_reached, ctx}, state, _task, _story) do
    block_task(state, "limite de iterações atingido", last_terminal_output(ctx))
  end

  defp handle_outcome({:budget_exceeded, ctx}, state, _task, _story) do
    block_task(
      state,
      "orçamento de tokens excedido",
      "gasto: #{ctx.tokens_spent_micros} micro-USD (teto: #{ctx.token_budget_micros})"
    )
  end

  defp handle_outcome({:ok, _ctx}, state, _task, _story) do
    block_task(state, "parou sem concluir nem reportar bloqueio", "")
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

  defp block_task(state, reason, diagnosis) do
    emit(state, "dev.blocked", %{
      agentId: state.agent_id,
      taskId: state.task_id,
      reason: reason,
      diagnosis: diagnosis
    })

    _ =
      EngineApiClient.mark_task_blocked(
        state.project_id,
        state.session_id,
        state.task_id,
        reason,
        diagnosis,
        state.agent_id
      )

    state
  end

  defp propose_commit(state, summary) do
    message = if summary == "", do: "#{state.agent_id}: #{state.task_id}", else: summary

    propose(state, "git_commit", %{
      worktree: state.worktree,
      branch: state.branch,
      message: message,
      author: "#{state.agent_id}[bot]",
      authorEmail: "#{state.agent_id}-bot@brabo.dev",
      coAuthor: "Brabo User <user@brabo.dev>"
    })
  end

  defp propose_push(state) do
    propose(state, "git_push", %{worktree: state.worktree, branch: state.branch})
  end

  defp propose_pr(state, task, story) do
    propose(state, "pr_open", %{
      sourceBranch: state.branch,
      title: "#{story["title"]} — #{task["title"]}",
      body: pr_body(task, story),
      storyTaskId: state.task_id
    })
  end

  defp pr_body(task, story) do
    checklist =
      case Map.get(story, "dod", []) do
        [] -> "(sem DoD registrado)"
        items -> Enum.map_join(items, "\n", &"- [ ] #{&1}")
      end

    "Task: #{task["title"]}\n#{task["description"]}\n\n## Definition of Done\n#{checklist}"
  end

  defp propose(state, type, payload) do
    actor = %{kind: "agent", id: state.agent_id}

    case EngineApiClient.propose_action(state.project_id, state.session_id, type, actor, payload) do
      {:ok, _action} -> :ok
      {:error, reason} -> emit(state, "dev.error", %{action: type, reason: inspect(reason)})
    end
  end

  # --- Helpers ---

  defp persist(state) do
    DevAgentState.upsert!(%{
      project_id: state.project_id,
      agent_id: state.agent_id,
      module: state.module,
      session_id: state.session_id,
      task_id: state.task_id,
      worktree_path: state.worktree,
      status: "working",
      task_budget_micros: state.task_budget_micros
    })
  end

  defp emit(state, type, payload) do
    EngineApiClient.append_event(state.project_id, state.session_id, %{
      type: type,
      actorKind: "agent",
      actorId: state.agent_id,
      payload: payload
    })
  end
end
