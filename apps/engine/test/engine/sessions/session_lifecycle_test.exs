defmodule Engine.Sessions.SessionLifecycleTest do
  # async: false — mexe em Application env compartilhado e nos processos
  # globais (Monitor, Registry).
  use ExUnit.Case, async: false

  alias Engine.Sessions.{Monitor, SessionServer, SessionSupervisor}

  setup do
    Application.put_env(:engine, :engine_api_client, Engine.Sessions.FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :test_pid)
    end)

    :ok
  end

  test "parada esperada (expect_stop) nao dispara callback" do
    session_id = unique_id()
    {:ok, pid} = SessionSupervisor.start_session(session_id, "project-1")

    :ok = Monitor.expect_stop(session_id)
    SessionServer.stop(pid)

    refute_receive {:termination_reported, _, _, _}, 200
  end

  test "parada normal SEM expect_stop dispara callback (defensivo)" do
    session_id = unique_id()
    {:ok, pid} = SessionSupervisor.start_session(session_id, "project-1")

    SessionServer.stop(pid)

    assert_receive {:termination_reported, "project-1", ^session_id, "normal"}
  end

  test ":killed dispara callback com motivo killed" do
    session_id = unique_id()
    {:ok, pid} = SessionSupervisor.start_session(session_id, "project-1")

    Process.exit(pid, :kill)

    assert_receive {:termination_reported, "project-1", ^session_id, "killed"}
  end

  test "crash (raise) dispara callback com a mensagem da excecao" do
    session_id = unique_id()
    {:ok, pid} = SessionSupervisor.start_session(session_id, "project-1")

    SessionServer.crash(pid)

    assert_receive {:termination_reported, "project-1", ^session_id, reason}
    assert reason =~ "crash simulado da sessão #{session_id}"
  end

  defp unique_id, do: "session-#{System.unique_integer([:positive])}"
end
