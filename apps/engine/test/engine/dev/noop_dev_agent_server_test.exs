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
      NoopDevAgentServer.init({project_id, "dev-api", "api", session_id, 500_000, 2, nil})

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
    state = %{state | task_id: "aaaa1111-2222-4333-8444-555555555555"}

    assert {:noreply, _} =
             NoopDevAgentServer.handle_cast(
               {:correct, %{gate: "qa", reason: "suite vermelha", diagnosis: "..."}},
               state
             )

    assert_received {:task_blocked, "aaaa1111-2222-4333-8444-555555555555", reason, _, "dev-api"}
    assert reason =~ "não corrige"
  end

  test "dois agentes do mesmo projeto trabalham em paralelo sem conflito", %{
    project_id: project_id,
    session_id: session_id
  } do
    {:ok, api} =
      NoopDevAgentServer.init({project_id, "dev-api", "api", session_id, nil, nil, nil})

    {:ok, web} =
      NoopDevAgentServer.init({project_id, "dev-web", "web", session_id, nil, nil, nil})

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
