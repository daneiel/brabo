defmodule Engine.Dev.DevAgentServerTest do
  # DataCase — o DevAgentServer persiste em dev_agent_states. Callbacks
  # exercitados DIRETO no processo de teste (init/1 + handle_cast/2), então o
  # fake scriptado por dicionário de processo funciona, o ToolLoop real roda
  # síncrono no mesmo processo, e o acesso ao banco fica no sandbox do
  # próprio processo.
  use Engine.DataCase, async: false

  alias Engine.Dev.{DevAgentServer, DevAgentState, FakeWorktreeManager}
  alias Engine.Sessions.FakeEngineApiClient

  setup do
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :worktree_manager, FakeWorktreeManager)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :worktree_manager)
      Application.delete_env(:engine, :test_pid)
      Application.delete_env(:engine, :tool_loop_max_iterations)
    end)

    project_id = Ecto.UUID.generate()
    session_id = Ecto.UUID.generate()
    {:ok, state} = DevAgentServer.init({project_id, "dev-api", "api", session_id, nil})
    %{state: state, project_id: project_id, session_id: session_id}
  end

  defp terminal_ok(stdout \\ "ok") do
    %{
      "id" => "pa-1",
      "status" => "executed",
      "executionResult" => %{"exitCode" => 0, "stdout" => stdout}
    }
  end

  test "init persiste o estado (rehydration data path)", %{
    state: state,
    project_id: project_id
  } do
    rows = DevAgentState.list_all()
    assert Enum.any?(rows, &(&1.project_id == project_id and &1.agent_id == "dev-api"))
    assert state.module == "api"
  end

  test "sem task pegável: fica idle, sem propor ações", %{state: state} do
    Process.put(:fake_tasks, [])

    assert {:noreply, _} = DevAgentServer.handle_cast(:work, state)

    assert_received {:event_appended, _, _, %{type: "dev.idle"}}
    refute_received {:propose_action, _, _, _}
  end

  test "fluxo feliz: report_done após terminal exit 0 → abre PR, marca in_review", %{
    state: state
  } do
    Process.put(:fake_tasks, [%{"id" => "task-abc12345", "title" => "Cadastro"}])
    Process.put(:fake_propose_action, terminal_ok())

    Process.put(:fake_dev_context, %{
      "task" => %{
        "id" => "task-abc12345",
        "title" => "Cadastro",
        "description" => "Cadastro de usuários"
      },
      "story" => %{
        "id" => "st-1",
        "title" => "Cadastro de usuários",
        "description" => "",
        "rf" => [],
        "rnf" => [],
        "dod" => ["testes passando", "code review aprovado"],
        "dor" => []
      },
      "businessRules" => [],
      "adrs" => []
    })

    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("terminal", %{"command" => "npm test"}),
      FakeEngineApiClient.tool_call_response("report_done", %{
        "summary" => "cadastro implementado"
      })
    ])

    assert {:noreply, new_state} = DevAgentServer.handle_cast(:work, state)

    assert_received {:task_claimed, "api", "dev-api"}
    assert_received {:dev_context_fetched, "task-abc12345"}
    assert_received {:propose_action, "terminal", _, %{command: "npm test"}}
    assert_received {:propose_action, "git_commit", _, commit_payload}
    assert commit_payload.author == "dev-api[bot]"
    assert commit_payload.message == "cadastro implementado"
    assert_received {:propose_action, "git_push", _, _}
    assert_received {:propose_action, "pr_open", _, pr_payload}
    assert pr_payload.title =~ "Cadastro"
    assert pr_payload.body =~ "Definition of Done"
    assert_received {:task_marked, "task-abc12345", "in_review", "dev-api"}
    refute_received {:task_blocked, _, _, _, _}

    assert new_state.task_id == "task-abc12345"
  end

  test "task impossível: limite de iterações → blocked, sem PR", %{state: state} do
    Application.put_env(:engine, :tool_loop_max_iterations, 2)
    Process.put(:fake_tasks, [%{"id" => "task-impossivel", "title" => "Tarefa impossível"}])

    # Sempre pede uma ferramenta que não conclui nem bloqueia — só o teto de
    # iterações vai parar o loop.
    Process.put(
      :fake_llm_always,
      FakeEngineApiClient.tool_call_response("search_workspace", %{"query" => "x"})
    )

    assert {:noreply, new_state} = DevAgentServer.handle_cast(:work, state)

    assert_received {:event_appended, _, _,
                     %{type: "dev.blocked", payload: %{reason: "limite de iterações atingido"}}}

    assert_received {:task_blocked, "task-impossivel", "limite de iterações atingido", _,
                     "dev-api"}

    refute_received {:propose_action, "pr_open", _, _}
    refute_received {:task_marked, _, "in_review", _}

    assert new_state.task_id == "task-impossivel"
  end

  test "orçamento de tokens excedido → blocked com diagnóstico de custo, sem PR", %{state: state} do
    state = %{state | task_budget_micros: 500_000}
    Process.put(:fake_tasks, [%{"id" => "task-cara", "title" => "Tarefa cara"}])

    expensive_tool_call = %{
      "message" => %{
        "role" => "assistant",
        "content" => "",
        "toolCalls" => [
          %{"id" => "tc-1", "name" => "search_workspace", "arguments" => %{"query" => "x"}}
        ]
      },
      "usage" => %{
        "inputTokens" => 1000,
        "outputTokens" => 1000,
        "costMicros" => 1_000_000,
        "estimated" => false
      },
      "error" => nil
    }

    Process.put(:fake_llm_always, expensive_tool_call)

    assert {:noreply, _new_state} = DevAgentServer.handle_cast(:work, state)

    assert_received {:event_appended, _, _,
                     %{type: "dev.blocked", payload: %{reason: "orçamento de tokens excedido"}}}

    assert_received {:task_blocked, "task-cara", "orçamento de tokens excedido", diagnosis,
                     "dev-api"}

    assert diagnosis =~ "1000000"
    refute_received {:propose_action, "pr_open", _, _}
  end

  test "report_done sem terminal exit 0 prévio: recusado, loop conclui sem PR", %{state: state} do
    Process.put(:fake_tasks, [%{"id" => "task-apressada", "title" => "Tarefa apressada"}])

    # Pede report_done de cara, sem nunca rodar terminal — a ferramenta
    # recusa (result_ok? false), o hook não termina o loop, e a fila esgota
    # em seguida (final_response encerra normalmente).
    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("report_done", %{"summary" => "pronto"})
    ])

    assert {:noreply, _new_state} = DevAgentServer.handle_cast(:work, state)

    refute_received {:propose_action, "pr_open", _, _}
    refute_received {:task_marked, _, "in_review", _}
    assert_received {:task_blocked, "task-apressada", _, _, "dev-api"}
  end
end
