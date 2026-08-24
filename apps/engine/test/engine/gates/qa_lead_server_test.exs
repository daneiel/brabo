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
  alias Engine.Gates.{FakeGateDispatcher, GateState, QaLeadServer}
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

  # --- helpers de run_design (ADR 0090) ---
  defp epico(stories), do: %{"id" => "ep-1", "title" => "Épico", "stories" => stories}

  defp story_backlog(id),
    do: %{"id" => id, "title" => "Cadastro", "rf" => [], "rnf" => [], "dod" => []}

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
      state: state,
      project_id: project_id
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

      # ADR 0067: o ciclo concluiu (mão de bastão pro SecOps já entregue) —
      # nada fica em voo pra este gate.
      assert GateState.get(project_id, "task-abc12345", "qa") == nil
    end
  end

  describe "story com RNF de performance" do
    test "delega as duas; consolida com itens rastreados por subespecialidade", %{
      state: state,
      project_id: project_id
    } do
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

      # ADR 0067: dispatch aplicado (mesmo que fire-and-forget) — nada fica
      # em voo.
      assert GateState.get(project_id, "task-abc12345", "qa") == nil
    end
  end

  describe "falha de subagente" do
    test "não conclui -> bloqueia com a origem, NUNCA chama record_gate_verdict", %{
      state: state,
      project_id: project_id
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

      # ADR 0067: bloqueado é terminal — `mark_task_blocked` já é durável e
      # já acorda o dev agent, nada mais a resgatar.
      assert GateState.get(project_id, "task-abc12345", "qa") == nil
    end
  end

  # --- achado AB da FASE 13b -------------------------------------------
  #
  # Na 6ª execução real, o `qa-automacao` esbarrou num comando que precisava
  # de aprovação. O gate MORRIA: a suspensão virava `origin: infra` e a task
  # era bloqueada por uma decisão que ninguém tinha tomado.
  describe "aprovação pendente no meio do gate" do
    test "a área PARA sem consolidar, e nada é decidido", %{
      state: state,
      project_id: project_id
    } do
      Process.put(:fake_dev_context, dev_context([]))
      Process.put(:fake_propose_action, %{"id" => "pa-99", "status" => "pending"})

      Process.put(:fake_llm_turns, [
        FakeEngineApiClient.tool_call_response("terminal", %{"command" => "npm test"})
      ])

      assert {:noreply, novo} = QaLeadServer.handle_cast({:run, "task-abc12345"}, state)

      # O estado em voo ficou guardado, chaveado pela ação que segura o laço.
      assert novo.pendente.action_id == "pa-99"
      assert novo.pendente.delegacao.subagent == "qa-automacao"

      # O que NÃO pode acontecer: veredito, bloqueio de task, ou a delegação
      # registrada como falha. Nada foi decidido — só está esperando.
      refute_received {:gate_verdict_recorded, _, _, _, _, _, _}
      refute_received {:task_blocked, _, _, _, _}
      refute_received {:delegation_recorded, %{status: "failed"}}

      # ADR 0067: a espera é DURÁVEL — se o processo cair agora, o
      # GateRescuer acha esta linha e reinicia a área.
      row = GateState.get(project_id, "task-abc12345", "qa")
      assert row.step == "in_progress"
      assert row.subagent == "qa-automacao"
    end

    test "a decisão RETOMA o laço e a área conclui", %{state: state, project_id: project_id} do
      Process.put(:fake_dev_context, dev_context([]))
      Process.put(:fake_propose_action, %{"id" => "pa-99", "status" => "pending"})

      Process.put(:fake_llm_turns, [
        FakeEngineApiClient.tool_call_response("terminal", %{"command" => "npm test"})
      ])

      assert {:noreply, suspenso} = QaLeadServer.handle_cast({:run, "task-abc12345"}, state)

      # Chega o desfecho: a suite rodou e passou.
      Process.put(:fake_propose_action, nil)

      Process.put(:fake_llm_turns, [
        FakeEngineApiClient.tool_call_response("emit_qa_verdict", %{
          "veredito" => "approved",
          "resumo" => "suite verde",
          "itens" => [],
          "coverageMatrix" => []
        })
      ])

      assert {:noreply, retomado} =
               QaLeadServer.handle_info(
                 {:action_settled,
                  %{
                    action_id: "pa-99",
                    status: "executed",
                    execution_result: %{"exitCode" => 0, "stdout" => "ok"}
                  }},
                 suspenso
               )

      assert retomado.pendente == nil
      # E agora sim o gate decide — o que a suspensão tinha impedido.
      assert_received {:gate_verdict_recorded, _, _, _, _, _, _}
      refute_received {:task_blocked, _, _, _, _}

      # ADR 0067: concluiu — a linha em voo não sobrevive à retomada.
      assert GateState.get(project_id, "task-abc12345", "qa") == nil
    end

    test "desfecho de OUTRA ação não derruba nem retoma", %{state: state} do
      suspenso = %{state | pendente: %{action_id: "pa-99"}}

      assert {:noreply, igual} =
               QaLeadServer.handle_info(
                 {:action_settled, %{action_id: "outra", status: "executed"}},
                 suspenso
               )

      assert igual.pendente.action_id == "pa-99"
    end
  end

  # ADR 0090 — o segundo momento: SEM task_id, SEM DevAgentState. O contexto
  # do `setup` (DevAgentState de "task-abc12345") não entra aqui de propósito
  # — é o que prova que este caminho não depende dele.
  describe "run_design (ADR 0090, segundo momento do qa-lead)" do
    test "story inexistente: agent.error com origem modelo, nada mais", %{
      state: state,
      project_id: project_id,
      session_id: session_id
    } do
      Process.put(:fake_backlog, [])

      assert {:noreply, ^state} =
               QaLeadServer.handle_cast({:run_design, session_id, "st-fantasma"}, state)

      assert_received {:event_appended, ^project_id, ^session_id,
                       %{type: "agent.error", payload: payload}}

      assert payload.origem == "modelo"
      assert payload.mensagem =~ "st-fantasma"
      refute_received {:llm_turn, "qa-estrategia", _messages, _tools}
    end

    test "story existente: QaEstrategiaAgent roda e o plano vira artefato", %{
      state: state,
      project_id: project_id,
      session_id: session_id
    } do
      # `QaEstrategiaAgent` roda sem `workspace_root` (ver o moduledoc dele) —
      # o ToolLoop cai no fallback `Workspace.workspace_dir/1`, que lê este
      # env. As demais describes deste arquivo nunca precisaram: o
      # `dev_state.worktree_path` do `setup` já preenche `workspace_root`.
      Application.put_env(:engine, :project_workspaces_root, System.tmp_dir!())
      on_exit(fn -> Application.delete_env(:engine, :project_workspaces_root) end)

      Process.put(:fake_backlog, [epico([story_backlog("st-1")])])
      Process.put(:fake_infra_context, %{"moduleMap" => nil, "adrs" => []})

      Process.put(:fake_llm_turns, [
        FakeEngineApiClient.tool_call_response("read_file", %{"path" => "src/x.ts"}),
        FakeEngineApiClient.tool_call_response("emit_plano_de_teste", %{
          "planoDeTeste" => "cobrir o cadastro",
          "criteriosExecutaveis" => ["dado X, quando Y, então Z"],
          "estrategiaDeAutomacao" => "integração"
        })
      ])

      assert {:noreply, ^state} =
               QaLeadServer.handle_cast({:run_design, session_id, "st-1"}, state)

      assert_received {:event_appended, ^project_id, ^session_id,
                       %{type: "artifact.plano_de_teste", payload: payload}}

      assert payload.storyId == "st-1"
      refute_received {:event_appended, _, _, %{type: "agent.error"}}
    end
  end
end
