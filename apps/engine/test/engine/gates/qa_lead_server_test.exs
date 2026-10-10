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
      worktree_path: pasta_temporaria_propria!(),
      status: "working"
    })

    # ADR 0192 (RN-674): todo ciclo começa pelo plano de teste da entrega,
    # com a QA-estratégia no MESMO processo. Fila PRÓPRIA dela — os turnos
    # que cada teste escreve em `:fake_llm_turns` continuam sendo da
    # Automação e da Performance/Segurança, como sempre foram.
    Process.put(:fake_llm_turns_por_agente, %{
      "qa-estrategia" => [ler_entrega(), emitir_plano()]
    })

    {:ok, state} = QaLeadServer.init(project_id)
    %{project_id: project_id, session_id: session_id, state: state}
  end

  defp ler_entrega,
    do: FakeEngineApiClient.tool_call_response("read_file", %{"path" => "src/cadastro.ts"})

  defp emitir_plano do
    FakeEngineApiClient.tool_call_response("emit_plano_de_teste", %{
      "planoDeTeste" => "cobrir o cadastro entregue",
      "criteriosExecutaveis" => ["dado e-mail novo, quando cadastra, então cria a conta"],
      "estrategiaDeAutomacao" => "integração na api"
    })
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

    # AT-248 / RN-629 — o laço retomado PODE suspender de novo (o subagente
    # roda vários comandos, cada um pede aprovação). Antes o `{:awaiting, _}`
    # da RETOMADA entrava em `colhidos` como se fosse resultado e derrubava
    # `registrar_resultado/5` (FunctionClauseError) — as tasks ficavam em
    # `awaiting_qa` para sempre.
    test "segunda suspensão na retomada: registra como suspenso, não cai, e retoma depois",
         %{state: state, project_id: project_id} do
      Process.put(:fake_dev_context, dev_context([]))
      Process.put(:fake_propose_action, %{"id" => "pa-1", "status" => "pending"})

      Process.put(:fake_llm_turns, [
        FakeEngineApiClient.tool_call_response("terminal", %{"command" => "npm install"})
      ])

      assert {:noreply, suspenso} = QaLeadServer.handle_cast({:run, "task-abc12345"}, state)

      # A retomada pede OUTRA aprovação.
      Process.put(:fake_propose_action, %{"id" => "pa-2", "status" => "pending"})

      Process.put(:fake_llm_turns, [
        FakeEngineApiClient.tool_call_response("terminal", %{"command" => "npm test"})
      ])

      assert {:noreply, suspenso2} =
               QaLeadServer.handle_info(
                 {:action_settled,
                  %{action_id: "pa-1", status: "executed", execution_result: %{"exitCode" => 0}}},
                 suspenso
               )

      # Continua suspenso, agora pela segunda ação; nada foi decidido.
      assert suspenso2.pendente.action_id == "pa-2"
      assert suspenso2.pendente.delegacao.subagent == "qa-automacao"
      refute_received {:gate_verdict_recorded, _, _, _, _, _, _}
      refute_received {:task_blocked, _, _, _, _}
      refute_received {:delegation_recorded, %{status: "completed"}}
      refute_received {:delegation_recorded, %{status: "failed"}}

      row = GateState.get(project_id, "task-abc12345", "qa")
      assert row.step == "in_progress"
      assert row.subagent == "qa-automacao"

      # A segunda decisão chega e a área conclui.
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
                  %{action_id: "pa-2", status: "executed", execution_result: %{"exitCode" => 0}}},
                 suspenso2
               )

      assert retomado.pendente == nil
      assert_received {:gate_verdict_recorded, _, _, _, _, _, _}
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

  # ADR 0192 (RN-674) — o plano de teste nasce DEPOIS da entrega, como
  # primeiro passo do ciclo de sempre (`run/2`), e é INSUMO do gate
  # `qa-verificada`: nunca um segundo veredito, nunca uma trava nova.
  describe "plano de teste da entrega (ADR 0192)" do
    defp aprovar_automacao do
      [
        FakeEngineApiClient.tool_call_response("terminal", %{"command" => "npm test"}),
        FakeEngineApiClient.tool_call_response("emit_qa_verdict", %{
          "veredito" => "approved",
          "resumo" => "cobertura completa",
          "itens" => [],
          "coverageMatrix" => []
        })
      ]
    end

    defp conteudos(messages) do
      Enum.map(messages, fn m ->
        case Map.get(m, "content") do
          c when is_binary(c) -> c
          _ -> ""
        end
      end)
    end

    defp plano_emitido(task_id) do
      %{
        "type" => "artifact.plano_de_teste",
        "payload" => %{
          "storyId" => "st-1",
          "taskId" => task_id,
          "planoDeTeste" => "plano JÁ escrito na rodada anterior",
          "criteriosExecutaveis" => ["dado X, quando Y, então Z"],
          "estrategiaDeAutomacao" => "unidade"
        }
      }
    end

    test "o plano roda ANTES da Automação, sobre a entrega, e entra na mensagem dela", %{
      state: state,
      project_id: project_id,
      session_id: session_id
    } do
      Process.put(:fake_dev_context, dev_context([]))
      Process.put(:fake_propose_action, terminal_ok())
      Process.put(:fake_llm_turns, aprovar_automacao())
      Process.put(:fake_gate_verdict_response, %{"nextAction" => "run_secops"})

      assert {:noreply, _} = QaLeadServer.handle_cast({:run, "task-abc12345"}, state)

      # O plano é da ENTREGA: carrega a task, e vai para a sessão do dev.
      assert_received {:event_appended, ^project_id, ^session_id,
                       %{type: "artifact.plano_de_teste", payload: plano}}

      assert plano.taskId == "task-abc12345"
      assert plano.storyId == "st-1"

      # A lista de arquivos da entrega vai na mensagem do plano — aqui o
      # projeto não tem repositório, e o texto DIZ que não listou, em vez de
      # uma lista vazia que pareceria "a entrega não tocou nada".
      assert_received {:llm_turn, "qa-estrategia", msgs_do_plano, _tools}
      assert Enum.any?(conteudos(msgs_do_plano), &(&1 =~ "não consegui listar"))

      assert_received {:llm_turn, "qa-automacao", msgs_da_automacao, _tools}
      assert Enum.any?(conteudos(msgs_da_automacao), &(&1 =~ "cobrir o cadastro entregue"))

      # O contrato externo não muda: UM veredito de QA.
      assert_received {:gate_verdict_recorded, "task-abc12345", "qa", "approved", _r, _i, nil}
    end

    test "a rodada de correção REUSA o plano da mesma task — nenhum laço novo", %{
      state: state,
      session_id: session_id
    } do
      Process.put(:fake_events, [plano_emitido("task-abc12345")])
      Process.put(:fake_dev_context, dev_context([]))
      Process.put(:fake_propose_action, terminal_ok())
      Process.put(:fake_llm_turns, aprovar_automacao())
      Process.put(:fake_gate_verdict_response, %{"nextAction" => "run_secops"})

      assert {:noreply, _} = QaLeadServer.handle_cast({:run, "task-abc12345"}, state)

      refute_received {:llm_turn, "qa-estrategia", _messages, _tools}
      refute_received {:event_appended, _, ^session_id, %{type: "artifact.plano_de_teste"}}

      assert_received {:llm_turn, "qa-automacao", msgs_da_automacao, _tools}

      assert Enum.any?(
               conteudos(msgs_da_automacao),
               &(&1 =~ "plano JÁ escrito na rodada anterior")
             )
    end

    test "plano de OUTRA task não conta: a entrega ganha o próprio", %{state: state} do
      Process.put(:fake_events, [plano_emitido("task-outra")])
      Process.put(:fake_dev_context, dev_context([]))
      Process.put(:fake_propose_action, terminal_ok())
      Process.put(:fake_llm_turns, aprovar_automacao())
      Process.put(:fake_gate_verdict_response, %{"nextAction" => "run_secops"})

      assert {:noreply, _} = QaLeadServer.handle_cast({:run, "task-abc12345"}, state)

      assert_received {:llm_turn, "qa-estrategia", _messages, _tools}

      assert_received {:event_appended, _, _,
                       %{type: "artifact.plano_de_teste", payload: %{taskId: "task-abc12345"}}}
    end

    # O sintoma do uso real (`toolloop.limit_reached` sem plano) continua
    # POSSÍVEL — o teto segue 8, de propósito. O que ele não pode é segurar a
    # revisão nem passar calado.
    test "plano que falha: agent.error com origem, e a revisão segue SEM ele", %{
      state: state,
      project_id: project_id,
      session_id: session_id
    } do
      Process.put(:fake_llm_turns_por_agente, %{
        "qa-estrategia" => [FakeEngineApiClient.final_response("não sei o que fazer")]
      })

      Process.put(:fake_dev_context, dev_context([]))
      Process.put(:fake_propose_action, terminal_ok())
      Process.put(:fake_llm_turns, aprovar_automacao())
      Process.put(:fake_gate_verdict_response, %{"nextAction" => "run_secops"})

      assert {:noreply, _} = QaLeadServer.handle_cast({:run, "task-abc12345"}, state)

      assert_received {:event_appended, ^project_id, ^session_id,
                       %{type: "agent.error", actorId: "qa-estrategia", payload: falha}}

      assert falha.origem == "modelo"
      refute_received {:event_appended, _, _, %{type: "artifact.plano_de_teste"}}

      assert_received {:llm_turn, "qa-automacao", msgs_da_automacao, _tools}
      refute Enum.any?(conteudos(msgs_da_automacao), &(&1 =~ "Plano de teste da QA-estratégia"))

      assert_received {:gate_verdict_recorded, "task-abc12345", "qa", "approved", _r, _i, nil}
    end
  end

  # RN-806 (AT-478): no uso real o resgate pediu o ciclo DUAS vezes no mesmo
  # instante; o segundo rodou depois do veredito do primeiro e gravou parecer
  # contrário ao que já tinha valido.
  describe "um ciclo por task+gate" do
    test "pedido repetido que esperava na caixa é descartado ao fim do ciclo", %{state: state} do
      Process.put(:fake_dev_context, dev_context([]))
      Process.put(:fake_propose_action, terminal_ok())

      Process.put(:fake_llm_turns, [
        FakeEngineApiClient.tool_call_response("terminal", %{"command" => "npm test"}),
        FakeEngineApiClient.tool_call_response("emit_qa_verdict", %{
          "veredito" => "approved",
          "resumo" => "ok",
          "itens" => [],
          "coverageMatrix" => []
        })
      ])

      Process.put(:fake_gate_verdict_response, %{"nextAction" => "run_secops"})

      # O pedido duplicado, já na caixa do processo do Lead.
      send(self(), {:"$gen_cast", {:run, "task-abc12345"}})
      # Pedido de OUTRA task não é tocado.
      send(self(), {:"$gen_cast", {:run, "task-outra"}})

      assert {:noreply, _} = QaLeadServer.handle_cast({:run, "task-abc12345"}, state)

      refute_received {:"$gen_cast", {:run, "task-abc12345"}}
      assert_received {:"$gen_cast", {:run, "task-outra"}}
    end

    test "pedido para a task com ciclo suspenso não abre um segundo", %{state: state} do
      suspenso = %{state | pendente: %{task_id: "task-abc12345", action_id: "pa-9"}}

      assert {:noreply, ^suspenso} = QaLeadServer.handle_cast({:run, "task-abc12345"}, suspenso)
      refute_received {:llm_turn, _, _, _}
    end
  end
end
