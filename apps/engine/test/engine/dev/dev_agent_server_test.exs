defmodule Engine.Dev.DevAgentServerTest do
  # DataCase — o DevAgentServer persiste em dev_agent_states. Callbacks
  # exercitados DIRETO no processo de teste (init/1 + handle_cast/2), então o
  # fake scriptado por dicionário de processo funciona e o acesso ao banco fica
  # no sandbox do próprio processo.
  use Engine.DataCase, async: false

  alias Engine.Dev.{DevAgentServer, DevAgentState, FakeWorktreeManager}
  alias Engine.Sessions.FakeEngineApiClient

  setup do
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :worktree_manager, FakeWorktreeManager)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :worktree_manager)
      Application.delete_env(:engine, :test_pid)
    end)

    project_id = Ecto.UUID.generate()
    session_id = Ecto.UUID.generate()
    {:ok, state} = DevAgentServer.init({project_id, "dev-api", "api", session_id})
    %{state: state, project_id: project_id, session_id: session_id}
  end

  test "init persiste o estado (rehydration data path)", %{
    state: state,
    project_id: project_id
  } do
    rows = DevAgentState.list_all()
    assert Enum.any?(rows, &(&1.project_id == project_id and &1.agent_id == "dev-api"))
    assert state.module == "api"
  end

  test "ciclo Noop: pega task, cria worktree, propõe commit→push→pr_open, marca a task", %{
    state: state
  } do
    Process.put(:fake_tasks, [%{"id" => "task-abc12345", "title" => "Cadastro"}])

    assert {:noreply, new_state} = DevAgentServer.handle_cast(:work, state)

    assert_received {:task_claimed, "api", "dev-api"}
    assert_received {:propose_action, "git_commit", %{id: "dev-api"}, commit_payload}
    assert commit_payload.author == "dev-api[bot]"
    assert_received {:propose_action, "git_push", _actor, _}
    assert_received {:propose_action, "pr_open", _actor, %{sourceBranch: "feature/task-" <> _}}
    assert_received {:task_marked, "task-abc12345", "in_progress", "dev-api"}

    assert new_state.task_id == "task-abc12345"
    assert new_state.branch =~ "feature/task-"
  end

  test "sem task pegável: fica idle, sem propor ações", %{state: state} do
    Process.put(:fake_tasks, [])

    assert {:noreply, _} = DevAgentServer.handle_cast(:work, state)

    assert_received {:event_appended, _, _, %{type: "dev.idle"}}
    refute_received {:propose_action, _, _, _}
  end
end
