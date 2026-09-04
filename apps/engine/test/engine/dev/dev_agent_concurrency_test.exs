defmodule Engine.Dev.DevAgentConcurrencyTest do
  @moduledoc """
  Fase 12b, requisito 4: claim atômico sob concorrência — dois agentes do
  MESMO módulo (base + extra de paralelização) e o reagendamento
  simultâneo não colidem. O claim atômico em si (`FOR UPDATE OF t SKIP
  LOCKED`) já tem prova de concorrência real na api
  (`claim-next-task.use-case.spec.ts`); aqui a prova é do lado do engine —
  que `task.became_claimable` acordando os dois ao mesmo tempo, e um
  `task.gate_resolved` chegando junto, não corrompem estado nem duplicam
  claim.

  Callbacks chamados DIRETO (mesmo idioma de dev_agent_server_test.exs) em
  DUAS variáveis de state simulando dois processos — sem GenServer real,
  já que o ponto é a lógica de reação, não o agendamento do BEAM.
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

    {:ok, base} =
      DevAgentServer.init({project_id, "dev-api", "api", session_id, nil, nil, 3, nil})

    {:ok, extra} =
      DevAgentServer.init({project_id, "dev-api-2", "api", session_id, nil, nil, 3, nil})

    %{base: base, extra: extra, project_id: project_id, session_id: session_id}
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

  defp terminal_ok(stdout \\ "ok") do
    %{
      "id" => "pa-1",
      "status" => "executed",
      "executionResult" => %{"exitCode" => 0, "stdout" => stdout}
    }
  end

  # 1 par (terminal + report_done) leva UM claim até `awaiting_gate`, onde
  # ele PARA — sem isso o ToolLoop sem script nenhum conclui sem sinalizar,
  # o que bloqueia a task e dispara reclaim automático (finish_task/2),
  # consumindo a fila inteira num processo só e mascarando o que este teste
  # quer provar.
  defp script_happy_claims(n) do
    Process.put(:fake_dev_context, dev_context())
    Process.put(:fake_propose_action, terminal_ok())

    turns =
      for _ <- 1..n do
        [
          FakeEngineApiClient.tool_call_response("terminal", %{"command" => "npm test"}),
          FakeEngineApiClient.tool_call_response("report_done", %{"summary" => "pronta"})
        ]
      end

    Process.put(:fake_llm_turns, List.flatten(turns))
  end

  test "dois agentes idle do mesmo módulo acordando ao mesmo tempo: cada um pega UMA task, nenhum fica preso",
       %{base: base, extra: extra} do
    # A fila tem duas tasks — se o claim atômico não segurasse a
    # concorrência, os dois poderiam tentar a MESMA. FakeEngineApiClient
    # simula o claim atômico real (pop de uma lista compartilhada no
    # dicionário de processo — o teste real de FOR UPDATE SKIP LOCKED é o
    # da api, citado no moduledoc).
    Process.put(:fake_tasks, [
      %{"id" => "task-a", "title" => "A"},
      %{"id" => "task-b", "title" => "B"}
    ])

    script_happy_claims(2)

    assert {:noreply, base} = DevAgentServer.handle_info({:wake, :became_claimable}, base)
    assert {:noreply, extra} = DevAgentServer.handle_info({:wake, :became_claimable}, extra)

    claimed = Enum.sort([base.task_id, extra.task_id])
    assert claimed == ["task-a", "task-b"]
    assert base.task_id != extra.task_id
    assert base.status == :awaiting_gate
    assert extra.status == :awaiting_gate
  end

  test "wake became_claimable chegando enquanto um agente já está working/awaiting_gate: no-op pra ele",
       %{base: base} do
    base = %{base | status: :working, task_id: "task-em-andamento"}

    assert {:noreply, unchanged} =
             DevAgentServer.handle_info({:wake, :became_claimable}, base)

    assert unchanged == base
    refute_received {:task_claimed, _, _}
  end

  test "gate_resolved e wake became_claimable chegando juntos pro mesmo agente: cada um age só quando cabe",
       %{base: base} do
    # base está awaiting_gate da task-a; um wake became_claimable (de OUTRA
    # task, outro evento) chega primeiro — como base não está :idle, é
    # no-op. Só depois o gate_resolved da task-a libera, e o agente
    # reivindica a próxima sozinho.
    base = %{base | status: :awaiting_gate, task_id: "task-a", worktree: "/wt", branch: "b"}

    Process.put(:fake_tasks, [%{"id" => "task-b", "title" => "B"}])
    script_happy_claims(1)

    assert {:noreply, still_awaiting} =
             DevAgentServer.handle_info({:wake, :became_claimable}, base)

    assert still_awaiting == base
    refute_received {:task_claimed, _, _}

    assert {:noreply, released} =
             DevAgentServer.handle_info(
               {:gate_resolved, %{task_id: "task-a", next_action: "done"}},
               still_awaiting
             )

    assert released.task_id == "task-b"
    assert_received {:task_claimed, "api", "dev-api"}
  end

  test "gate_resolved duplicado (Oban retry, drain concorrente) não reivindica duas vezes",
       %{base: base} do
    base = %{base | status: :awaiting_gate, task_id: "task-a", worktree: "/wt", branch: "b"}
    Process.put(:fake_tasks, [%{"id" => "task-b", "title" => "B"}])
    script_happy_claims(1)

    assert {:noreply, released} =
             DevAgentServer.handle_info(
               {:gate_resolved, %{task_id: "task-a", next_action: "done"}},
               base
             )

    assert released.task_id == "task-b"
    assert_received {:task_claimed, "api", "dev-api"}

    # Entrega duplicada da MESMA notificação — task_id não bate mais
    # (agente já está em task-b, não task-a) → no-op, nenhum claim novo.
    assert {:noreply, unchanged} =
             DevAgentServer.handle_info(
               {:gate_resolved, %{task_id: "task-a", next_action: "done"}},
               released
             )

    assert unchanged == released
    refute_received {:task_claimed, _, _}
  end
end
