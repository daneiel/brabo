defmodule Engine.Gates.QaAgentServerTest do
  # DataCase — o QAAgent acha o worktree via DevAgentState (lê o banco) e
  # o ToolLoop real roda síncrono no processo de teste (mesmo padrão de
  # Engine.Dev.DevAgentServerTest).
  use Engine.DataCase, async: false

  alias Engine.Dev.DevAgentState
  alias Engine.Gates.{FakeGateDispatcher, QaAgentServer}
  alias Engine.Sessions.FakeEngineApiClient

  setup do
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :gate_dispatcher, FakeGateDispatcher)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :gate_dispatcher)
      Application.delete_env(:engine, :test_pid)
      Application.delete_env(:engine, :tool_loop_max_iterations)
    end)

    project_id = Ecto.UUID.generate()
    session_id = Ecto.UUID.generate()

    DevAgentState.upsert!(%{
      project_id: project_id,
      agent_id: "dev-api",
      module: "api",
      session_id: session_id,
      task_id: "task-abc12345",
      worktree_path: System.tmp_dir!(),
      status: "working"
    })

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

    {:ok, state} = QaAgentServer.init(project_id)
    %{project_id: project_id, state: state}
  end

  defp terminal_ok do
    %{
      "id" => "pa-1",
      "status" => "executed",
      "executionResult" => %{"exitCode" => 0, "stdout" => "ok"}
    }
  end

  test "aprova só com terminal exit 0 prévio; devolve run_secops -> dispara SecOps", %{
    state: state
  } do
    Process.put(:fake_propose_action, terminal_ok())

    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("terminal", %{"command" => "npm test"}),
      FakeEngineApiClient.tool_call_response("emit_qa_verdict", %{
        "veredito" => "approved",
        "resumo" => "cobertura completa",
        "itens" => [],
        "coverageMatrix" => [
          %{"rule" => "regra X", "tests" => ["test/x_test.exs"], "covered" => true}
        ]
      })
    ])

    Process.put(:fake_gate_verdict_response, %{"nextAction" => "run_secops"})

    assert {:noreply, _} = QaAgentServer.handle_cast({:run, "task-abc12345"}, state)

    assert_received {:event_appended, _, _,
                     %{type: "artifact.qa_verdict", payload: %{veredito: "approved"}}}

    assert_received {:gate_verdict_recorded, "task-abc12345", "qa", "approved", _resumo, _itens,
                     nil}

    assert_received {:gate_dispatch, :secops, _project_id, "task-abc12345"}
  end

  test "emit_qa_verdict recusa aprovar sem terminal exit 0 prévio — nunca aprova sem prova", %{
    state: state
  } do
    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("emit_qa_verdict", %{
        "veredito" => "approved",
        "resumo" => "confio que está tudo bem",
        "itens" => [],
        "coverageMatrix" => []
      })
    ])

    Process.put(:fake_gate_verdict_response, %{"nextAction" => "correct"})

    assert {:noreply, _} = QaAgentServer.handle_cast({:run, "task-abc12345"}, state)

    # emit_qa_verdict recusou (result_ok? false) -> o hook não terminou o loop
    # por halt -> a fila de turnos esgota -> {:ok, ctx} -> QaAgentServer trata
    # como changes_requested genérico. Nunca emite um veredito "approved".
    refute_received {:event_appended, _, _,
                     %{type: "artifact.qa_verdict", payload: %{veredito: "approved"}}}

    assert_received {:gate_verdict_recorded, "task-abc12345", "qa", "changes_requested", _, _, _}
  end
end
