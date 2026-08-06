defmodule Engine.Dev.DevAgentServerTest do
  # DataCase — o DevAgentServer persiste em dev_agent_states. Callbacks
  # exercitados DIRETO no processo de teste (init/1 + handle_cast/2), então o
  # fake scriptado por dicionário de processo funciona, o ToolLoop real roda
  # síncrono no mesmo processo, e o acesso ao banco fica no sandbox do
  # próprio processo.
  use Engine.DataCase, async: false

  alias Engine.Dev.{DevAgentServer, DevAgentState, FakeWorktreeManager}
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
      Application.delete_env(:engine, :tool_loop_max_iterations)
    end)

    project_id = Ecto.UUID.generate()
    session_id = Ecto.UUID.generate()

    {:ok, state} =
      DevAgentServer.init({project_id, "dev-api", "api", session_id, nil, nil, nil, nil})

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

    assert {:noreply, new_state} = DevAgentServer.handle_cast(:work, state)

    assert_received {:event_appended, _, _, %{type: "dev.idle"}}
    refute_received {:propose_action, _, _, _}
    assert new_state.status == :idle
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
    assert_received {:dev_context_fetched, "task-abc12345", "api"}
    assert_received {:propose_action, "terminal", _, %{command: "npm test"}}
    assert_received {:propose_action, "git_commit", _, commit_payload}
    assert commit_payload.author == "dev-api[bot]"
    assert commit_payload.message == "cadastro implementado"
    assert_received {:propose_action, "git_push", _, _}
    assert_received {:propose_action, "pr_open", _, pr_payload}
    assert pr_payload.title =~ "Cadastro"
    assert pr_payload.body =~ "Definition of Done"
    assert_received {:task_marked, "task-abc12345", "in_review", "dev-api"}
    assert_received {:gate_opened, "task-abc12345", "dev-api"}
    assert_received {:gate_dispatch, :qa, _, "task-abc12345"}
    refute_received {:task_blocked, _, _, _, _}

    # Fase 12b: PR aberta NÃO libera o agente — o worktree é por agente, não
    # por task, e o gate ainda vai varrê-lo. task_id/worktree/branch ficam
    # intactos até um `task.gate_resolved` terminal chegar (fora de escopo
    # aqui: nada dispara isso ainda).
    assert new_state.task_id == "task-abc12345"
    assert new_state.status == :awaiting_gate
    assert new_state.worktree != nil
    assert new_state.branch != nil

    assert_received {:event_appended, _, _,
                     %{
                       type: "dev.awaiting_gate",
                       payload: %{taskId: "task-abc12345", gate: "qa"}
                     }}
  end

  test "persist não apaga os tetos gravados no init", %{
    project_id: project_id,
    session_id: session_id
  } do
    # A coluna max_gate_corrections está na lista de :replace do on_conflict:
    # omiti-la no upsert do persist/1 a zerava no primeiro ciclo de task, e os
    # gates (que leem o campo do banco) caíam no default da api.
    {:ok, state} =
      DevAgentServer.init({project_id, "dev-web", "web", session_id, 500_000, 1, nil, nil})

    Process.put(:fake_tasks, [%{"id" => "task-tetos123", "title" => "T"}])
    Application.put_env(:engine, :tool_loop_max_iterations, 1)

    Process.put(
      :fake_llm_always,
      FakeEngineApiClient.tool_call_response("search_workspace", %{"query" => "x"})
    )

    assert {:noreply, _} = DevAgentServer.handle_cast(:work, state)

    # Fase 12b: task-tetos123 bloqueia (limite de iterações) e o agente já
    # tenta a próxima — fila vazia, volta a idle, e a linha reflete isso.
    # O que este teste prova continua valendo: os tetos sobrevivem ao
    # upsert do :replace, mesmo depois de mais de um persist/1 na sequência.
    row = DevAgentState.get(project_id, "dev-web")
    assert row.task_id == nil
    assert row.status == "idle"
    assert row.max_gate_corrections == 1
    assert row.task_budget_micros == 500_000
  end

  test "falha ao montar o worktree: devolve a task e tenta reivindicar a próxima", %{
    state: state
  } do
    # A task já foi reivindicada (in_progress na api) quando o worktree é
    # montado. Se a criação falhar e ninguém devolver a task, ela fica sem
    # dono vivo e invisível pro claim, que só pega `todo`.
    Process.put(:fake_tasks, [%{"id" => "task-semwt12", "title" => "T"}])
    Process.put(:fake_worktree_error, "could not lock config file .git/config")

    assert {:noreply, new_state} = DevAgentServer.handle_cast(:work, state)

    assert_received {:event_appended, _, _, %{type: "dev.error"}}
    assert_received {:task_blocked, "task-semwt12", "falha ao preparar o worktree", _, "dev-api"}
    refute_received {:propose_action, _, _, _}

    # Fase 12b: task devolvida não fica presa no state — finish_task/2 zera
    # os campos e o agente já tenta a próxima (fila vazia → volta a idle).
    assert new_state.task_id == nil
    assert new_state.status == :idle
    assert new_state.consecutive_blocked == 1
    assert_received {:event_appended, _, _, %{type: "dev.idle"}}
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

    # A origem vem junto e é `modelo`: o teto foi gasto pelo modelo, que
    # continuou pedindo ferramenta sem concluir. Antes o evento saía com
    # `"indeterminada"`, que não aponta ação nenhuma (Fase G, achados P/Q/T).
    assert_received {:event_appended, _, _,
                     %{
                       type: "dev.blocked",
                       payload: %{reason: "limite de iterações atingido", origem: "modelo"}
                     }}

    assert_received {:task_blocked, "task-impossivel", "limite de iterações atingido", _,
                     "dev-api"}

    refute_received {:propose_action, "pr_open", _, _}
    refute_received {:task_marked, _, "in_review", _}

    assert new_state.task_id == nil
    assert new_state.status == :idle
  end

  test "suite vermelha até o limite de iterações: blocked com a saída do teste que falhou", %{
    state: state
  } do
    # O caminho que o enunciado descreve — "se após N iterações não conseguir".
    # O agente insiste em rodar a suite e ela sempre falha; o diagnóstico
    # precisa carregar a saída do ÚLTIMO terminal, senão o usuário recebe um
    # bloqueio sem nada pra agir em cima.
    Application.put_env(:engine, :tool_loop_max_iterations, 2)
    Process.put(:fake_tasks, [%{"id" => "task-vermelha", "title" => "Suite quebrada"}])

    Process.put(:fake_propose_action, %{
      "id" => "pa-red",
      "status" => "executed",
      "executionResult" => %{
        "exitCode" => 1,
        "stdout" => "FAIL src/cadastro.spec.ts > e-mail único\nexpected 201, got 500"
      }
    })

    Process.put(
      :fake_llm_always,
      FakeEngineApiClient.tool_call_response("terminal", %{"command" => "pnpm test"})
    )

    assert {:noreply, _} = DevAgentServer.handle_cast(:work, state)

    assert_received {:task_blocked, "task-vermelha", "limite de iterações atingido", diagnosis,
                     "dev-api"}

    assert diagnosis =~ "expected 201, got 500",
           "o diagnóstico não carregou a saída da suite que falhou: #{inspect(diagnosis)}"

    # E o principal: PR vermelha NUNCA é aberta.
    refute_received {:propose_action, "pr_open", _, _}
    refute_received {:task_marked, _, "in_review", _}
  end

  test "bloqueio grava o artefato task_blocked (não só o evento de narrativa)", %{state: state} do
    Application.put_env(:engine, :tool_loop_max_iterations, 1)
    Process.put(:fake_tasks, [%{"id" => "task-artefato", "title" => "Tarefa impossível"}])

    Process.put(
      :fake_llm_always,
      FakeEngineApiClient.tool_call_response("search_workspace", %{"query" => "x"})
    )

    assert {:noreply, _} = DevAgentServer.handle_cast(:work, state)

    assert_received {:event_appended, _, _, %{type: "artifact.task_blocked", payload: payload}}

    assert payload.taskId == "task-artefato"
    assert payload.agentId == "dev-api"
    assert payload.reason == "limite de iterações atingido"
    assert is_binary(payload.diagnosis)

    # Nenhum erro de validação de artefato foi emitido.
    refute_received {:event_appended, _, _,
                     %{type: "dev.error", payload: %{reason: "artefato" <> _}}}
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
                     %{
                       type: "dev.blocked",
                       payload: %{
                         reason: "orçamento de tokens excedido",
                         # POLÍTICA: o teto foi decidido por quem configurou, e
                         # recusar é o produto cumprindo a regra. Nada quebrou.
                         origem: "politica"
                       }
                     }}

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

  describe "correct/3 (devolução de gate — mesma branch/worktree, sem nova PR)" do
    setup %{state: state} do
      # Simula que o dev já passou por run_task antes (worktree/branch/task_id
      # já setados) — correct/3 reaproveita, nunca chama worktree_manager().
      original_worktree = "/tmp/brabo-fake-existing-worktree"

      state = %{
        state
        | task_id: "task-abc12345",
          worktree: original_worktree,
          branch: "feature/task-abc12345",
          # É o estado REAL de quem recebe uma devolução de gate: a PR está
          # aberta e o agente espera o veredito. Virou guard em `correct/3`
          # na correção D4 — um cast tardio, chegando quando o agente já
          # seguiu para outra task, rodaria a correção do gate ANTIGO contra
          # a task ATUAL.
          status: :awaiting_gate
      }

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

      %{state: state, original_worktree: original_worktree}
    end

    test "report_done na correção: só commit+push (SEM nova PR), dispara o gate de volta", %{
      state: state,
      original_worktree: original_worktree
    } do
      Process.put(:fake_propose_action, terminal_ok())

      Process.put(:fake_llm_turns, [
        FakeEngineApiClient.tool_call_response("terminal", %{"command" => "npm test"}),
        FakeEngineApiClient.tool_call_response("report_done", %{"summary" => "corrigido"})
      ])

      findings = %{gate: "qa", reason: "regra sem teste", diagnosis: "regra X sem cobertura"}

      assert {:noreply, new_state} = DevAgentServer.handle_cast({:correct, findings}, state)

      # worktree NUNCA foi recriado — prova que correct/3 não chama
      # worktree_manager().create/3 (run_task chamaria e geraria um path novo).
      assert new_state.worktree == original_worktree

      assert_received {:propose_action, "git_commit", _, commit_payload}
      assert commit_payload.message == "corrigido"
      assert_received {:propose_action, "git_push", _, _}
      refute_received {:propose_action, "pr_open", _, _}

      assert_received {:gate_dispatch, :qa, _, "task-abc12345"}

      # Fase 12b: volta a awaiting_gate (não idle) — a task segue aberta até
      # o gate resolver de novo.
      assert new_state.status == :awaiting_gate
      assert new_state.task_id == "task-abc12345"

      assert_received {:event_appended, _, _,
                       %{
                         type: "dev.awaiting_gate",
                         payload: %{taskId: "task-abc12345", gate: "qa"}
                       }}
    end

    test "report_blocked na correção: bloqueia igual ao fluxo original", %{state: state} do
      Process.put(:fake_llm_turns, [
        FakeEngineApiClient.tool_call_response("report_blocked", %{
          "reason" => "não consegui corrigir",
          "diagnosis" => "o teste ainda falha por outro motivo"
        })
      ])

      findings = %{gate: "secops", reason: "segredo encontrado", diagnosis: "arquivo x linha y"}

      assert {:noreply, new_state} = DevAgentServer.handle_cast({:correct, findings}, state)

      assert_received {:task_blocked, "task-abc12345", "não consegui corrigir", _, "dev-api"}
      refute_received {:propose_action, "pr_open", _, _}
      refute_received {:gate_dispatch, _, _, _}

      # Fase 12b: bloqueio na correção também libera o agente (finish_task/2)
      # — sem fake_tasks configurado, cai direto em idle.
      assert new_state.task_id == nil
      assert new_state.status == :idle
      assert_received {:event_appended, _, _, %{type: "dev.idle"}}
    end
  end

  describe "aprovação pendente não abre gate (Fase 12e — causa raiz do D5)" do
    # O defeito: `AgentIo.propose/3` descartava o status, então com a autonomia
    # do dev em `require_approval` as três ações git ficavam `pending` e o gate
    # abria assim mesmo. O QA varria o WORKTREE (os arquivos estão lá),
    # aprovava, a task fechava — e a PR nunca existiu.
    defp roda_ate_report_done(state) do
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

      Process.put(:fake_llm_turns, [
        FakeEngineApiClient.tool_call_response("terminal", %{"command" => "npm test"}),
        FakeEngineApiClient.tool_call_response("report_done", %{"summary" => "feito"})
      ])

      DevAgentServer.handle_cast(:work, state)
    end

    test "git pendente: NÃO abre o gate e fica em awaiting_approval", %{
      state: state,
      project_id: project_id
    } do
      # O terminal executa (o `report_done` exige exit 0 antes), mas as três
      # ações git ficam pendentes de aprovação — a configuração exata do
      # defeito.
      Process.put(:fake_propose_action, terminal_ok())

      Process.put(:fake_propose_action_by_type, %{
        "git_commit" => %{"id" => "pa-c", "status" => "pending"},
        "git_push" => %{"id" => "pa-p", "status" => "pending"},
        "pr_open" => %{"id" => "pa-r", "status" => "pending"}
      })

      assert {:noreply, novo} = roda_ate_report_done(state)

      assert novo.status == :awaiting_approval
      assert novo.task_id == "task-abc12345"
      # O worktree fica RETIDO — é onde o trabalho está.
      assert novo.worktree != nil

      # O coração: sem PR, nada de gate.
      refute_received {:gate_opened, _, _}
      refute_received {:gate_dispatch, :qa, _, _}
      assert DevAgentState.get(project_id, "dev-api").status == "awaiting_approval"
      assert_received {:event_appended, _, _, %{type: "dev.awaiting_approval"}}
    end

    test "pr_settled(opened: true) abre o gate, tarde mas correto", %{state: state} do
      esperando = %{state | status: :awaiting_approval, task_id: "task-abc12345"}

      assert {:noreply, novo} =
               DevAgentServer.handle_info(
                 {:pr_settled, %{task_id: "task-abc12345", opened: true}},
                 esperando
               )

      assert novo.status == :awaiting_gate
      assert_received {:gate_opened, "task-abc12345", "dev-api"}
      assert_received {:gate_dispatch, :qa, _, "task-abc12345"}
    end

    test "pr_settled(opened: false) devolve a task com diagnóstico, sem contar no breaker", %{
      state: state
    } do
      Process.put(:fake_tasks, [])

      esperando = %{
        state
        | status: :awaiting_approval,
          task_id: "task-abc12345",
          consecutive_blocked: 0
      }

      assert {:noreply, novo} =
               DevAgentServer.handle_info(
                 {:pr_settled, %{task_id: "task-abc12345", opened: false}},
                 esperando
               )

      assert_received {:task_blocked, "task-abc12345", "a PR não foi aberta", _, "dev-api"}
      # A decisão foi do USUÁRIO — não é o agente queimando o teto.
      assert novo.consecutive_blocked == 0
      refute_received {:gate_opened, _, _}
    end

    test "pr_settled de OUTRA task é ignorado", %{state: state} do
      esperando = %{state | status: :awaiting_approval, task_id: "task-abc12345"}

      assert {:noreply, ^esperando} =
               DevAgentServer.handle_info(
                 {:pr_settled, %{task_id: "task-outra", opened: true}},
                 esperando
               )

      refute_received {:gate_opened, _, _}
    end

    test "pr_settled em quem NÃO está esperando aprovação é ignorado", %{state: state} do
      trabalhando = %{state | status: :working, task_id: "task-abc12345"}

      assert {:noreply, ^trabalhando} =
               DevAgentServer.handle_info(
                 {:pr_settled, %{task_id: "task-abc12345", opened: true}},
                 trabalhando
               )

      refute_received {:gate_opened, _, _}
    end
  end

  describe "circuit breaker (Fase 12b, RN-047)" do
    test "3 blocks consecutivos → idle_tripped, sem tentar reivindicar de novo", %{
      state: state
    } do
      state = %{state | max_consecutive_blocked: 3}

      Process.put(:fake_tasks, [
        %{"id" => "task-b1", "title" => "T1"},
        %{"id" => "task-b2", "title" => "T2"},
        %{"id" => "task-b3", "title" => "T3"}
      ])

      Process.put(:fake_dev_context, %{
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
      })

      Process.put(
        :fake_llm_always,
        FakeEngineApiClient.tool_call_response("report_blocked", %{
          "reason" => "sempre falha",
          "diagnosis" => "propositalmente"
        })
      )

      assert {:noreply, new_state} = DevAgentServer.handle_cast(:work, state)

      assert new_state.status == :idle_tripped
      assert new_state.consecutive_blocked == 3
      assert new_state.task_id == nil

      assert_received {:event_appended, _, _,
                       %{type: "dev.idle_tripped", payload: %{consecutiveBlocked: 3}}}

      # Se o breaker não tivesse parado ANTES de uma 4ª tentativa, a fila
      # vazia teria emitido "dev.idle" em vez de "dev.idle_tripped".
      refute_received {:event_appended, _, _,
                       %{type: "dev.idle", payload: %{reason: "sem task pegável"}}}
    end

    test "orçamento por task não vaza entre reivindicações da mesma sequência", %{
      state: state
    } do
      # Cada task blocked tenta a próxima IMEDIATAMENTE (mesma chamada de
      # handle_cast) — requisito 4 do CLAUDE.md: o teto por task continua
      # vindo fresco de state.task_budget_micros a cada ToolLoop.run/1, nunca
      # acumulado ou decrementado entre tasks.
      state = %{state | task_budget_micros: 500_000}

      Process.put(:fake_tasks, [
        %{"id" => "task-cara-1", "title" => "T1"},
        %{"id" => "task-cara-2", "title" => "T2"}
      ])

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

      assert {:noreply, new_state} = DevAgentServer.handle_cast(:work, state)

      assert new_state.consecutive_blocked == 2
      assert new_state.task_budget_micros == 500_000

      diagnoses =
        for _ <- 1..2 do
          assert_received {:task_blocked, _, "orçamento de tokens excedido", diagnosis, "dev-api"}
          diagnosis
        end

      # Os dois diagnósticos carregam o MESMO teto — nenhum decremento vazou
      # da primeira task pra segunda.
      assert Enum.all?(diagnoses, &(&1 =~ "teto: 500000"))
    end
  end

  describe "guardas do correct/3 (D4 — revisão da Fase 12b)" do
    test "correct entregue tarde (agente já em outra task) é IGNORADO", %{state: state} do
      # `correct/3` é um cast puro disparado pelos gates. Sem o guard, uma
      # entrega atrasada rodava a correção do gate ANTIGO contra o task_id
      # ATUAL — corrompendo trabalho em curso.
      state = %{state | status: :working, task_id: "task-nova"}

      assert {:noreply, unchanged} =
               DevAgentServer.handle_cast(
                 {:correct, %{gate: "qa", reason: "do gate antigo", diagnosis: "..."}},
                 state
               )

      assert unchanged == state
      refute_received {:dev_context_fetched, _, _}
      refute_received {:propose_action, _, _, _}
    end

    test "falha ao montar o contexto da correção BLOQUEIA a task em vez de travar o agente", %{
      state: state
    } do
      state = %{
        state
        | status: :awaiting_gate,
          task_id: "task-abc12345",
          worktree: "/wt",
          branch: "b"
      }

      # `reply/2` do fake já repassa `{:error, _}` — não precisa de chave nova.
      Process.put(:fake_dev_context, {:error, :indisponivel})

      assert {:noreply, novo} =
               DevAgentServer.handle_cast(
                 {:correct, %{gate: "qa", reason: "x", diagnosis: "y"}},
                 state
               )

      assert_received {:event_appended, _, _, %{type: "dev.error"}}

      assert_received {:task_blocked, "task-abc12345", "falha ao montar contexto da correção", _,
                       "dev-api"}

      # O que importa: NÃO ficou preso em `:working` com task_id setado, que
      # era um estado do qual nenhum handle_info resgatava.
      assert novo.task_id == nil
      assert novo.status == :idle
    end
  end

  describe "falha do claim (D1 — revisão da Fase 12b)" do
    test "claim que falha deixa o agente ACORDÁVEL, não travado para sempre", %{
      state: state
    } do
      # O agente termina uma task aprovada e vai reivindicar a próxima —
      # mas a api devolve erro. Antes da correção o state voltava intocado:
      # `finish_task/2` já tinha zerado `task_id`, mas `status` continuava
      # `:awaiting_gate`, e a partir daí NENHUM dos três handle_info agia.
      state = %{state | status: :awaiting_gate, task_id: "task-a", worktree: "/wt", branch: "b"}
      Process.put(:fake_claim_error, :timeout)

      assert {:noreply, apos_erro} =
               DevAgentServer.handle_info(
                 {:gate_resolved, %{task_id: "task-a", next_action: "done"}},
                 state
               )

      assert apos_erro.status == :idle
      assert_received {:event_appended, _, _, %{type: "dev.error"}}

      # A prova que importa: um wake seguinte AINDA resgata o agente.
      Process.delete(:fake_claim_error)
      Process.put(:fake_tasks, [%{"id" => "task-b", "title" => "B"}])

      assert {:noreply, _} = DevAgentServer.handle_info({:wake, :became_claimable}, apos_erro)

      assert_received {:task_claimed, "api", "dev-api"}
    end

    test "o estado recuperável também é PERSISTIDO — senão a reidratação ressuscita o travamento",
         %{state: state, project_id: project_id} do
      state = %{state | status: :awaiting_gate, task_id: "task-a"}
      Process.put(:fake_claim_error, :timeout)

      assert {:noreply, _} =
               DevAgentServer.handle_info(
                 {:gate_resolved, %{task_id: "task-a", next_action: "done"}},
                 state
               )

      row = DevAgentState.get(project_id, "dev-api")
      assert row.status == "idle"
      assert row.task_id == nil
    end
  end

  describe "rearm (Fase 12b — RN-047)" do
    test ":rearm em idle_tripped zera o contador e tenta reivindicar", %{state: state} do
      state = %{
        state
        | status: :idle_tripped,
          consecutive_blocked: 3,
          max_consecutive_blocked: 3
      }

      Process.put(:fake_tasks, [])

      assert {:noreply, new_state} = DevAgentServer.handle_info(:rearm, state)

      assert new_state.status == :idle
      assert new_state.consecutive_blocked == 0
      assert_received {:event_appended, _, _, %{type: "dev.idle"}}
    end

    test ":rearm fora de idle_tripped é no-op — não é a saída certa de nenhum outro estado", %{
      state: state
    } do
      state = %{state | status: :awaiting_gate, task_id: "task-x", consecutive_blocked: 1}

      assert {:noreply, unchanged} = DevAgentServer.handle_info(:rearm, state)

      assert unchanged == state
      refute_received {:task_claimed, _, _}
    end
  end
end
