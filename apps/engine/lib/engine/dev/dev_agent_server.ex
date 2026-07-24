defmodule Engine.Dev.DevAgentServer do
  @moduledoc """
  Dev agent supervisionado por {project_id, agent_id} (Fase 4a). Nesta sessão
  roda o **NoopDevAgent** (sem LLM): pega uma task, cria um worktree, escreve um
  arquivo trivial, e propõe commit → push → pr_open pelo pipeline de
  proposed_actions (autonomia auto_approve executa). Estado durável em
  `dev_agent_states` (rehydration no boot). Os devs REAIS trocam a lógica de
  `:work` por um harness com LLM — a infra (worktree, identidade, pipeline) é
  esta.
  """

  use GenServer, restart: :temporary

  alias Engine.Dev.DevAgentState
  alias Engine.Sessions.EngineApiClient

  # WorktreeManager trocável em teste (sem git/banco de repo real).
  defp worktree_manager,
    do: Application.get_env(:engine, :worktree_manager, Engine.Dev.WorktreeManager)

  def start_link({project_id, agent_id, module, session_id}) do
    GenServer.start_link(__MODULE__, {project_id, agent_id, module, session_id},
      name: via(project_id, agent_id)
    )
  end

  def via(project_id, agent_id),
    do: {:via, Registry, {Engine.Dev.Registry, {project_id, agent_id}}}

  @doc "Dispara o ciclo de trabalho (chamado num start FRESCO, não em rehydration)."
  def work(project_id, agent_id), do: GenServer.cast(via(project_id, agent_id), :work)

  # --- Callbacks ---

  @impl true
  def init({project_id, agent_id, module, session_id}) do
    DevAgentState.upsert!(%{
      project_id: project_id,
      agent_id: agent_id,
      module: module,
      session_id: session_id,
      status: "working"
    })

    {:ok,
     %{
       project_id: project_id,
       agent_id: agent_id,
       module: module,
       session_id: session_id,
       task_id: nil,
       worktree: nil,
       branch: nil
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

  # --- Ciclo do NoopDevAgent ---

  defp run_task(state, task) do
    task_id = Map.get(task, "id")
    slug = "task-" <> String.slice(to_string(task_id), 0, 8)

    case worktree_manager().create(state.project_id, state.agent_id, slug) do
      {:ok, %{path: path, branch: branch}} ->
        # Conteúdo trivial (sem LLM) só pra ter um diff.
        File.write!(Path.join(path, "NOOP-#{slug}.md"), "trabalho do #{state.agent_id}\n")

        state = %{state | task_id: task_id, worktree: path, branch: branch}
        persist(state)

        emit(state, "dev.working", %{
          agentId: state.agent_id,
          taskId: task_id,
          branch: branch
        })

        propose_commit(state)
        propose_push(state)
        propose_pr(state)

        _ =
          EngineApiClient.mark_task(
            state.project_id,
            state.session_id,
            task_id,
            "in_progress",
            state.agent_id
          )

        state

      {:error, reason} ->
        emit(state, "dev.error", %{agentId: state.agent_id, reason: inspect(reason)})
        state
    end
  end

  defp propose_commit(state) do
    propose(state, "git_commit", %{
      worktree: state.worktree,
      branch: state.branch,
      message: "#{state.agent_id}: #{state.task_id}",
      author: "#{state.agent_id}[bot]",
      authorEmail: "#{state.agent_id}-bot@brabo.dev",
      coAuthor: "Brabo User <user@brabo.dev>"
    })
  end

  defp propose_push(state) do
    propose(state, "git_push", %{worktree: state.worktree, branch: state.branch})
  end

  defp propose_pr(state) do
    propose(state, "pr_open", %{
      sourceBranch: state.branch,
      title: "#{state.agent_id}: #{state.task_id}",
      storyTaskId: state.task_id
    })
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
      status: "working"
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
