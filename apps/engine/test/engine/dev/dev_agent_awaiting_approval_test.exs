defmodule Engine.Dev.DevAgentAwaitingApprovalTest do
  @moduledoc """
  O agente ESPERA a aprovação em vez de queimar iterações (ADR 0052).

  A regressão que isto pega, e que custou uma execução real inteira: uma
  ferramenta `:pipeline` que ficava `pending` devolvia
  `"proposed_action <id> status pending"` como RESULTADO. O modelo lia aquilo
  como se fosse a resposta do comando, não aprendia nada sobre ele, tentava
  outra coisa — e cada tentativa consumia uma iteração até
  `toolloop.limit_reached {iteration: 8, max_iterations: 8}`, com a task
  bloqueada por "limite de iterações atingido" sem uma linha escrita. As
  aprovações concedidas pelo usuário chegavam depois do laço esgotado e eram
  inúteis.

  Os dois lados afirmados aqui: o agente PARA retendo tudo, e RETOMA de onde
  parou quando a decisão chega — com o resultado de verdade no lugar onde
  estaria a palavra "pending".
  """

  use Engine.DataCase, async: false

  alias Engine.Dev.{DevAgentServer, FakeWorktreeManager}
  alias Engine.Gates.FakeGateDispatcher
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

    # RN-501/ADR 0142 — pré-condição de todo claim.
    container_running!(project_id)

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

    %{state: state}
  end

  # A ação nasce pendente: é o caminho de `require_approval`.
  defp pendente, do: %{"id" => "pa-77", "status" => "pending"}

  defp turno_com_terminal do
    FakeEngineApiClient.tool_call_response("terminal", %{"command" => "ls -la"})
  end

  test "ação pendente PARA o agente, retendo task e worktree", %{state: state} do
    Process.put(:fake_propose_action, pendente())
    Process.put(:fake_llm_turns, [turno_com_terminal()])

    assert {:noreply, parado} = DevAgentServer.handle_cast(:work, state)

    assert parado.status == :awaiting_approval
    assert parado.task_id == "task-abc12345"
    # O worktree é retido, como em `awaiting_gate`: soltá-lo aqui destruiria o
    # trabalho que a aprovação vai liberar.
    assert parado.worktree
    assert parado.laco_pendente.action_id == "pa-77"

    # E o desfecho NÃO é bloqueio: a task não voltou para a fila.
    refute_received {:task_blocked, _, _, _, _}
  end

  test "aprovada: retoma o laço com a saída REAL no lugar do 'pending'", %{state: state} do
    Process.put(:fake_propose_action, pendente())
    Process.put(:fake_llm_turns, [turno_com_terminal()])

    assert {:noreply, parado} = DevAgentServer.handle_cast(:work, state)
    assert parado.status == :awaiting_approval

    # Chegou a decisão. O laço retoma e o modelo, agora com a saída de verdade,
    # conclui — é o turno seguinte scriptado abaixo.
    #
    # As ações git do `report_done` voltam AUTO-APROVADAS: é o que a ativação
    # da execução configura para o dev agent. Sem trocar o fake aqui, o commit
    # também nasceria pendente e o agente suspenderia de novo — o que, aliás, é
    # o comportamento certo, e foi assim que este teste pegou a si mesmo.
    Process.put(:fake_propose_action, %{"id" => "pa-git", "status" => "executed"})

    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("report_done", %{"summary" => "feito"})
    ])

    desfecho = %{
      action_id: "pa-77",
      status: "executed",
      execution_result: %{"exitCode" => 0, "stdout" => "total 0\n"},
      rejection_reason: nil
    }

    assert {:noreply, retomado} = DevAgentServer.handle_info({:action_settled, desfecho}, parado)

    refute retomado.status == :awaiting_approval
    assert retomado.laco_pendente == nil
    # O laço seguiu até o fim: `report_done` propõe o commit da task.
    assert_received {:propose_action, "git_commit", _, _}
  end

  @doc """
  Recusa é RESPOSTA, não silêncio. Sem isto o agente esperaria para sempre por
  algo que ninguém vai aprovar — o mesmo defeito que a Fase 12e corrigiu no
  `pr_open`, um nível abaixo.
  """
  test "recusada: também solta o agente, com o motivo no lugar do resultado", %{state: state} do
    Process.put(:fake_propose_action, pendente())
    Process.put(:fake_llm_turns, [turno_com_terminal()])

    assert {:noreply, parado} = DevAgentServer.handle_cast(:work, state)

    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("report_blocked", %{
        "reason" => "comando recusado",
        "diagnosis" => "o usuário negou o ls"
      })
    ])

    desfecho = %{
      action_id: "pa-77",
      status: "denied",
      execution_result: nil,
      rejection_reason: "não quero listar isso"
    }

    assert {:noreply, retomado} = DevAgentServer.handle_info({:action_settled, desfecho}, parado)

    refute retomado.status == :awaiting_approval
    assert retomado.laco_pendente == nil
  end

  test "desfecho de OUTRA ação não derruba nem solta o agente", %{state: state} do
    Process.put(:fake_propose_action, pendente())
    Process.put(:fake_llm_turns, [turno_com_terminal()])

    assert {:noreply, parado} = DevAgentServer.handle_cast(:work, state)

    outra = %{
      action_id: "pa-99",
      status: "executed",
      execution_result: %{},
      rejection_reason: nil
    }

    assert {:noreply, ainda_parado} =
             DevAgentServer.handle_info({:action_settled, outra}, parado)

    assert ainda_parado.status == :awaiting_approval
    assert ainda_parado.laco_pendente.action_id == "pa-77"
  end

  @doc """
  O laço suspenso vive em MEMÓRIA, e o restart o leva. O ADR 0052 previu a
  perda e disse que ela cairia no caminho de bloqueio com diagnóstico — mas não
  caía: o agente reidratava em `awaiting_approval` sem laço, o
  `{:action_settled, ...}` era ignorado pela cláusula de guarda, e ele esperava
  PARA SEMPRE. Sem erro, sem bloqueio, sem diagnóstico.

  Falha silenciosa é o que esta fase existe para acabar; ela não pode voltar um
  degrau acima. Encontrado na primeira execução real com o mecanismo ligado.
  """
  test "restart durante a espera BLOQUEIA a task em vez de esperar para sempre", %{
    state: state
  } do
    # Simula o que o rehydrator entrega depois do restart: o estado durável diz
    # `awaiting_approval`, e o laço em memória não existe mais.
    resume = %{
      status: "awaiting_approval",
      task_id: "task-abc12345",
      worktree_path: "/tmp/wt",
      consecutive_blocked: 0
    }

    {:ok, reidratado, {:continue, continuacao}} =
      DevAgentServer.init(
        {state.project_id, "dev-api", "api", state.session_id, nil, nil, nil, resume}
      )

    assert continuacao == {:restart_recovery, "awaiting_approval"}
    assert reidratado.laco_pendente == nil

    assert {:noreply, _} = DevAgentServer.handle_continue(continuacao, reidratado)

    # A task volta para a fila com diagnóstico, e a origem é `infra` — quem
    # derrubou o turno foi o processo reiniciando.
    assert_received {:task_blocked, "task-abc12345", motivo, _diagnostico, "dev-api"}
    assert motivo =~ "esperava aprovação"
    assert_received {:task_blocked_origin, "task-abc12345", "infra"}
  end
end
