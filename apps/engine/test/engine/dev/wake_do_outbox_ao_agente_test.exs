defmodule Engine.Dev.WakeDoOutboxAoAgenteTest do
  @moduledoc """
  O caminho INTEIRO que solta um dev agent parado numa aprovação: linha na
  outbox da api → `Engine.Outbox.Drain` → job do Oban → `DevAgentWakeWorker` →
  `Engine.Dev.Wake` → o processo do agente.

  Por que existe, e por que não bastava o que já havia: os testes de
  `DevAgentAwaitingApprovalTest` chamam `handle_info({:action_settled, …})`
  direto. Eles provam o que o agente FAZ com a mensagem, e assumem que ela
  chega. `drain_test` prova o roteamento; `dev_agent_wake_worker_test` prova a
  entrega. Cada elo verde, e a corrente inteira nunca exercitada de uma ponta
  à outra — que é exatamente onde o defeito morava: o evento era emitido no
  agregado errado e morria no primeiro elo, sem job, sem erro e sem log.

  A subscrição aqui NÃO é montada à mão. Quem assina o tópico é o `init/1` do
  próprio `DevAgentServer`, rodando no processo de teste — se o agente e o
  worker discordarem sobre o formato do tópico, ou sobre a identidade do
  agente, este teste falha, e é o único que falharia.
  """

  use Engine.DataCase, async: false

  alias Engine.Dev.{DevAgentServer, FakeWorktreeManager}
  alias Engine.Gates.FakeGateDispatcher
  alias Engine.Outbox.{Drain, Event}
  alias Engine.Sessions.FakeEngineApiClient

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

    # `init/1` assina o tópico do agente com o processo de teste como
    # destinatário — a mesma linha que roda num agente de verdade.
    {:ok, state} =
      DevAgentServer.init({project_id, "dev-api", "api", session_id, nil, nil, nil, nil})

    Process.put(:fake_tasks, [%{"id" => "task-abc12345", "title" => "Cadastro"}])

    Process.put(:fake_dev_context, %{
      "task" => %{"id" => "task-abc12345", "title" => "Cadastro", "description" => ""},
      "story" => %{
        "id" => "st-1",
        "title" => "Cadastro",
        "description" => "",
        "rf" => [],
        "rnf" => [],
        "dod" => [],
        "dor" => []
      },
      "businessRules" => [],
      "adrs" => []
    })

    %{state: state, project_id: project_id, session_id: session_id}
  end

  # A linha como a api a grava em `avisarQuemEsperava` (approve/deny-action):
  # agregado `task`, e o id da ação no payload.
  defp evento_da_api!(project_id, session_id, action_id, extras) do
    payload =
      Map.merge(
        %{
          "projectId" => project_id,
          "sessionId" => session_id,
          "actionId" => action_id,
          "agentId" => "dev-api",
          "actionType" => "terminal"
        },
        extras
      )

    %Event{}
    |> Ecto.Changeset.change(%{
      id: Ecto.UUID.generate(),
      aggregate_type: "task",
      aggregate_id: action_id,
      event_type: "task.action_settled",
      payload: payload,
      created_at: DateTime.utc_now(),
      processed_at: nil
    })
    |> Repo.insert!()
  end

  # Os dois elos do meio, rodados de verdade: o dreno lê a outbox e enfileira,
  # e a fila executa o worker (`testing: :manual` não roda job sozinho).
  defp drenar_e_executar do
    Drain.run_once()
    Oban.drain_queue(queue: :default)
  end

  # `action_id` é UUID de verdade: `outbox_events.aggregate_id` é `binary_id`,
  # e a api grava ali o id da própria ação.
  defp parar_o_agente(state, action_id) do
    Process.put(:fake_propose_action, %{"id" => action_id, "status" => "pending"})

    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("terminal", %{"command" => "ls -la"})
    ])

    {:noreply, parado} = DevAgentServer.handle_cast(:work, state)
    assert parado.status == :awaiting_approval
    assert parado.laco_pendente.action_id == action_id
    parado
  end

  test "aprovação na api chega ao agente e o laço retoma", ctx do
    action_id = Ecto.UUID.generate()
    parado = parar_o_agente(ctx.state, action_id)

    evento_da_api!(ctx.project_id, ctx.session_id, action_id, %{
      "status" => "executed",
      "executionResult" => %{"exitCode" => 0, "stdout" => "total 0\n"}
    })

    drenar_e_executar()

    # A mensagem CHEGOU — é isto que nenhum teste afirmava.
    assert_receive {:action_settled, desfecho}
    assert desfecho.action_id == action_id
    assert desfecho.status == "executed"
    assert desfecho.execution_result == %{"exitCode" => 0, "stdout" => "total 0\n"}

    # E o agente a aceita: o formato que o worker monta é o que o `handle_info`
    # casa. Duas metades que só se encontram aqui.
    Process.put(:fake_propose_action, %{"id" => "pa-git", "status" => "executed"})

    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("report_done", %{"summary" => "feito"})
    ])

    assert {:noreply, retomado} = DevAgentServer.handle_info({:action_settled, desfecho}, parado)
    refute retomado.status == :awaiting_approval
    assert retomado.laco_pendente == nil
  end

  test "recusa na api também chega, com o motivo", ctx do
    action_id = Ecto.UUID.generate()
    _parado = parar_o_agente(ctx.state, action_id)

    evento_da_api!(ctx.project_id, ctx.session_id, action_id, %{
      "status" => "denied",
      "rejectionReason" => "esse comando não"
    })

    drenar_e_executar()

    assert_receive {:action_settled, desfecho}
    assert desfecho.status == "denied"
    assert desfecho.rejection_reason == "esse comando não"
  end

  test "o agregado errado quebra a corrente no primeiro elo, em silêncio" do
    # A regressão de verdade, afirmada de ponta a ponta: com
    # `aggregate_type: "proposed_action"` o dreno nem lê a linha. Nada falha,
    # nada é logado — e o agente espera para sempre. Este teste é o que
    # transforma esse silêncio em vermelho.
    action_id = Ecto.UUID.generate()

    row =
      %Event{}
      |> Ecto.Changeset.change(%{
        id: Ecto.UUID.generate(),
        aggregate_type: "proposed_action",
        aggregate_id: action_id,
        event_type: "task.action_settled",
        payload: %{
          "projectId" => Ecto.UUID.generate(),
          "actionId" => action_id,
          "agentId" => "dev-api",
          "status" => "executed"
        },
        created_at: DateTime.utc_now(),
        processed_at: nil
      })
      |> Repo.insert!()

    drenar_e_executar()

    assert Repo.get!(Event, row.id).processed_at == nil
    refute_receive {:action_settled, _}, 100
  end
end
