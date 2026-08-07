defmodule Engine.Dev.NoopDevAgentServerTest do
  # DataCase — o server persiste em dev_agent_states. Callbacks exercitados
  # DIRETO no processo de teste (init/1 + handle_cast/2), mesmo idioma do
  # DevAgentServerTest: o fake scriptado por dicionário de processo funciona e
  # o acesso ao banco fica no sandbox do próprio processo.
  use Engine.DataCase, async: false

  alias Engine.Dev.{DevAgentState, FakeWorktreeManager, NoopDevAgentServer}
  alias Engine.Sessions.FakeEngineApiClient

  setup do
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :worktree_manager, FakeWorktreeManager)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :worktree_manager)
      Application.delete_env(:engine, :test_pid)
    end)

    project_id = Ecto.UUID.generate()
    session_id = Ecto.UUID.generate()

    {:ok, state} =
      NoopDevAgentServer.init({project_id, "dev-api", "api", session_id, 500_000, 2, nil, nil})

    %{state: state, project_id: project_id, session_id: session_id}
  end

  test "init grava impl=noop (a reidratação sobe o server certo)", %{
    project_id: project_id
  } do
    row = DevAgentState.get(project_id, "dev-api")

    assert row.impl == "noop"
    assert row.task_budget_micros == 500_000
    assert row.max_gate_corrections == 2
  end

  test "sem task pegável: fica idle, sem propor ações", %{state: state} do
    Process.put(:fake_tasks, [])

    assert {:noreply, _} = NoopDevAgentServer.handle_cast(:work, state)

    assert_received {:event_appended, _, _, %{type: "dev.idle"}}
    refute_received {:propose_action, _, _, _}
  end

  test "ciclo completo: worktree, arquivo trivial, commit com identidade, push e PR", %{
    state: state
  } do
    Process.put(:fake_tasks, [
      %{"id" => "aaaa1111-2222-4333-8444-555555555555", "title" => "Cadastro"}
    ])

    assert {:noreply, new_state} = NoopDevAgentServer.handle_cast(:work, state)

    assert_received {:task_claimed, "api", "dev-api"}
    assert_received {:worktree_created, _, "dev-api", "task-aaaa1111"}

    # O arquivo trivial existe no worktree — é o diff que a PR carrega.
    assert File.exists?(Path.join(new_state.worktree, "NOOP-task-aaaa1111.md"))

    assert_received {:propose_action, "git_commit", _, commit}
    assert commit.author == "dev-api[bot]"
    assert commit.authorEmail == "dev-api-bot@brabo.dev"
    assert commit.coAuthor =~ "Brabo User"
    assert commit.branch == "feature/task-aaaa1111"

    assert_received {:propose_action, "git_push", _, push}
    assert push.branch == "feature/task-aaaa1111"

    assert_received {:propose_action, "pr_open", _, pr}
    assert pr.sourceBranch == "feature/task-aaaa1111"
    assert pr.storyTaskId == "aaaa1111-2222-4333-8444-555555555555"

    assert_received {:task_marked, "aaaa1111-2222-4333-8444-555555555555", "in_review", "dev-api"}
    refute_received {:task_blocked, _, _, _, _}

    assert new_state.task_id == "aaaa1111-2222-4333-8444-555555555555"
    assert new_state.branch == "feature/task-aaaa1111"
  end

  test "não chama LLM nenhum (é o ponto do agente burro)", %{state: state} do
    Process.put(:fake_tasks, [
      %{"id" => "aaaa1111-2222-4333-8444-555555555555", "title" => "Cadastro"}
    ])

    assert {:noreply, _} = NoopDevAgentServer.handle_cast(:work, state)

    refute_received {:llm_turn, _, _, _}
    refute_received {:llm_turn_stream, _, _, _}
    # E nem monta o contexto rico da task, que é insumo de prompt.
    refute_received {:dev_context_fetched, _, _}
  end

  test "abre o gate de verdade, e não só entra em awaiting_gate", %{state: state} do
    # O Noop marcava a task `in_review` e parava aí: `tasks.gate_status` ficava
    # NULL e não havia gate para julgar. A validação da Fase 12 travava
    # esperando esse campo — o defeito morava no instrumento de medida.
    Process.put(:fake_tasks, [
      %{"id" => "aaaa1111-2222-4333-8444-555555555555", "title" => "Cadastro"}
    ])

    assert {:noreply, s} = NoopDevAgentServer.handle_cast(:work, state)

    assert s.status == :awaiting_gate
    assert_received {:gate_opened, "aaaa1111-2222-4333-8444-555555555555", "dev-api"}
  end

  test "sem PR (ação pendente) o gate NÃO abre — RN-050", %{state: state} do
    # Sem PR não há o que julgar. Abrir o gate aqui criaria um gate sobre
    # coisa nenhuma, que é justamente o que a RN-050 proíbe.
    Process.put(:fake_tasks, [
      %{"id" => "aaaa1111-2222-4333-8444-555555555555", "title" => "Cadastro"}
    ])

    Process.put(:fake_propose_action, %{"id" => "pa-77", "status" => "pending"})

    assert {:noreply, s} = NoopDevAgentServer.handle_cast(:work, state)

    assert s.status == :awaiting_approval
    refute_received {:gate_opened, _task_id, _agent}
  end

  test "falha no worktree devolve a task em vez de deixá-la órfã", %{state: state} do
    Process.put(:fake_tasks, [
      %{"id" => "aaaa1111-2222-4333-8444-555555555555", "title" => "Cadastro"}
    ])

    Process.put(:fake_worktree_error, :disco_cheio)

    assert {:noreply, _} = NoopDevAgentServer.handle_cast(:work, state)

    assert_received {:event_appended, _, _, %{type: "dev.error"}}

    assert_received {:task_blocked, "aaaa1111-2222-4333-8444-555555555555",
                     "falha ao preparar o worktree", _, "dev-api"}

    refute_received {:propose_action, "pr_open", _, _}
  end

  test "devolução de gate: bloqueia com diagnóstico em vez de derrubar o processo", %{
    state: state
  } do
    # `:awaiting_gate` é o estado REAL de quem acabou de abrir PR (Fase 12d) —
    # e é o único em que uma devolução faz sentido.
    state = %{
      state
      | task_id: "aaaa1111-2222-4333-8444-555555555555",
        status: :awaiting_gate
    }

    assert {:noreply, _} =
             NoopDevAgentServer.handle_cast(
               {:correct, %{gate: "qa", reason: "suite vermelha", diagnosis: "..."}},
               state
             )

    assert_received {:task_blocked, "aaaa1111-2222-4333-8444-555555555555", reason, _, "dev-api"}
    assert reason =~ "não corrige"
  end

  test "devolução de gate ATRASADA, quando o agente já seguiu, é ignorada", %{state: state} do
    # Mesmo guard do agente real (D4): `correct/3` é um cast puro. Uma entrega
    # tardia rodaria a devolução do gate ANTIGO contra o `task_id` ATUAL —
    # bloquearia uma task que não tem nada a ver com o parecer.
    state = %{state | task_id: "bbbb2222-3333-4444-8555-666666666666", status: :working}

    assert {:noreply, ^state} =
             NoopDevAgentServer.handle_cast(
               {:correct, %{gate: "qa", reason: "suite vermelha", diagnosis: "..."}},
               state
             )

    refute_received {:task_blocked, _, _, _, _}
  end

  describe "reagendamento sem restart (Fase 12d — o Noop entra na 12b)" do
    test "três tasks em SEQUÊNCIA, um agente, zero restarts, termina idle", %{
      state: state,
      project_id: project_id
    } do
      # O critério de aceite da Fase 12b, exercitado pelo veículo sem LLM.
      # Antes da 12d isto era impossível: o Noop parava na primeira.
      Process.put(:fake_tasks, [
        %{"id" => "aaaa1111-2222-4333-8444-555555555555", "title" => "t1"},
        %{"id" => "bbbb2222-3333-4444-8555-666666666666", "title" => "t2"},
        %{"id" => "cccc3333-4444-4555-8666-777777777777", "title" => "t3"}
      ])

      assert {:noreply, s1} = NoopDevAgentServer.handle_cast(:work, state)
      assert s1.status == :awaiting_gate
      assert s1.task_id == "aaaa1111-2222-4333-8444-555555555555"

      # Gate aprova → o agente reivindica a PRÓXIMA sozinho.
      assert {:noreply, s2} =
               NoopDevAgentServer.handle_info(
                 {:gate_resolved, %{task_id: s1.task_id, next_action: "done"}},
                 s1
               )

      assert s2.status == :awaiting_gate
      assert s2.task_id == "bbbb2222-3333-4444-8555-666666666666"

      assert {:noreply, s3} =
               NoopDevAgentServer.handle_info(
                 {:gate_resolved, %{task_id: s2.task_id, next_action: "done"}},
                 s2
               )

      assert s3.task_id == "cccc3333-4444-4555-8666-777777777777"

      # Fila vazia: idle EXPLÍCITO, com o processo vivo e a linha durável
      # dizendo a verdade — não um processo morto.
      assert {:noreply, s4} =
               NoopDevAgentServer.handle_info(
                 {:gate_resolved, %{task_id: s3.task_id, next_action: "done"}},
                 s3
               )

      assert s4.status == :idle
      assert s4.task_id == nil
      assert DevAgentState.get(project_id, "dev-api").status == "idle"
    end

    test "task nova fica pegável e acorda quem está idle", %{state: state} do
      Process.put(:fake_tasks, [])
      assert {:noreply, idle} = NoopDevAgentServer.handle_cast(:work, state)
      assert idle.status == :idle

      Process.put(:fake_tasks, [
        %{"id" => "aaaa1111-2222-4333-8444-555555555555", "title" => "nova"}
      ])

      assert {:noreply, trabalhando} =
               NoopDevAgentServer.handle_info({:wake, :became_claimable}, idle)

      assert trabalhando.task_id == "aaaa1111-2222-4333-8444-555555555555"
    end

    test "wake de task pegável NÃO interrompe quem está em awaiting_gate", %{state: state} do
      ocupado = %{state | status: :awaiting_gate, task_id: "aaaa1111-2222-4333-8444-555555555555"}

      assert {:noreply, ^ocupado} =
               NoopDevAgentServer.handle_info({:wake, :became_claimable}, ocupado)

      refute_received {:task_claimed, _, _}
    end

    test "três blocked seguidas travam o agente em idle_tripped", %{
      state: state,
      project_id: project_id
    } do
      state = %{state | max_consecutive_blocked: 3}

      # Cada volta: o agente está em awaiting_gate e o gate bloqueia. A fila
      # tem sempre uma próxima, então só o breaker pode pará-lo.
      travado =
        Enum.reduce(1..3, state, fn i, acc ->
          Process.put(:fake_tasks, [
            %{"id" => "aaaa1111-2222-4333-8444-55555555555#{i}", "title" => "t#{i}"}
          ])

          acc = %{
            acc
            | status: :awaiting_gate,
              task_id: "aaaa1111-2222-4333-8444-55555555555#{i}"
          }

          {:noreply, novo} =
            NoopDevAgentServer.handle_info(
              {:gate_resolved, %{task_id: acc.task_id, next_action: "blocked"}},
              acc
            )

          novo
        end)

      assert travado.status == :idle_tripped
      assert travado.consecutive_blocked == 3
      assert DevAgentState.get(project_id, "dev-api").status == "idle_tripped"
      assert_received {:event_appended, _, _, %{type: "dev.idle_tripped"}}
    end

    test "aprovado no meio de uma sequência zera o contador do breaker", %{state: state} do
      Process.put(:fake_tasks, [])

      travando = %{
        state
        | status: :awaiting_gate,
          task_id: "aaaa1111-2222-4333-8444-555555555555",
          consecutive_blocked: 2,
          max_consecutive_blocked: 3
      }

      assert {:noreply, zerado} =
               NoopDevAgentServer.handle_info(
                 {:gate_resolved, %{task_id: travando.task_id, next_action: "done"}},
                 travando
               )

      assert zerado.consecutive_blocked == 0
      assert zerado.status == :idle
    end

    test "rearm é a única saída de idle_tripped", %{state: state} do
      Process.put(:fake_tasks, [
        %{"id" => "aaaa1111-2222-4333-8444-555555555555", "title" => "depois do rearm"}
      ])

      travado = %{state | status: :idle_tripped, consecutive_blocked: 3}

      assert {:noreply, solto} = NoopDevAgentServer.handle_info(:rearm, travado)
      assert solto.consecutive_blocked == 0
      assert solto.task_id == "aaaa1111-2222-4333-8444-555555555555"
    end

    test "rearm em agente que não está travado não faz nada", %{state: state} do
      idle = %{state | status: :idle}
      assert {:noreply, ^idle} = NoopDevAgentServer.handle_info(:rearm, idle)
      refute_received {:task_claimed, _, _}
    end
  end

  describe "reidratação nos quatro estados (Fase 12d)" do
    setup %{project_id: project_id, session_id: session_id} do
      %{
        subir: fn resume ->
          {:ok, s} =
            NoopDevAgentServer.init(
              {project_id, "dev-web", "web", session_id, 500_000, 2, 3, resume}
            )

          s
        end
      }
    end

    test "idle e idle_tripped voltam sem task, preservando o contador", %{subir: subir} do
      idle = subir.(%{status: "idle", task_id: nil, worktree_path: nil, consecutive_blocked: 1})
      assert idle.status == :idle
      assert idle.task_id == nil
      # O contador PRECISA sobreviver: senão um restart no meio de uma
      # sequência de blocked zeraria o breaker de graça.
      assert idle.consecutive_blocked == 1

      travado =
        subir.(%{
          status: "idle_tripped",
          task_id: nil,
          worktree_path: nil,
          consecutive_blocked: 3
        })

      assert travado.status == :idle_tripped
      assert travado.consecutive_blocked == 3
    end

    test "awaiting_gate retém task e worktree — um gate tardio ainda os encontra", %{
      subir: subir
    } do
      s =
        subir.(%{
          status: "awaiting_gate",
          task_id: "aaaa1111-2222-4333-8444-555555555555",
          worktree_path: "/data/wt/dev-web",
          consecutive_blocked: 0
        })

      assert s.status == :awaiting_gate
      assert s.task_id == "aaaa1111-2222-4333-8444-555555555555"
      assert s.worktree == "/data/wt/dev-web"
      assert s.branch == "feature/task-aaaa1111"
    end
  end

  test "dois agentes do mesmo projeto trabalham em paralelo sem conflito", %{
    project_id: project_id,
    session_id: session_id
  } do
    {:ok, api} =
      NoopDevAgentServer.init({project_id, "dev-api", "api", session_id, nil, nil, nil, nil})

    {:ok, web} =
      NoopDevAgentServer.init({project_id, "dev-web", "web", session_id, nil, nil, nil, nil})

    Process.put(:fake_tasks, [
      %{"id" => "aaaa1111-2222-4333-8444-555555555555", "title" => "Cadastro"},
      %{"id" => "bbbb2222-3333-4444-8555-666666666666", "title" => "Listagem"}
    ])

    {:noreply, api_state} = NoopDevAgentServer.handle_cast(:work, api)
    {:noreply, web_state} = NoopDevAgentServer.handle_cast(:work, web)

    # Cada um pegou a SUA task, no seu worktree, na sua branch.
    assert api_state.task_id != web_state.task_id
    assert api_state.worktree != web_state.worktree
    assert api_state.branch != web_state.branch

    # E cada worktree só tem o arquivo do seu dono.
    assert File.exists?(Path.join(api_state.worktree, "NOOP-task-aaaa1111.md"))
    refute File.exists?(Path.join(api_state.worktree, "NOOP-task-bbbb2222.md"))
    assert File.exists?(Path.join(web_state.worktree, "NOOP-task-bbbb2222.md"))

    # Duas PRs distintas, uma por branch.
    prs =
      for _ <- 1..2 do
        assert_received {:propose_action, "pr_open", _, pr}
        pr.sourceBranch
      end

    assert Enum.uniq(prs) == prs
  end
end
