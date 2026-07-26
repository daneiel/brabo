defmodule Engine.ShutdownTest do
  @moduledoc """
  Drenagem de sessões no desligamento da réplica (Fase 5, item 4).

  Antes disto, um SIGTERM matava cada `SessionServer` instantaneamente — sem
  `terminate/2`, sem `trap_exit` — e o resultado era N sessões `active` na api
  sem processo em lugar nenhum: exatamente a sessão órfã que o item existe para
  eliminar. O `Monitor` até preserva a linha (`node_shutdown?/1`, sessão 2),
  mas ninguém avisava a api e ninguém decidia o desfecho.

  Sem par no cluster (que é o caso destes testes, um nó só), NENHUMA sessão
  pode ser adotada — então todas devem terminar com causa `node_shutdown`. É a
  metade do "OU" do critério de aceite que dá para provar em ExUnit; a outra
  metade (adoção) é o que `deploy/k8s/rollout-test.sh` exercita num cluster de
  verdade, com duas réplicas.
  """

  use Engine.DataCase, async: false

  alias Engine.Readiness
  alias Engine.Sessions.{SessionServer, SessionState, SessionSupervisor}

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

    :ok
  end

  defp start_sessions(n) do
    for i <- 1..n do
      id = "session-drain-#{System.unique_integer([:positive])}-#{i}"
      {:ok, _pid} = SessionSupervisor.start_session(id, "project-1")
      id
    end
  end

  test "para de aceitar sessão nova assim que o drain começa" do
    refute Readiness.shutting_down?()

    Engine.Shutdown.drain(timeout_ms: 0)

    assert Readiness.shutting_down?()

    # É o que o SessionCommandController consulta para responder 503, e o que
    # faz o /ready tirar o pod dos Endpoints do Service.
    refute Readiness.ready?()
    assert Readiness.pending() == [:shutting_down]
  end

  test "emite session.draining com a causa no log de cada sessão" do
    [id | _] = ids = start_sessions(3)

    Engine.Shutdown.drain(timeout_ms: 0)

    for _ <- ids do
      assert_receive {:event_appended, "project-1", _sid,
                      %{type: "session.draining", payload: %{cause: "node_shutdown"}}},
                     1_000
    end

    refute SessionServer.whereis(id)
  end

  test "sem par no cluster, encerra com node_shutdown passando por closing" do
    [id] = start_sessions(1)

    Engine.Shutdown.drain(timeout_ms: 0)

    # Os dois passos são explícitos: `closing` é o que carrega a causa, e a
    # máquina de estados da api não aceita active -> closed_abnormally
    # preservando o motivo do caminho.
    assert_receive {:termination_reported, "project-1", ^id, "node_shutdown", "closing"}, 1_000

    assert_receive {:termination_reported, "project-1", ^id, "node_shutdown",
                    "closed_abnormally"},
                   1_000
  end

  test "a linha sai de session_states — a sessão encerrada não reidrata" do
    [id] = start_sessions(1)
    assert Repo.get(SessionState, id)

    Engine.Shutdown.drain(timeout_ms: 0)

    refute Repo.get(SessionState, id),
           "linha preservada após encerrar: o próximo boot ressuscitaria uma sessão morta"
  end

  test "drena TODAS as sessões locais, não só a primeira" do
    ids = start_sessions(5)

    Engine.Shutdown.drain(timeout_ms: 0)

    for id <- ids do
      refute Repo.get(SessionState, id), "sessão #{id} ficou para trás no drain"
      refute SessionServer.whereis(id)
    end
  end

  test "local_sessions só enxerga sessões cujo dono é este nó" do
    ids = start_sessions(2)

    locais = Engine.Shutdown.local_sessions() |> Enum.map(& &1.session_id)

    for id <- ids, do: assert(id in locais)
    assert Enum.all?(Engine.Shutdown.local_sessions(), &(&1.project_id == "project-1"))
  end

  test "sem nenhuma sessão local, o drain é inofensivo" do
    assert %{total: 0, adopted: 0, terminated: 0} = Engine.Shutdown.drain(timeout_ms: 0)
    refute_receive {:termination_reported, _, _, _, _}, 200
  end

  test "devolve resumo do que fez — é o que o preStop imprime" do
    start_sessions(2)

    summary = Engine.Shutdown.drain(timeout_ms: 0)

    # Sem par no cluster não há adoção possível, então as duas são encerradas.
    assert %{total: 2, adopted: 0, terminated: 2, peers: 0} = summary
    assert summary.node == to_string(node())
  end
end
