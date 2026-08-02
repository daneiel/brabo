defmodule Engine.Dev.DevRehydratorTest do
  # async: false — DevAgentSupervisor e Registry são processos globais, e os
  # agentes rodam em processos próprios (sandbox em modo compartilhado).
  use Engine.DataCase, async: false
  use Oban.Testing, repo: Engine.Repo, prefix: "engine"

  alias Engine.Dev.{
    DevAgentServer,
    DevAgentState,
    DevAgentSupervisor,
    DevRehydrator,
    FakeWorktreeManager,
    NoopDevAgentServer
  }

  alias Engine.Gates.FakeGateDispatcher
  alias Engine.Outbox.Event
  alias Engine.Sessions.FakeEngineApiClient
  alias Engine.Workers.DevAgentWakeWorker

  setup do
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :worktree_manager, FakeWorktreeManager)
    Application.put_env(:engine, :gate_dispatcher, FakeGateDispatcher)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :worktree_manager)
      Application.delete_env(:engine, :gate_dispatcher)
      Application.delete_env(:engine, :test_pid)
    end)

    %{project_id: Ecto.UUID.generate(), session_id: Ecto.UUID.generate()}
  end

  # De qual módulo o processo registrado é — é o que distingue um dev agent
  # real de um Noop depois que a reidratação já rodou.
  defp server_module(project_id, agent_id) do
    [{pid, _}] = Registry.lookup(Engine.Dev.Registry, {project_id, agent_id})
    {:dictionary, dict} = Process.info(pid, :dictionary)
    {mod, :init, 1} = Keyword.fetch!(dict, :"$initial_call")
    mod
  end

  defp desliga(project_id, agent_id) do
    # :shutdown PRESERVA a linha durável — é exatamente o caso que a
    # reidratação cobre (o nó caiu com o agente vivo).
    [{pid, _}] = Registry.lookup(Engine.Dev.Registry, {project_id, agent_id})
    :ok = DynamicSupervisor.terminate_child(DevAgentSupervisor, pid)
    wait_unregister(project_id, agent_id)
  end

  defp wait_unregister(project_id, agent_id, tentativas \\ 100) do
    if Registry.lookup(Engine.Dev.Registry, {project_id, agent_id}) != [] and tentativas > 0 do
      Process.sleep(10)
      wait_unregister(project_id, agent_id, tentativas - 1)
    end
  end

  test "reidrata um NoopDevAgent como Noop — não como agente real", %{
    project_id: project_id,
    session_id: session_id
  } do
    {:ok, _pid, :started} =
      DevAgentSupervisor.start_agent(project_id, "dev-api", "api", session_id, 500_000, 2, :noop)

    assert server_module(project_id, "dev-api") == NoopDevAgentServer
    assert DevAgentState.get(project_id, "dev-api").impl == "noop"

    desliga(project_id, "dev-api")
    :ok = DevRehydrator.run()

    assert server_module(project_id, "dev-api") == NoopDevAgentServer,
           "o Noop voltou como agente REAL: um restart do nó trocaria a implementação " <>
             "(e passaria a gastar token) sem ninguém pedir"

    desliga(project_id, "dev-api")
  end

  test "reidrata um dev agent real como real", %{
    project_id: project_id,
    session_id: session_id
  } do
    {:ok, _pid, :started} =
      DevAgentSupervisor.start_agent(project_id, "dev-web", "web", session_id, 500_000, 2)

    assert DevAgentState.get(project_id, "dev-web").impl == "real"

    desliga(project_id, "dev-web")
    :ok = DevRehydrator.run()

    assert server_module(project_id, "dev-web") == DevAgentServer

    desliga(project_id, "dev-web")
  end

  test "reidratação preserva os tetos e NÃO redispara o ciclo :work", %{
    project_id: project_id,
    session_id: session_id
  } do
    {:ok, _pid, :started} =
      DevAgentSupervisor.start_agent(project_id, "dev-api", "api", session_id, 123_456, 7, :noop)

    desliga(project_id, "dev-api")
    :ok = DevRehydrator.run()

    row = DevAgentState.get(project_id, "dev-api")
    assert row.task_budget_micros == 123_456
    assert row.max_gate_corrections == 7

    # Um ciclo novo é decisão de quem reativa a execução — reidratar não pode
    # sair reivindicando task nem propondo ação.
    refute_received {:task_claimed, _, _}
    refute_received {:propose_action, _, _, _}

    desliga(project_id, "dev-api")
  end

  test "é idempotente: rodar duas vezes não duplica agente", %{
    project_id: project_id,
    session_id: session_id
  } do
    {:ok, _pid, :started} =
      DevAgentSupervisor.start_agent(project_id, "dev-api", "api", session_id, nil, nil, :noop)

    :ok = DevRehydrator.run()
    :ok = DevRehydrator.run()

    assert length(Registry.lookup(Engine.Dev.Registry, {project_id, "dev-api"})) == 1

    desliga(project_id, "dev-api")
  end

  describe "os quatro estados reidratados (Fase 12b-6)" do
    # `DevAgentState.upsert!/1` é um upsert LITERAL: campo ausente do map vira
    # nil na linha existente (a coluna está na lista de :replace do
    # on_conflict — mesma armadilha documentada em agent_io.ex). Simular "o
    # estado mudou por fora" precisa reler a linha e só sobrescrever o que
    # está testando, senão module/session_id (NOT NULL) quebram o upsert.
    defp force_status!(project_id, agent_id, overrides) do
      row = DevAgentState.get(project_id, agent_id)

      DevAgentState.upsert!(
        Map.merge(
          %{
            project_id: row.project_id,
            agent_id: row.agent_id,
            module: row.module,
            session_id: row.session_id,
            task_id: row.task_id,
            worktree_path: row.worktree_path,
            status: row.status,
            task_budget_micros: row.task_budget_micros,
            max_gate_corrections: row.max_gate_corrections,
            consecutive_blocked: row.consecutive_blocked,
            max_consecutive_blocked: row.max_consecutive_blocked,
            impl: row.impl
          },
          overrides
        )
      )
    end

    defp insert_outbox!(aggregate_id, event_type, payload) do
      %Event{}
      |> Ecto.Changeset.change(%{
        id: Ecto.UUID.generate(),
        aggregate_type: "task",
        aggregate_id: aggregate_id,
        event_type: event_type,
        payload: payload,
        created_at: DateTime.utc_now(),
        processed_at: nil
      })
      |> Repo.insert!()
    end

    defp drain_and_wake do
      Engine.Outbox.Drain.run_once()

      for job <- all_enqueued(worker: DevAgentWakeWorker) do
        :ok = DevAgentWakeWorker.perform(%Oban.Job{args: job.args})
      end
    end

    test "idle reidratado: volta idle, sem claim", %{
      project_id: project_id,
      session_id: session_id
    } do
      {:ok, _pid, :started} =
        DevAgentSupervisor.start_agent(
          project_id,
          "dev-api",
          "api",
          session_id,
          nil,
          nil,
          :real,
          3
        )

      row_antes = DevAgentState.get(project_id, "dev-api")
      assert row_antes.status == "idle"

      desliga(project_id, "dev-api")
      :ok = DevRehydrator.run()

      assert server_module(project_id, "dev-api") == DevAgentServer
      refute_received {:task_claimed, _, _}

      row_depois = DevAgentState.get(project_id, "dev-api")
      assert row_depois.status == "idle"
      assert row_depois.task_id == nil

      desliga(project_id, "dev-api")
    end

    test "idle_tripped reidratado: contador intacto, ignora wake até rearmar", %{
      project_id: project_id,
      session_id: session_id
    } do
      {:ok, _pid, :started} =
        DevAgentSupervisor.start_agent(
          project_id,
          "dev-api",
          "api",
          session_id,
          nil,
          nil,
          :real,
          3
        )

      force_status!(project_id, "dev-api", %{status: "idle_tripped", consecutive_blocked: 3})

      desliga(project_id, "dev-api")
      :ok = DevRehydrator.run()

      row = DevAgentState.get(project_id, "dev-api")
      assert row.status == "idle_tripped"
      assert row.consecutive_blocked == 3

      # Um wake normal (became_claimable) chega no processo reidratado —
      # travado, ele ignora: claim_task nunca é chamado (a notificação
      # `task_claimed` acontece incondicionalmente DENTRO dele, então sua
      # ausência prova que o guard barrou antes).
      Engine.Dev.Wake.deliver(project_id, "dev-api", {:wake, :became_claimable})
      refute_receive {:task_claimed, _, _}, 200

      desliga(project_id, "dev-api")
    end

    test "awaiting_gate reidratado: retoma intacto e reage a um gate que resolve DEPOIS do restart",
         %{project_id: project_id, session_id: session_id} do
      {:ok, _pid, :started} =
        DevAgentSupervisor.start_agent(
          project_id,
          "dev-api",
          "api",
          session_id,
          nil,
          nil,
          :real,
          3
        )

      task_id = Ecto.UUID.generate()

      force_status!(project_id, "dev-api", %{
        status: "awaiting_gate",
        task_id: task_id,
        worktree_path: "/tmp/brabo-fake-worktree-#{task_id}",
        consecutive_blocked: 0
      })

      desliga(project_id, "dev-api")
      :ok = DevRehydrator.run()

      row = DevAgentState.get(project_id, "dev-api")
      assert row.status == "awaiting_gate"
      assert row.task_id == task_id
      # Nada reivindicado só por reidratar — awaiting_gate não tenta claim.
      refute_received {:task_claimed, _, _}

      # O gate resolve DEPOIS do restart — outbox real → drain → wake worker
      # → PubSub → o processo reidratado (que assinou no init/1) reage.
      insert_outbox!(task_id, "task.gate_resolved", %{
        "projectId" => project_id,
        "sessionId" => session_id,
        "taskId" => task_id,
        "agentId" => "dev-api",
        "gate" => "secops",
        "veredito" => "approved",
        "nextAction" => "done"
      })

      drain_and_wake()

      assert_receive {:task_claimed, "api", "dev-api"}, 2_000

      desliga(project_id, "dev-api")
    end

    test "working reidratado: bloqueia a task retida com diagnóstico do restart, tenta a próxima, e NÃO conta pro circuit breaker",
         %{project_id: project_id, session_id: session_id} do
      {:ok, _pid, :started} =
        DevAgentSupervisor.start_agent(
          project_id,
          "dev-api",
          "api",
          session_id,
          nil,
          nil,
          :real,
          3
        )

      task_id = Ecto.UUID.generate()

      force_status!(project_id, "dev-api", %{
        status: "working",
        task_id: task_id,
        worktree_path: "/tmp/brabo-fake-worktree-#{task_id}",
        consecutive_blocked: 0
      })

      desliga(project_id, "dev-api")
      :ok = DevRehydrator.run()

      assert_received {:task_blocked, ^task_id, "engine reiniciou durante a task", _, "dev-api"}
      # Já tenta a próxima sozinho — sem restart, sem intervenção.
      assert_received {:task_claimed, "api", "dev-api"}

      row = DevAgentState.get(project_id, "dev-api")
      assert row.status == "idle"
      assert row.task_id == nil
      # O contador NÃO sobe: reiniciar o engine não é o agente queimando o
      # teto do circuit breaker.
      assert row.consecutive_blocked == 0

      desliga(project_id, "dev-api")
    end
  end
end
