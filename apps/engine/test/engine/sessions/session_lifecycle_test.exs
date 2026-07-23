defmodule Engine.Sessions.SessionLifecycleTest do
  # async: false — mexe em Application env compartilhado e nos processos
  # globais (Monitor, Registry). Engine.DataCase (não ExUnit.Case puro)
  # porque SessionServer.init/1 agora grava em session_states — como o
  # processo é spawnado pelo SessionSupervisor (não é filho do processo de
  # teste), a conexão sandboxed precisa estar em modo compartilhado
  # (async: false => shared: true em Engine.DataCase.setup_sandbox/1).
  use Engine.DataCase, async: false

  alias Engine.Sessions.{Monitor, SessionServer, SessionState, SessionSupervisor}

  setup do
    # async: false só serializa DENTRO deste módulo — outros arquivos de
    # teste que também mutam Monitor/Registry/test_pid global rodariam
    # concorrentemente sem este lock (ver Engine.GlobalSessionTestLock).
    Engine.GlobalSessionTestLock.acquire()
    Application.put_env(:engine, :engine_api_client, Engine.Sessions.FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :test_pid)
      Engine.GlobalSessionTestLock.release()
    end)

    :ok
  end

  test "parada esperada (expect_stop) nao dispara callback" do
    session_id = unique_id()
    {:ok, pid} = SessionSupervisor.start_session(session_id, "project-1")

    :ok = Monitor.expect_stop(session_id)
    SessionServer.stop(pid)

    refute_receive {:termination_reported, _, _, _, _}, 200
  end

  test "parada normal SEM expect_stop dispara callback (defensivo, closed_abnormally)" do
    session_id = unique_id()
    {:ok, pid} = SessionSupervisor.start_session(session_id, "project-1")

    SessionServer.stop(pid)

    assert_receive {:termination_reported, "project-1", ^session_id, "normal",
                    "closed_abnormally"}
  end

  test ":killed dispara callback com motivo killed (closed_abnormally) e limpa session_states" do
    session_id = unique_id()
    {:ok, pid} = SessionSupervisor.start_session(session_id, "project-1")
    assert SessionState.list_non_terminal() |> Enum.any?(&(&1.session_id == session_id))

    Process.exit(pid, :kill)

    assert_receive {:termination_reported, "project-1", ^session_id, "killed",
                    "closed_abnormally"}

    refute SessionState.list_non_terminal() |> Enum.any?(&(&1.session_id == session_id))
  end

  test "crash (raise) dispara callback com a mensagem da excecao (closed_abnormally)" do
    session_id = unique_id()
    {:ok, pid} = SessionSupervisor.start_session(session_id, "project-1")

    SessionServer.crash(pid)

    assert_receive {:termination_reported, "project-1", ^session_id, reason, "closed_abnormally"}
    assert reason =~ "crash simulado da sessão #{session_id}"
  end

  test "timeout de heartbeat dispara callback com to=closed" do
    Application.put_env(:engine, :session_heartbeat_timeout_ms, 50)
    on_exit(fn -> Application.delete_env(:engine, :session_heartbeat_timeout_ms) end)

    session_id = unique_id()
    {:ok, _pid} = SessionSupervisor.start_session(session_id, "project-1")

    assert_receive {:termination_reported, "project-1", ^session_id, "heartbeat_timeout",
                    "closed"},
                   300
  end

  test "heartbeat reseta o timer e evita o timeout" do
    Application.put_env(:engine, :session_heartbeat_timeout_ms, 100)
    on_exit(fn -> Application.delete_env(:engine, :session_heartbeat_timeout_ms) end)

    session_id = unique_id()
    {:ok, pid} = SessionSupervisor.start_session(session_id, "project-1")

    # dá 2 pings dentro da janela — se o timer não resetasse, o timeout
    # de 100ms teria disparado bem antes dos 250ms totais aqui.
    Process.sleep(60)
    :ok = SessionServer.heartbeat(session_id)
    Process.sleep(60)
    :ok = SessionServer.heartbeat(session_id)

    refute_receive {:termination_reported, _, _, _, _}, 80

    # o timer de heartbeat continua pendente depois daqui — encerra
    # explicitamente pra não vazar um :heartbeat_timeout tardio pro
    # mailbox do PRÓXIMO teste (que reusa o mesmo test_pid).
    :ok = Monitor.expect_stop(session_id)
    SessionServer.stop(pid)
  end

  defp unique_id, do: "session-#{System.unique_integer([:positive])}"
end
