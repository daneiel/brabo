defmodule Engine.Gates.QaLeadServerTest do
  # DataCase — o Lead acha o worktree via DevAgentState (lê o banco, ao
  # contrário dos subagentes, que recebem tudo por parâmetro) e o ToolLoop
  # real roda síncrono no processo de teste.
  #
  # As duas subespecialidades rodam SEQUENCIAIS no processo do Lead (ver o
  # comentário de `rodar_ativas/6` em qa_lead_server.ex): quando as duas estão
  # ativas, `fake_llm_turns` é uma fila ÚNICA, consumida por Automação
  # primeiro e por Performance/Segurança depois — não duas filas paralelas.
  #
  # Este arquivo prova a FIAÇÃO (decisão → delegação → registro → consolidação
  # → a MESMA chamada de sempre à api). A árvore de decisão de
  # `QaLead.consolidar/1` para as quatro origens já está coberta em
  # `qa_lead_test.exs`; aqui a falha testada usa a origem "modelo" (loop sem
  # veredito), que é a mais simples de provocar por fake — não porque as
  # outras três seriam tratadas diferente na fiação.
  use Engine.DataCase, async: false

  alias Engine.Dev.DevAgentState
  alias Engine.Gates.{FakeGateDispatcher, QaLeadServer}
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

    {:ok, state} = QaLeadServer.init(project_id)
    %{project_id: project_id, session_id: session_id, state: state}
  end

  defp terminal_ok do
    %{
      "id" => "pa-1",
      "status" => "executed",
      "executionResult" => %{"exitCode" => 0, "stdout" => "ok"}
    }
  end

  defp dev_context(rnf) do
    %{
      "task" => %{"id" => "task-abc12345", "title" => "Cadastro", "description" => ""},
      "story" => %{
        "id" => "st-1",
        "title" => "Cadastro",
        "description" => "",
        "rf" => [],
        "rnf" => rnf,
        "dod" => [],
        "dor" => []
      },
      "businessRules" => [],
      "adrs" => []
    }
  end

  describe "story sem RNF de performance" do
    test "delega só Automação; Performance/Segurança fica dispensed, nunca em silêncio", %{
      state: state
    } do
      Process.put(:fake_dev_context, dev_context([]))
      Process.put(:fake_propose_action, terminal_ok())

      Process.put(:fake_llm_turns, [
        FakeEngineApiClient.tool_call_response("terminal", %{"command" => "npm test"}),
        FakeEngineApiClient.tool_call_response("emit_qa_verdict", %{
          "veredito" => "approved",
          "resumo" => "cobertura completa",
          "itens" => [],
          "coverageMatrix" => []
        })
      ])

      Process.put(:fake_gate_verdict_response, %{"nextAction" => "run_secops"})

      assert {:noreply, _} = QaLeadServer.handle_cast({:run, "task-abc12345"}, state)

      assert_received {:delegation_recorded,
                       %{subagent: "qa-automacao", status: "completed"} = automacao}

      assert automacao.parecer_artifact_id != nil

      assert_received {:delegation_recorded,
                       %{
                         subagent: "qa-performance-seguranca",
                         status: "dispensed",
                         justification: justificativa
                       }}

      assert justificativa =~ "RNF de performance"

      # UMA chamada só à api do gate — o mesmo veredito de sempre.
      assert_received {:gate_verdict_recorded, "task-abc12345", "qa", "approved", _resumo, _itens,
                       nil}

      assert_received {:gate_dispatch, :secops, _project_id, "task-abc12345"}
    end
  end

  describe "story com RNF de performance" do
    test "delega as duas; consolida com itens rastreados por subespecialidade", %{state: state} do
      Process.put(
        :fake_dev_context,
        dev_context(["Tempo de resposta abaixo de 200ms"])
      )

      Process.put(:fake_propose_action, terminal_ok())

      Process.put(:fake_llm_turns, [
        # Automação — aprova.
        FakeEngineApiClient.tool_call_response("terminal", %{"command" => "npm test"}),
        FakeEngineApiClient.tool_call_response("emit_qa_verdict", %{
          "veredito" => "approved",
          "resumo" => "cobertura completa",
          "itens" => [],
          "coverageMatrix" => []
        }),
        # Performance/Segurança — pede mudança.
        FakeEngineApiClient.tool_call_response("read_file", %{"path" => "src/busca.ts"}),
        FakeEngineApiClient.tool_call_response("emit_perf_seguranca_verdict", %{
          "veredito" => "changes_requested",
          "resumo" => "consulta em loop",
          "itens" => ["N+1 na listagem de produtos"]
        })
      ])

      Process.put(:fake_gate_verdict_response, %{"nextAction" => "correct"})

      assert {:noreply, _} = QaLeadServer.handle_cast({:run, "task-abc12345"}, state)

      assert_received {:delegation_recorded, %{subagent: "qa-automacao", status: "completed"}}

      assert_received {:delegation_recorded,
                       %{subagent: "qa-performance-seguranca", status: "completed"} = perf_seg}

      assert perf_seg.parecer_artifact_id != nil

      # O veredito final é UM só, changes_requested (não é maioria — uma
      # pendência já reprova o todo), com o item rastreado até quem o
      # levantou.
      assert_received {:gate_verdict_recorded, "task-abc12345", "qa", "changes_requested",
                       _resumo, itens, nil}

      assert itens == ["[QA de Performance e Segurança] N+1 na listagem de produtos"]

      # DevAgentServer.correct/3 é chamado (nextAction "correct") — não há
      # mensagem própria pra isso no fake; a ausência de erro já é o sinal
      # de que o pipeline completo rodou sem levantar.
    end
  end

  describe "falha de subagente" do
    test "não conclui -> bloqueia com a origem, NUNCA chama record_gate_verdict", %{
      state: state
    } do
      Process.put(:fake_dev_context, dev_context([]))
      # Nenhum turno scriptado: a Automação esgota sem emit_qa_verdict.
      Process.put(:fake_llm_turns, [])

      assert {:noreply, _} = QaLeadServer.handle_cast({:run, "task-abc12345"}, state)

      assert_received {:delegation_recorded,
                       %{
                         subagent: "qa-automacao",
                         status: "failed",
                         failure_origin: "modelo"
                       }}

      # Dispensada é registrada de qualquer jeito — a decisão de delegação
      # independe do desfecho de quem já rodou.
      assert_received {:delegation_recorded,
                       %{subagent: "qa-performance-seguranca", status: "dispensed"}}

      # O ponto central: NÃO É changes_requested. Não há achado sobre o
      # código do dev, e fingir que há queimaria uma correção do teto à toa
      # (RN-015, lição do ADR 0020 um nível acima).
      refute_received {:gate_verdict_recorded, _, _, _, _, _, _}

      assert_received {:task_blocked, "task-abc12345", reason, diagnosis, "qa-lead"}
      assert_received {:task_blocked_origin, "task-abc12345", "modelo"}
      assert reason =~ "QA de Automação"
      assert diagnosis =~ "emit_qa_verdict"
    end
  end
end
