defmodule EngineWeb.ExecutionCommandControllerTest do
  # async: false — mexe nos processos globais (DevAgentSupervisor, Monitor) e
  # precisa do sandbox compartilhado, já que os agentes rodam em processos
  # próprios. As actions são chamadas DIRETO (sem passar pelo router): o que
  # está sob teste é a decisão do controller, não o pipeline de auth.
  use EngineWeb.ConnCase, async: false

  alias Engine.Dev.{
    DevAgentServer,
    DevAgentState,
    DevAgentSupervisor,
    FakeWorktreeManager,
    NoopDevAgentServer,
    Wake
  }

  alias Engine.Sessions.FakeEngineApiClient
  alias EngineWeb.ExecutionCommandController

  defp server_module(project_id, agent_id) do
    [{pid, _}] = Registry.lookup(Engine.Dev.Registry, {project_id, agent_id})
    {:dictionary, dict} = Process.info(pid, :dictionary)
    {mod, :init, 1} = Keyword.fetch!(dict, :"$initial_call")
    mod
  end

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

    # RN-502/ADR 0143 — a rota sobe/acorda dev agents, e todo claim exige
    # container REGISTRADO `running`.
    Engine.DataCase.container_running!(project_id)

    %{project_id: project_id, session_id: Ecto.UUID.generate()}
  end

  test "start sobe um dev agent REAL por módulo por padrão", %{
    conn: conn,
    project_id: project_id,
    session_id: session_id
  } do
    Process.put(:fake_tasks, [])

    conn =
      ExecutionCommandController.start(conn, %{
        "sessionId" => session_id,
        "projectId" => project_id,
        "modules" => ["api", "web"]
      })

    assert conn.status == 201
    assert server_module(project_id, "dev-api") == DevAgentServer
    assert server_module(project_id, "dev-web") == DevAgentServer
    assert DevAgentState.get(project_id, "dev-api").impl == "real"
  end

  test "start com impl=noop sobe NoopDevAgents e dispara o ciclo deles", %{
    conn: conn,
    project_id: project_id,
    session_id: session_id
  } do
    conn =
      ExecutionCommandController.start(conn, %{
        "sessionId" => session_id,
        "projectId" => project_id,
        "modules" => ["api", "web"],
        "impl" => "noop"
      })

    assert conn.status == 201
    assert server_module(project_id, "dev-api") == NoopDevAgentServer
    assert server_module(project_id, "dev-web") == NoopDevAgentServer
    assert DevAgentState.get(project_id, "dev-api").impl == "noop"

    # E o ciclo de cada um foi disparado (o :work é um cast; os agentes rodam
    # em processos próprios, então o claim é a evidência de que rodou). O
    # ciclo completo até a PR é coberto em NoopDevAgentServerTest, onde os
    # callbacks rodam no processo do teste e o fake pode ser scriptado.
    assert_receive {:task_claimed, "api", "dev-api"}, 2_000
    assert_receive {:task_claimed, "web", "dev-web"}, 2_000
  end

  test "parallelize herda o MODO do agente base (não sobe um agente real com LLM)", %{
    conn: conn,
    project_id: project_id,
    session_id: session_id
  } do
    Process.put(:fake_tasks, [])

    {:ok, _pid, :started} =
      DevAgentSupervisor.start_agent(project_id, "dev-api", "api", session_id, 123_456, 1, :noop)

    conn =
      ExecutionCommandController.parallelize(conn, %{
        "sessionId" => session_id,
        "projectId" => project_id,
        "module" => "api"
      })

    assert conn.status == 202
    assert DevAgentState.get(project_id, "dev-api-2").impl == "noop"

    assert server_module(project_id, "dev-api-2") == NoopDevAgentServer,
           "aceitar a paralelização de uma execução Noop subiu um agente REAL — " <>
             "um clique passaria a gastar token sem o usuário pedir"

    # Drena o cast assíncrono do :work disparado pelo parallelize ANTES do
    # teste terminar — sem isto, a mensagem de {:task_claimed, ...} podia
    # chegar depois, quando `Application.get_env(:engine, :test_pid)` já
    # apontava pro próximo teste (mailbox de outro processo).
    assert_receive {:task_claimed, "api", "dev-api-2"}, 2_000
  end

  test "parallelize herda os tetos do agente base do módulo", %{
    conn: conn,
    project_id: project_id,
    session_id: session_id
  } do
    # O aceite de um clique não pode criar um agente sem teto: a guarda de
    # orçamento do ToolLoop é `when is_integer(budget)`, então nil = ilimitado.
    {:ok, _pid, :started} =
      DevAgentSupervisor.start_agent(project_id, "dev-api", "api", session_id, 123_456, 1)

    conn =
      ExecutionCommandController.parallelize(conn, %{
        "sessionId" => session_id,
        "projectId" => project_id,
        "module" => "api"
      })

    assert conn.status == 202

    extra = DevAgentState.get(project_id, "dev-api-2")
    assert extra, "o subagente extra não subiu"
    assert extra.task_budget_micros == 123_456
    assert extra.max_gate_corrections == 1
  end

  test "parallelize sem agente base: 409 e nenhum agente criado", %{
    conn: conn,
    project_id: project_id,
    session_id: session_id
  } do
    conn =
      ExecutionCommandController.parallelize(conn, %{
        "sessionId" => session_id,
        "projectId" => project_id,
        "module" => "web"
      })

    assert conn.status == 409
    refute DevAgentState.get(project_id, "dev-web-2")
  end

  describe "reativação (achado #11 do primeiro dogfooding)" do
    test "agente que já estava vivo é ACORDADO, não ignorado", %{
      conn: conn,
      project_id: project_id,
      session_id: session_id
    } do
      # Antes o controller fazia `if origin == :started`: reativar a execução
      # era no-op para todo agente já vivo. Um agente parado em `idle` (fila
      # vazia no claim anterior) só voltava a trabalhar por acidente, se outra
      # task ficasse pegável e o outbox o acordasse por outro caminho.
      #
      # O que chega é um WAKE, não um `:work`. A diferença é o guard de estado
      # do server: `:idle` reivindica, `:working`/`:awaiting_gate` ignoram (a
      # task em curso não é abandonada) e `:idle_tripped` continua exigindo
      # rearm explícito — reativar não contorna o circuit breaker (RN-047).
      Process.put(:fake_tasks, [])

      {:ok, _pid, :started} =
        DevAgentSupervisor.start_agent(project_id, "dev-api", "api", session_id, nil, nil, :noop)

      :ok = Wake.subscribe(project_id, "dev-api")

      conn =
        ExecutionCommandController.start(conn, %{
          "sessionId" => session_id,
          "projectId" => project_id,
          "modules" => ["api"],
          "impl" => "noop"
        })

      assert conn.status == 201
      assert_receive {:wake, :became_claimable}, 2_000
    end

    test "start FRESCO dispara o ciclo, não o wake", %{
      conn: conn,
      project_id: project_id,
      session_id: session_id
    } do
      # O wake é o instrumento da REATIVAÇÃO. Num start fresco quem dispara é
      # o `:work` — que emite `dev.started` e reivindica. Trocar um pelo outro
      # perderia o evento de início do agente.
      Process.put(:fake_tasks, [])
      :ok = Wake.subscribe(project_id, "dev-api")

      conn =
        ExecutionCommandController.start(conn, %{
          "sessionId" => session_id,
          "projectId" => project_id,
          "modules" => ["api"],
          "impl" => "noop"
        })

      assert conn.status == 201
      refute_receive {:wake, :became_claimable}, 300
    end
  end

  describe "rearm (Fase 12b — RN-047)" do
    test "agente existente: 202 e entrega :rearm por PubSub", %{
      conn: conn,
      project_id: project_id,
      session_id: session_id
    } do
      DevAgentState.upsert!(%{
        project_id: project_id,
        agent_id: "dev-api",
        module: "api",
        session_id: session_id,
        status: "idle_tripped",
        consecutive_blocked: 3,
        impl: "real"
      })

      :ok = Wake.subscribe(project_id, "dev-api")

      conn =
        ExecutionCommandController.rearm(conn, %{
          "sessionId" => session_id,
          "projectId" => project_id,
          "agentId" => "dev-api"
        })

      assert conn.status == 202
      assert_receive :rearm
    end

    test "agente que NÃO está travado: 409, nada entregue (D8)", %{
      conn: conn,
      project_id: project_id,
      session_id: session_id
    } do
      # Antes devolvia 202 pra qualquer status. Como o `handle_info(:rearm, …)`
      # é no-op fora de `idle_tripped`, a api gravava um `dev.rearmed` —
      # evento IMUTÁVEL — pra um rearm que comprovadamente não aconteceu.
      DevAgentState.upsert!(%{
        project_id: project_id,
        agent_id: "dev-api",
        module: "api",
        session_id: session_id,
        status: "working",
        impl: "real"
      })

      :ok = Wake.subscribe(project_id, "dev-api")

      conn =
        ExecutionCommandController.rearm(conn, %{
          "sessionId" => session_id,
          "projectId" => project_id,
          "agentId" => "dev-api"
        })

      assert conn.status == 409
      refute_receive :rearm, 100
    end

    test "agente inexistente: 404, nada entregue", %{
      conn: conn,
      project_id: project_id,
      session_id: session_id
    } do
      :ok = Wake.subscribe(project_id, "dev-fantasma")

      conn =
        ExecutionCommandController.rearm(conn, %{
          "sessionId" => session_id,
          "projectId" => project_id,
          "agentId" => "dev-fantasma"
        })

      assert conn.status == 404
      refute_receive :rearm, 100
    end
  end
end
