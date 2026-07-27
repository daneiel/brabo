defmodule Engine.Sessions.SessionOwnershipTest do
  @moduledoc """
  Uma sessão tem UM dono no cluster inteiro (Fase 5, sessão 3).

  A versão anterior registrava o `SessionServer` num `Registry` local ao nó.
  Com uma réplica só, "único no Registry" e "único no cluster" eram a mesma
  coisa; com o HPA da sessão 2 deixaram de ser, e o efeito era destrutivo: o
  `Rehydrator` recria no boot um processo para TODA linha de `session_states`
  — tabela global —, então cada sessão passava a existir uma vez por pod. O
  websocket do browser chega em um pod só, e as demais cópias, sem receber
  `ping`, estouravam o heartbeat e mandavam a api encerrar uma sessão que
  estava viva em outro lugar.

  Estes testes fixam as duas propriedades que impedem isso de voltar:
  unicidade do nome e alcance do nome a partir de qualquer nó.
  """

  use Engine.DataCase, async: false

  alias Engine.Sessions.{Monitor, SessionServer, SessionState, SessionSupervisor}

  setup do
    Engine.GlobalSessionTestLock.acquire()
    Application.put_env(:engine, :engine_api_client, Engine.Sessions.FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())
    # Alto para que nenhuma sessão feche por heartbeat no meio do teste.
    Application.put_env(:engine, :session_heartbeat_timeout_ms, 60_000)

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :test_pid)
      Application.delete_env(:engine, :session_heartbeat_timeout_ms)
      Engine.GlobalSessionTestLock.release()
    end)

    %{session_id: "session-#{System.unique_integer([:positive])}", project_id: "project-1"}
  end

  defp stop(session_id) do
    if pid = SessionServer.whereis(session_id) do
      :ok = Monitor.expect_stop(session_id)
      SessionServer.stop(pid)
    end
  end

  test "o nome vive em :global, não num Registry local", ctx do
    {:ok, pid} = SessionSupervisor.start_session(ctx.session_id, ctx.project_id)
    on_exit(fn -> stop(ctx.session_id) end)

    assert :global.whereis_name({:brabo_session, ctx.session_id}) == pid

    # É esta a propriedade que faltava: um nome local não seria visto por
    # outro nó, e é assim que nascem as cópias que matam a sessão.
    refute Registry.lookup(Engine.Sessions.Registry, ctx.session_id) != [],
           "a sessão voltou para o Registry local — com N réplicas, N cópias"
  end

  test "start_session é idempotente: a segunda chamada devolve o MESMO pid", ctx do
    {:ok, first} = SessionSupervisor.start_session(ctx.session_id, ctx.project_id)
    on_exit(fn -> stop(ctx.session_id) end)

    {:ok, second} = SessionSupervisor.start_session(ctx.session_id, ctx.project_id)

    assert first == second
    assert Process.alive?(first)
  end

  test "corrida: N chamadas concorrentes produzem UM processo só", ctx do
    on_exit(fn -> stop(ctx.session_id) end)

    # Simula o que acontece quando várias réplicas reidratam ao mesmo tempo:
    # todas passam da checagem otimista e entram no start_child juntas. Quem
    # garante a unicidade é o registro :global, não a checagem.
    pids =
      1..10
      |> Task.async_stream(
        fn _ ->
          {:ok, pid} = SessionSupervisor.start_session(ctx.session_id, ctx.project_id)
          pid
        end,
        max_concurrency: 10
      )
      |> Enum.map(fn {:ok, pid} -> pid end)

    assert Enum.uniq(pids) |> length() == 1,
           "mais de um processo para a mesma sessão: #{inspect(Enum.uniq(pids))}"
  end

  test "whereis alcança o dono e some quando a sessão termina", ctx do
    {:ok, pid} = SessionSupervisor.start_session(ctx.session_id, ctx.project_id)
    assert SessionServer.whereis(ctx.session_id) == pid

    stop(ctx.session_id)
    # `:global` propaga a saída de forma assíncrona.
    Process.sleep(50)

    refute SessionServer.whereis(ctx.session_id)
  end

  test "heartbeat chega ao dono pelo nome global", ctx do
    {:ok, _pid} = SessionSupervisor.start_session(ctx.session_id, ctx.project_id)
    on_exit(fn -> stop(ctx.session_id) end)

    # É o que o SessionChannel faz a cada ping. Resolvido por :global, funciona
    # de qualquer nó — antes exigia estar no pod dono.
    assert :ok = SessionServer.heartbeat(ctx.session_id)
    assert Repo.get(SessionState, ctx.session_id)
  end
end
