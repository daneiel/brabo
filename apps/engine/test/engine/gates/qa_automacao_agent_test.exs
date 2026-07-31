defmodule Engine.Gates.QaAutomacaoAgentTest do
  # DataCase — o ToolLoop real roda síncrono no processo de teste (mesmo
  # padrão de Engine.Dev.DevAgentServerTest). Diferente da Fase 4a: este
  # módulo não busca mais `dev_state`/`dev_context` sozinho (isso é do
  # `QaLeadServer` agora), então não há `DevAgentState.upsert!` aqui — os dois
  # entram como PARÂMETRO, direto do teste.
  use Engine.DataCase, async: false

  alias Engine.Dev.DevAgentState
  alias Engine.Gates.QaAutomacaoAgent
  alias Engine.Sessions.FakeEngineApiClient

  setup do
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :test_pid)
      Application.delete_env(:engine, :tool_loop_max_iterations)
    end)

    dev_state = %DevAgentState{
      project_id: Ecto.UUID.generate(),
      agent_id: "dev-api",
      session_id: Ecto.UUID.generate(),
      task_id: "task-abc12345",
      worktree_path: System.tmp_dir!(),
      task_budget_micros: 1_000_000,
      max_gate_corrections: 3
    }

    dev_context = %{
      task: %{"id" => "task-abc12345", "title" => "Cadastro", "description" => ""},
      story: %{"id" => "st-1", "title" => "Cadastro", "rf" => [], "rnf" => []},
      business_rules_units: [],
      task_state_units: []
    }

    %{dev_state: dev_state, dev_context: dev_context}
  end

  defp terminal_ok do
    %{
      "id" => "pa-1",
      "status" => "executed",
      "executionResult" => %{"exitCode" => 0, "stdout" => "ok"}
    }
  end

  defp run(dev_state, dev_context) do
    QaAutomacaoAgent.run(
      dev_state.project_id,
      dev_state.session_id,
      dev_state.task_id,
      dev_state,
      dev_context
    )
  end

  test "aprova só com terminal exit 0 prévio", %{dev_state: dev_state, dev_context: dev_context} do
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

    assert {:ok, verdict} = run(dev_state, dev_context)
    assert verdict.veredito == "approved"

    assert verdict.coverage_matrix == [
             %{"rule" => "regra X", "tests" => ["test/x_test.exs"], "covered" => true}
           ]

    # Não fala com a api — devolve o parecer, quem decide o que fazer com ele
    # é o QaLeadServer.
    refute_received {:gate_verdict_recorded, _, _, _, _, _, _}
    refute_received {:task_blocked, _, _, _, _}
  end

  test "recusa aprovar sem terminal exit 0 prévio — nunca aprova sem prova", %{
    dev_state: dev_state,
    dev_context: dev_context
  } do
    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("emit_qa_verdict", %{
        "veredito" => "approved",
        "resumo" => "confio que está tudo bem",
        "itens" => [],
        "coverageMatrix" => []
      })
    ])

    # emit_qa_verdict recusou (result_ok? false) -> o hook não terminou o loop
    # por halt -> a fila de turnos esgota -> {:ok, ctx} -> {:blocked, ...}.
    assert {:blocked, info} = run(dev_state, dev_context)
    assert info.origin == "modelo"
  end

  test "não conclui -> {:blocked, ...} com origem, sem chamar a api", %{
    dev_state: dev_state,
    dev_context: dev_context
  } do
    # Nenhum turno scriptado: o loop esgota sem emit_qa_verdict.
    Process.put(:fake_llm_turns, [])

    assert {:blocked, %{reason: reason, diagnosis: diagnosis, origin: origin}} =
             run(dev_state, dev_context)

    assert reason =~ "QA de Automação"
    assert diagnosis =~ "emit_qa_verdict"
    assert origin == "modelo"

    refute_received {:gate_verdict_recorded, _, _, _, _, _, _}
    refute_received {:task_blocked, _, _, _, _}
    refute_received {:event_appended, _, _, %{type: "artifact.qa_verdict"}}
    refute_received {:event_appended, _, _, %{type: "artifact.task_blocked"}}
  end

  test "limite de iterações esgotado -> origem 'modelo'", %{
    dev_state: dev_state,
    dev_context: dev_context
  } do
    Application.put_env(:engine, :tool_loop_max_iterations, 1)
    Process.put(:fake_propose_action, terminal_ok())

    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("terminal", %{"command" => "npm test"}),
      FakeEngineApiClient.tool_call_response("terminal", %{"command" => "npm test"})
    ])

    assert {:blocked, %{origin: "modelo"}} = run(dev_state, dev_context)
  end
end
