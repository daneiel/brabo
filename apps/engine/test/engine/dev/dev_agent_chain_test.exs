defmodule Engine.Dev.DevAgentChainTest do
  @moduledoc """
  A cadeia completa do requisito 7 da Fase 12b: claim → PR → gate approved →
  claim da próxima → fila vazia → idle → task nova → acorda — sem restart do
  engine.

  `handle_cast`/`handle_info` são chamados DIRETO no processo do teste,
  mesmo idioma de `dev_agent_server_test.exs` (LLM/worktree/api scriptados
  por dicionário de processo, só possível no MESMO processo que os
  scriptou). O que muda aqui: o SINAL que dispara cada reação percorre o
  caminho REAL — outbox → `Drain.run_once()` → `DevAgentWakeWorker.perform/1`
  → `Engine.Dev.Wake` (PubSub) → mailbox do processo, que é também onde
  `init/1` assinou (pela mesma razão que os outros testes chamam callbacks
  direto: `init/1` roda no processo do teste). Só "o GenServer entrega a
  mensagem sozinho pro próprio processo" fica de fora — isso é detalhe do
  runtime do OTP, coberto por `dev_agent_wake_worker_test.exs`.

  Prova determinística: sem LLM real, sem gate real. "3 gates reais em
  sequência" (o julgamento de QA/SecOps) não é testável assim — é aceite
  manual, registrado no ADR 0045.
  """

  use Engine.DataCase, async: false
  use Oban.Testing, repo: Engine.Repo, prefix: "engine"

  alias Engine.Dev.{AgentIo, DevAgentServer, FakeWorktreeManager}
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

    project_id = Ecto.UUID.generate()
    session_id = Ecto.UUID.generate()

    {:ok, state} =
      DevAgentServer.init({project_id, "dev-api", "api", session_id, nil, nil, 3})

    %{state: state, project_id: project_id, session_id: session_id}
  end

  defp terminal_ok(stdout \\ "ok") do
    %{
      "id" => "pa-1",
      "status" => "executed",
      "executionResult" => %{"exitCode" => 0, "stdout" => stdout}
    }
  end

  defp dev_context do
    %{
      "task" => %{"id" => "x", "title" => "x", "description" => ""},
      "story" => %{
        "id" => "st-1",
        "title" => "x",
        "description" => "",
        "rf" => [],
        "rnf" => [],
        "dod" => [],
        "dor" => []
      },
      "businessRules" => [],
      "adrs" => []
    }
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

  # A ponte que o mundo real percorre em dois processos (api → engine) —
  # aqui, os dois pedaços de infraestrutura reais, chamados em sequência.
  # Cada job PERFORMADO é apagado: `perform/1` chamado direto (sem passar
  # pelo Oban de verdade) não marca o job como concluído, e sem apagar aqui
  # `all_enqueued/1` devolveria os mesmos jobs de novo na PRÓXIMA chamada
  # desta função — replay silencioso do que já rodou.
  defp drain_and_wake do
    Engine.Outbox.Drain.run_once()

    jobs = all_enqueued(worker: DevAgentWakeWorker)

    for job <- jobs do
      :ok = DevAgentWakeWorker.perform(%Oban.Job{args: job.args})
    end

    Repo.delete_all(
      from(j in Oban.Job, prefix: "engine", where: j.id in ^Enum.map(jobs, & &1.id))
    )
  end

  test "claim → PR → gate approved → claim da próxima → fila vazia → idle → task nova → acorda",
       %{state: state, project_id: project_id, session_id: session_id} do
    # aggregate_id é :binary_id — precisa ser UUID de verdade.
    task1 = Ecto.UUID.generate()
    task2 = Ecto.UUID.generate()
    task3 = Ecto.UUID.generate()

    # --- 1. reivindica task-1, abre PR, entra em awaiting_gate ---
    Process.put(:fake_tasks, [
      %{"id" => task1, "title" => "Um"},
      %{"id" => task2, "title" => "Dois"}
    ])

    Process.put(:fake_dev_context, dev_context())
    Process.put(:fake_propose_action, terminal_ok())

    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("terminal", %{"command" => "npm test"}),
      FakeEngineApiClient.tool_call_response("report_done", %{"summary" => "task 1 pronta"})
    ])

    assert {:noreply, state} = DevAgentServer.handle_cast(:work, state)
    assert state.status == :awaiting_gate
    assert state.task_id == task1
    assert_received {:task_claimed, "api", "dev-api"}
    assert_received {:gate_dispatch, :qa, _, ^task1}

    # --- 2. o gate aprova, FORA de processo: outbox → drain → wake worker
    #     → PubSub → chega na mailbox deste processo (onde init/1 assinou) ---
    insert_outbox!(task1, "task.gate_resolved", %{
      "projectId" => project_id,
      "sessionId" => session_id,
      "taskId" => task1,
      "agentId" => "dev-api",
      "gate" => "secops",
      "veredito" => "approved",
      "nextAction" => "done"
    })

    drain_and_wake()
    assert_receive {:gate_resolved, %{task_id: ^task1, next_action: "done"}}

    # --- 3. o agente reage: libera task-1 e JÁ reivindica task-2, sozinho ---
    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("terminal", %{"command" => "npm test"}),
      FakeEngineApiClient.tool_call_response("report_done", %{"summary" => "task 2 pronta"})
    ])

    assert {:noreply, state} =
             DevAgentServer.handle_info(
               {:gate_resolved, %{task_id: task1, next_action: "done"}},
               state
             )

    assert state.status == :awaiting_gate
    assert state.task_id == task2
    assert state.consecutive_blocked == 0
    assert_received {:task_claimed, "api", "dev-api"}

    # --- 4. task-2 também aprova; a fila JÁ ESTÁ VAZIA → volta a idle ---
    insert_outbox!(task2, "task.gate_resolved", %{
      "projectId" => project_id,
      "sessionId" => session_id,
      "taskId" => task2,
      "agentId" => "dev-api",
      "gate" => "secops",
      "veredito" => "approved",
      "nextAction" => "done"
    })

    drain_and_wake()
    assert_receive {:gate_resolved, %{task_id: ^task2, next_action: "done"}}

    assert {:noreply, state} =
             DevAgentServer.handle_info(
               {:gate_resolved, %{task_id: task2, next_action: "done"}},
               state
             )

    assert state.status == :idle
    assert state.task_id == nil
    assert_received {:event_appended, _, _, %{type: "dev.idle"}}

    # --- 5. task NOVA fica pegável em outro lugar do sistema — o agente
    #     ocioso acorda e reivindica, SEM restart do engine ---
    Process.put(:fake_tasks, [%{"id" => task3, "title" => "Três"}])

    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("terminal", %{"command" => "npm test"}),
      FakeEngineApiClient.tool_call_response("report_done", %{"summary" => "task 3 pronta"})
    ])

    # `task.became_claimable` resolve agentes pela linha DURÁVEL
    # (DevAgentState.list_by_module), não pelo state em memória do teste —
    # precisa refletir "idle" pra este agente ser um alvo.
    AgentIo.persist(state)

    insert_outbox!(task3, "task.became_claimable", %{
      "projectId" => project_id,
      "sessionId" => session_id,
      "taskId" => task3,
      "modules" => ["api"],
      "cause" => "story_ready"
    })

    drain_and_wake()
    assert_receive {:wake, :became_claimable}

    assert {:noreply, state} = DevAgentServer.handle_info({:wake, :became_claimable}, state)

    assert state.status == :awaiting_gate
    assert state.task_id == task3
    assert_received {:task_claimed, "api", "dev-api"}
  end
end
