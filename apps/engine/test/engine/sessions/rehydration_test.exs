defmodule Engine.Sessions.RehydrationTest do
  # async: false — mexe em Application env compartilhado e nos processos
  # globais (Monitor, Registry), mesmo motivo de session_lifecycle_test.exs.
  use Engine.DataCase, async: false

  alias Engine.Sessions.{Monitor, Rehydrator, SessionState, SessionServer}

  setup do
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

  test "reidrata uma sessão sobrevivente de um boot anterior" do
    session_id = unique_id()
    # Simula uma linha deixada por um boot anterior (sem processo vivo
    # correspondente) — insere direto, sem passar por SessionSupervisor.
    SessionState.upsert_active!(session_id, "project-1")

    Rehydrator.run()

    assert [{pid, _}] = Registry.lookup(Engine.Sessions.Registry, session_id)
    assert Process.alive?(pid)

    # limpa pra não vazar pro próximo teste
    :ok = Monitor.expect_stop(session_id)
    SessionServer.stop(pid)
  end

  test "sessão reidratada fecha sozinha por heartbeat_timeout se ninguém reconectar" do
    Application.put_env(:engine, :session_heartbeat_timeout_ms, 50)
    on_exit(fn -> Application.delete_env(:engine, :session_heartbeat_timeout_ms) end)

    session_id = unique_id()
    SessionState.upsert_active!(session_id, "project-1")

    Rehydrator.run()

    assert_receive {:termination_reported, "project-1", ^session_id, "heartbeat_timeout",
                    "closed"},
                   300
  end

  test "run/0 é idempotente com o Registry (start_session já checa antes de criar)" do
    session_id = unique_id()
    SessionState.upsert_active!(session_id, "project-1")

    Rehydrator.run()
    assert [{pid, _}] = Registry.lookup(Engine.Sessions.Registry, session_id)

    # Rodar de novo não deveria criar um segundo processo pro mesmo id.
    Rehydrator.run()
    assert [{^pid, _}] = Registry.lookup(Engine.Sessions.Registry, session_id)

    :ok = Monitor.expect_stop(session_id)
    SessionServer.stop(pid)
  end

  defp unique_id, do: "session-#{System.unique_integer([:positive])}"
end
