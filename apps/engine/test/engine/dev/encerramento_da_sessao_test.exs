defmodule Engine.Dev.EncerramentoDaSessaoTest do
  # RN-763 (AT-456): fechar a sessão de execução para os dev agents dela.
  use Engine.DataCase, async: false

  alias Engine.Dev.{DevAgentState, DevAgentSupervisor, EncerramentoDaSessao}

  setup do
    Application.put_env(:engine, :test_pid, self())
    Application.put_env(:engine, :engine_api_client, Engine.Sessions.FakeEngineApiClient)
    Application.put_env(:engine, :worktree_manager, Engine.Dev.FakeWorktreeManager)

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :test_pid)
      Application.delete_env(:engine, :worktree_manager)
    end)

    %{project_id: Ecto.UUID.generate(), session_id: Ecto.UUID.generate()}
  end

  test "para o dev agent, não o religa, e bloqueia a task em curso com origem politica", %{
    project_id: project_id,
    session_id: session_id
  } do
    {:ok, pid, :started} =
      DevAgentSupervisor.start_agent(project_id, "dev-api", "api", session_id, 500_000, 2, :noop)

    DevAgentState.upsert!(%{
      project_id: project_id,
      agent_id: "dev-api",
      module: "api",
      session_id: session_id,
      task_id: "task-3",
      worktree_path: System.tmp_dir!(),
      status: "working",
      impl: "noop"
    })

    ref = Process.monitor(pid)
    assert EncerramentoDaSessao.parar_da_sessao(session_id) == ["dev-api"]
    assert_receive {:DOWN, ^ref, :process, ^pid, :killed}, 1_000

    assert_receive {:task_blocked, "task-3", "sessão de execução encerrada", diag, "dev-api"}
    assert diag =~ "Libere a task"
    assert_receive {:task_blocked_origin, "task-3", "politica"}

    Process.sleep(100)
    assert DevAgentState.get(project_id, "dev-api") == nil

    assert Registry.lookup(Engine.Dev.Registry, {project_id, "dev-api"})
           |> Enum.filter(fn {p, _} -> Process.alive?(p) end) == []

    refute_receive {:event_appended, _, _, %{type: "agent.error"}}, 300
  end

  test "sessão sem dev agent é no-op, e o dev de OUTRA sessão fica de pé", %{
    project_id: project_id,
    session_id: session_id
  } do
    {:ok, pid, :started} =
      DevAgentSupervisor.start_agent(project_id, "dev-web", "web", session_id, 500_000, 2, :noop)

    assert EncerramentoDaSessao.parar_da_sessao(Ecto.UUID.generate()) == []
    assert Process.alive?(pid)
    refute_receive {:task_blocked, _, _, _, _}, 100
    :ok = DynamicSupervisor.terminate_child(DevAgentSupervisor, pid)
  end
end
