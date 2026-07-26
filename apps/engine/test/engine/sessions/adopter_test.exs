defmodule Engine.Sessions.AdopterTest do
  @moduledoc """
  Adoção de sessões sem dono (Fase 5, item 4).

  O drain do `preStop` cobre o desligamento educado. Este módulo cobre o que
  ele não alcança: a réplica que some sem aviso (`kill -9`, OOMKill, nó
  evictado). Nesse caso o nome `:global` é liberado quando o nó cai, mas a
  linha em `session_states` fica — e a reidratação só roda no boot, então os
  pods que já estavam de pé nunca a recuperariam. A sessão ficaria `active` na
  api sem processo em lugar nenhum.
  """

  use Engine.DataCase, async: false

  alias Engine.Readiness
  alias Engine.Sessions.{Adopter, Monitor, SessionServer, SessionState, SessionSupervisor}

  setup do
    Engine.GlobalSessionTestLock.acquire()
    Application.put_env(:engine, :engine_api_client, Engine.Sessions.FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())
    Application.put_env(:engine, :session_heartbeat_timeout_ms, 60_000)
    Readiness.reset()

    on_exit(fn ->
      Readiness.reset()
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :test_pid)
      Application.delete_env(:engine, :session_heartbeat_timeout_ms)
      Engine.GlobalSessionTestLock.release()
    end)

    %{session_id: "session-orfa-#{System.unique_integer([:positive])}"}
  end

  # Deixa a linha sem processo — é o estado exato em que uma réplica morta de
  # forma abrupta deixa as sessões dela.
  defp orphan!(session_id) do
    SessionState.upsert_active!(session_id, "project-1")
    refute SessionServer.whereis(session_id)
  end

  defp stop(session_id) do
    if pid = SessionServer.whereis(session_id) do
      :ok = Monitor.expect_stop(session_id)
      SessionServer.stop(pid)
    end
  end

  test "adota uma sessão que ficou sem dono", ctx do
    orphan!(ctx.session_id)
    on_exit(fn -> stop(ctx.session_id) end)

    assert [adotada] = Adopter.run()
    assert adotada == ctx.session_id
    assert SessionServer.whereis(ctx.session_id)
  end

  test "não mexe em sessão que já tem dono", ctx do
    {:ok, pid} = SessionSupervisor.start_session(ctx.session_id, "project-1")
    on_exit(fn -> stop(ctx.session_id) end)

    assert Adopter.run() == []

    assert SessionServer.whereis(ctx.session_id) == pid,
           "o adopter recriou uma sessão que já estava viva"
  end

  test "é idempotente: rodar duas vezes não cria segundo processo", ctx do
    orphan!(ctx.session_id)
    on_exit(fn -> stop(ctx.session_id) end)

    assert [_] = Adopter.run()
    pid = SessionServer.whereis(ctx.session_id)

    assert Adopter.run() == []
    assert SessionServer.whereis(ctx.session_id) == pid
  end

  test "um nó que está drenando NÃO adota nada", ctx do
    orphan!(ctx.session_id)
    Readiness.begin_shutdown()

    assert Adopter.run() == [],
           "o nó em desligamento assumiu sessão — ela morreria junto com ele em segundos"

    refute SessionServer.whereis(ctx.session_id)
  end
end
