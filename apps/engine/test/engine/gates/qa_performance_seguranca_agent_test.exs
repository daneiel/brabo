defmodule Engine.Gates.QaPerformanceSegurancaAgentTest do
  use Engine.DataCase, async: false

  alias Engine.Dev.DevAgentState
  alias Engine.Gates.QaPerformanceSegurancaAgent
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
      task: %{"id" => "task-abc12345", "title" => "Busca de produtos", "description" => ""},
      story: %{
        "id" => "st-1",
        "title" => "Busca de produtos",
        "rf" => [],
        "rnf" => ["Tempo de resposta abaixo de 200ms"]
      },
      business_rules_units: [],
      task_state_units: []
    }

    %{dev_state: dev_state, dev_context: dev_context}
  end

  defp run(dev_state, dev_context) do
    QaPerformanceSegurancaAgent.run(
      dev_state.project_id,
      dev_state.session_id,
      dev_state.task_id,
      dev_state,
      dev_context
    )
  end

  test "reusa o registro de ferramentas sem Terminal, de propósito" do
    nomes =
      QaPerformanceSegurancaAgent.tools()
      |> Enum.map(fn modulo -> modulo.spec().name end)

    refute "terminal" in nomes
    refute "write_file" in nomes
    assert "read_file" in nomes
    assert "search_workspace" in nomes
  end

  test "aprova depois de ler algo do workspace", %{
    dev_state: dev_state,
    dev_context: dev_context
  } do
    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("read_file", %{"path" => "AGENTS.md"}),
      FakeEngineApiClient.tool_call_response("emit_perf_seguranca_verdict", %{
        "veredito" => "approved",
        "resumo" => "sem gargalo óbvio",
        "itens" => []
      })
    ])

    assert {:ok, verdict} = run(dev_state, dev_context)
    assert verdict.veredito == "approved"

    refute_received {:gate_verdict_recorded, _, _, _, _, _, _}
    refute_received {:task_blocked, _, _, _, _}
  end

  test "recusa aprovar sem NENHUMA leitura prévia — mesma disciplina da Automação", %{
    dev_state: dev_state,
    dev_context: dev_context
  } do
    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("emit_perf_seguranca_verdict", %{
        "veredito" => "approved",
        "resumo" => "parece bom",
        "itens" => []
      })
    ])

    assert {:blocked, info} = run(dev_state, dev_context)
    assert info.origin == "modelo"
  end

  test "changes_requested não exige leitura prévia — reprovar nunca precisa de prova", %{
    dev_state: dev_state,
    dev_context: dev_context
  } do
    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("emit_perf_seguranca_verdict", %{
        "veredito" => "changes_requested",
        "resumo" => "consulta em loop",
        "itens" => ["N+1 na listagem de produtos"]
      })
    ])

    assert {:ok, %{veredito: "changes_requested", itens: ["N+1 na listagem de produtos"]}} =
             run(dev_state, dev_context)
  end

  test "não conclui -> {:blocked, ...}, sem chamar a api", %{
    dev_state: dev_state,
    dev_context: dev_context
  } do
    Process.put(:fake_llm_turns, [])

    assert {:blocked, %{reason: reason, diagnosis: diagnosis, origin: "modelo"}} =
             run(dev_state, dev_context)

    assert reason =~ "Performance/Segurança"
    assert diagnosis =~ "emit_perf_seguranca_verdict"

    refute_received {:gate_verdict_recorded, _, _, _, _, _, _}
    refute_received {:task_blocked, _, _, _, _}
  end
end
