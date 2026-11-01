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
      worktree_path: pasta_temporaria_propria!(),
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

  # RN-890 (AT-542): o código de saída da RECUSA de um comando de linha.
  test "a instrução cobra código de saída 0 no feliz e diferente de 0 na recusa", %{
    dev_state: dev_state,
    dev_context: dev_context
  } do
    instrucao = Engine.Gates.QaAutomacaoAgent.instrucao_de_codigo_de_saida()
    assert instrucao =~ "CÓDIGO DE SAÍDA"
    assert instrucao =~ "0 no caminho feliz"
    assert instrucao =~ "DIFERENTE de 0"
    assert instrucao =~ "recusa a entrada"

    Process.put(:fake_llm_turns, [])
    run(dev_state, dev_context)
    assert_received {:llm_turn, _, messages, _tools}
    assert Enum.any?(messages, &(is_binary(&1["content"]) and &1["content"] =~ instrucao))
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

  test "ação pendente SUSPENDE o laço em vez de falhar (achado AB)", %{
    dev_state: dev_state,
    dev_context: dev_context
  } do
    # O caso real da 6ª execução da FASE 13b: o agente rodou
    # `ls -la && find … | head -50`, comando composto com um segmento fora do
    # `allow`. O ToolLoop suspendeu esperando decisão.
    #
    # Antes isto caía no catch-all e virava `{:blocked, origin: infra}` — o
    # gate morria e a task era bloqueada por uma decisão que ninguém tinha
    # tomado. Agora devolve o suficiente para o Lead RETOMAR.
    Process.put(:fake_propose_action, %{"id" => "pa-99", "status" => "pending"})

    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("terminal", %{
        "command" => "ls -la && find . -name package.json | head -50"
      })
    ])

    assert {:awaiting, pendente} = run(dev_state, dev_context)

    assert pendente.action_id == "pa-99"
    assert pendente.tool_name == "terminal"
    # O histórico inteiro viaja junto — é o que torna a retomada possível.
    assert is_list(pendente.ctx.messages)
    assert pendente.ctx.messages != []

    # E NADA foi decidido: sem veredito, sem bloqueio de task.
    refute_received {:gate_verdict_recorded, _, _, _, _, _, _}
    refute_received {:task_blocked, _, _, _, _}
  end

  test "retomar continua do ponto em que parou e conclui o parecer", %{
    dev_state: dev_state,
    dev_context: dev_context
  } do
    Process.put(:fake_propose_action, %{"id" => "pa-99", "status" => "pending"})

    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("terminal", %{"command" => "npm test"})
    ])

    assert {:awaiting, pendente} = run(dev_state, dev_context)

    # A decisão chega: o resultado REAL entra no lugar onde estava "pending",
    # e o modelo então emite o parecer.
    Process.put(:fake_propose_action, nil)

    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("emit_qa_verdict", %{
        "veredito" => "approved",
        "resumo" => "suite verde",
        "itens" => [],
        "coverageMatrix" => []
      })
    ])

    assert {:ok, parecer} =
             Engine.Gates.QaAutomacaoAgent.retomar(pendente, "exit 0\n", "task-1")

    assert parecer.veredito == "approved"
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

  test "corte pelo teto de saída (RN-780): bloqueia nomeando o corte", %{
    dev_state: dev_state,
    dev_context: dev_context
  } do
    cortada = FakeEngineApiClient.final_response("") |> Map.put("truncated", true)
    Process.put(:fake_llm_turns, [cortada, cortada])

    assert {:blocked, %{diagnosis: diag, origin: "modelo"}} = run(dev_state, dev_context)
    assert diag =~ "cortou duas vezes"
  end

  test "corte no meio do texto (RN-946): bloqueia nomeando o corte", %{
    dev_state: dev_state,
    dev_context: dev_context
  } do
    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.final_response("Vou registrá-lo") |> Map.put("truncated", true)
    ])

    assert {:blocked, %{diagnosis: diag, origin: "modelo"}} = run(dev_state, dev_context)
    assert diag =~ "no meio do texto"
  end

  describe "pedido anterior (RN-944)" do
    defp primeira_mensagem(dev_state, dev_context) do
      Process.put(:fake_llm_turns, [FakeEngineApiClient.final_response("x")])
      run(dev_state, dev_context)
      assert_received {:llm_turn, "qa-automacao", msgs, _tools}
      msgs |> Enum.map(&to_string(Map.get(&1, "content"))) |> Enum.join("\n")
    end

    test "itens da volta anterior entram com a instrução; sem pedido, nada muda", %{
      dev_state: dev_state,
      dev_context: dev_context
    } do
      base = primeira_mensagem(dev_state, dev_context)
      refute base =~ "volta anterior"

      com =
        primeira_mensagem(dev_state, Map.put(dev_context, :pedido_anterior, %{itens: ["A", "B"]}))

      assert com =~ "- A" and com =~ "- B"
      assert com =~ "foi atendido (onde) ou não"
    end

    test "itens vazios não acrescentam seção", %{dev_state: dev_state, dev_context: dev_context} do
      msg = primeira_mensagem(dev_state, Map.put(dev_context, :pedido_anterior, %{itens: []}))
      refute msg =~ "volta anterior"
    end
  end
end
