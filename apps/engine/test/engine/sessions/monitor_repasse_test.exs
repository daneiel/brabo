defmodule Engine.Sessions.MonitorRepasseTest do
  @moduledoc """
  AT-078: o `:DOWN` do pod que REPASSA uma sessão chega ao Monitor DEPOIS de o
  par a ter regravado em `session_states`, e o DELETE incondicional levava a
  linha do par — a sessão ficava com dono e sem linha, invisível ao Adopter, ao
  Rehydrator e ao `local_sessions/0` do drain do par (o k3d mostrou uma órfã em
  ~1 de 4-6 rollouts).

  Determinístico: o Monitor é SUSPENSO (`:sys.suspend`) entre o stop e a
  regravação do par, então o `:DOWN` fica na fila e só é processado depois — a
  ordem que o k3d sorteia. Sem `sleep` para ordenar nada. O par é simulado pelo
  que importa, o `upsert_active!` do `init` dele (o Monitor do OUTRO nó é outro
  processo; um par real neste nó bloquearia no `watch` do Monitor suspenso).
  """

  use Engine.DataCase, async: false

  alias Engine.Sessions.{Monitor, SessionServer, SessionState, SessionSupervisor}

  setup do
    Engine.GlobalSessionTestLock.acquire()
    Application.put_env(:engine, :engine_api_client, Engine.Sessions.FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())
    Application.put_env(:engine, :session_heartbeat_timeout_ms, 60_000)

    on_exit(fn ->
      # Idempotente: resume de processo não suspenso é no-op.
      :sys.resume(Monitor)
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :test_pid)
      Application.delete_env(:engine, :session_heartbeat_timeout_ms)
      Engine.GlobalSessionTestLock.release()
    end)

    %{session_id: "session-#{System.unique_integer([:positive])}", project_id: "project-1"}
  end

  # O que `Engine.Shutdown.release/1` faz, até o repasse: marca, para, e deixa
  # o `:DOWN` na fila do Monitor suspenso.
  defp repassar(pid, session_id) do
    :ok = Monitor.expect_handoff(session_id)
    :sys.suspend(Monitor)
    :ok = SessionServer.stop(pid)
  end

  defp drenar_monitor do
    :sys.resume(Monitor)
    # `get_state` é síncrono e entra DEPOIS do :DOWN na caixa de entrada.
    _ = :sys.get_state(Monitor)
  end

  test "o :DOWN tardio do pod que repassou NÃO apaga a linha regravada pelo par", ctx do
    {:ok, pid} = SessionSupervisor.start_session(ctx.session_id, ctx.project_id)

    repassar(pid, ctx.session_id)
    # O par adota: o init do SessionServer dele regrava a linha.
    SessionState.upsert_active!(ctx.session_id, ctx.project_id)

    drenar_monitor()

    assert Repo.get(SessionState, ctx.session_id),
           "o Monitor do pod antigo apagou a linha do par: sessão com dono e sem linha (AT-078)"

    refute_receive {:termination_reported, _, _, _, _}, 100
  end

  test "cadeia antigo → antigo → novo: o segundo drain ainda VÊ a sessão", ctx do
    {:ok, pid} = SessionSupervisor.start_session(ctx.session_id, ctx.project_id)

    # Hop 1: o par "B" (outro pod antigo) adota. Sem `watch` — o Monitor de B é
    # de B.
    repassar(pid, ctx.session_id)
    spec = {SessionServer, {ctx.session_id, ctx.project_id, nil}}
    {:ok, par} = DynamicSupervisor.start_child(SessionSupervisor, spec)

    # O :DOWN do hop 1 só agora é processado.
    drenar_monitor()

    # Hop 2: B drena. `local_sessions/0` parte da linha — sem ela, B não vê a
    # sessão, não a repassa ao pod novo, e o SIGTERM de B a mata.
    assert ctx.session_id in Enum.map(Engine.Shutdown.local_sessions(), & &1.session_id),
           "o pod que recebeu o repasse não enxerga a sessão para repassá-la de novo"

    :ok = DynamicSupervisor.terminate_child(SessionSupervisor, par)
  end

  test "sem adoção a linha continua sendo apagada pelo drain (terminate_unadopted)", ctx do
    {:ok, _pid} = SessionSupervisor.start_session(ctx.session_id, ctx.project_id)

    Engine.Shutdown.drain(timeout_ms: 0)
    _ = :sys.get_state(Monitor)

    refute Repo.get(SessionState, ctx.session_id)
  end
end
