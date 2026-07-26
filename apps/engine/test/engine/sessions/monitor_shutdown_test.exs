defmodule Engine.Sessions.MonitorShutdownTest do
  @moduledoc """
  A distinção que o `Engine.Sessions.Monitor` passou a fazer na Fase 5: nó
  descendo não é sessão terminando.

  Sem ela, a ordem de shutdown da árvore de supervisão (`SessionSupervisor` é
  derrubado ANTES do Monitor) faz o Monitor ficar vivo para processar o `:DOWN`
  de cada sessão, apagar a linha e ainda reportá-la à api como
  `closed_abnormally`. Todo rollout e todo scale-down do HPA marcaria como
  anormal justamente as sessões saudáveis, e a reidratação do boot seguinte não
  acharia nada para reidratar.
  """

  # async: false — Monitor, Registry e SessionSupervisor são globais, e o
  # sandbox precisa estar compartilhado para os SessionServers enxergarem a
  # conexão. Mesmo motivo de rehydration_test.exs.
  use Engine.DataCase, async: false

  alias Engine.Sessions.{Monitor, SessionState, SessionSupervisor}

  setup do
    Engine.GlobalSessionTestLock.acquire()
    Application.put_env(:engine, :engine_api_client, Engine.Sessions.FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :test_pid)
      Engine.GlobalSessionTestLock.release()
    end)

    %{session_id: "session-#{System.unique_integer([:positive])}", project_id: "project-1"}
  end

  test "desligamento do supervisor PRESERVA a linha e não reporta término", ctx do
    {:ok, pid} = SessionSupervisor.start_session(ctx.session_id, ctx.project_id)
    assert Repo.get(SessionState, ctx.session_id)

    # É isto que o OTP faz com cada sessão quando o nó recebe SIGTERM.
    :ok = DynamicSupervisor.terminate_child(SessionSupervisor, pid)
    wait_forget(pid)

    assert Repo.get(SessionState, ctx.session_id),
           "a linha sumiu num :shutdown — o rollout deixaria a sessão órfã, sem nada para reidratar"

    refute_receive {:termination_reported, _, _, _, _}, 200
  end

  test "sessão que morre de verdade continua apagando a linha e reportando", ctx do
    {:ok, pid} = SessionSupervisor.start_session(ctx.session_id, ctx.project_id)

    Process.exit(pid, :kill)
    wait_forget(pid)

    refute Repo.get(SessionState, ctx.session_id),
           "a linha sobreviveu a um crash: a sessão morta reidrataria a cada boot, para sempre"

    session_id = ctx.session_id

    assert_receive {:termination_reported, "project-1", ^session_id, _, "closed_abnormally"},
                   1_000
  end

  test "heartbeat_timeout viaja dentro de :shutdown mas É término — a linha sai", ctx do
    Application.put_env(:engine, :session_heartbeat_timeout_ms, 50)
    on_exit(fn -> Application.delete_env(:engine, :session_heartbeat_timeout_ms) end)

    {:ok, _pid} = SessionSupervisor.start_session(ctx.session_id, ctx.project_id)

    session_id = ctx.session_id

    assert_receive {:termination_reported, "project-1", ^session_id, "heartbeat_timeout",
                    "closed"},
                   1_000

    # A armadilha: um `forget?({:shutdown, _})` copiado do Engine.Dev.Monitor
    # trataria isto como nó descendo e a sessão voltaria a cada boot.
    refute Repo.get(SessionState, session_id),
           "linha preservada num heartbeat_timeout: a sessão reidrataria eternamente"
  end

  # O Monitor processa o :DOWN de forma assíncrona; espera ele esquecer o pid.
  defp wait_forget(pid, tentativas \\ 100) do
    state = :sys.get_state(Monitor)

    if Map.has_key?(state.by_pid, pid) and tentativas > 0 do
      Process.sleep(10)
      wait_forget(pid, tentativas - 1)
    end
  end
end
