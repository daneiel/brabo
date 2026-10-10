defmodule Engine.Dev.TarefaJaNaDevTest do
  @moduledoc """
  RN-797 (AT-474): a task cuja branch não tem diff contra a `dev` (reintegrada
  pela RN-779, código já entrado por outra PR) fecha como "já na dev" — sem
  commit/push/PR, sem gates, sem clique. Com diff, o caminho de sempre.
  """

  use Engine.DataCase, async: false

  alias Engine.Actions.GitCmd
  alias Engine.Dev.{DevAgentServer, FakeWorktreeManager, WorktreeManager}
  alias Engine.Gates.FakeGateDispatcher
  alias Engine.Sessions.FakeEngineApiClient

  describe "DevAgentServer: report_done" do
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
        Application.delete_env(:engine, :fake_sem_diff)
      end)

      project_id = Ecto.UUID.generate()
      container_running!(project_id)

      {:ok, state} =
        DevAgentServer.init(
          {project_id, "dev-api", "api", Ecto.UUID.generate(), nil, nil, 3, nil}
        )

      task = Ecto.UUID.generate()
      Process.put(:fake_tasks, [%{"id" => task, "title" => "Um"}])

      Process.put(:fake_dev_context, %{
        "task" => %{"id" => task, "title" => "Um", "description" => ""},
        "story" => %{"id" => "st", "title" => "x", "description" => ""},
        "businessRules" => [],
        "adrs" => []
      })

      Process.put(:fake_propose_action, %{
        "id" => "pa",
        "status" => "executed",
        "executionResult" => %{"exitCode" => 0, "stdout" => "ok"}
      })

      Process.put(:fake_llm_turns, [
        FakeEngineApiClient.tool_call_response("terminal", %{"command" => "npm test"}),
        FakeEngineApiClient.tool_call_response("report_done", %{"summary" => "pronta"})
      ])

      %{state: state, task: task}
    end

    test "caminho feliz: sem diff, fecha como já na dev, sem PR e sem gate", %{
      state: state,
      task: task
    } do
      Application.put_env(:engine, :fake_sem_diff, true)

      assert {:noreply, _state} = DevAgentServer.handle_cast(:work, state)

      assert_received {:task_marked, ^task, "done", "dev-api"}
      refute_received {:gate_dispatch, :qa, _, ^task}
      refute_received {:propose_action, "pr_open", _, _}
    end

    test "falha (com diff): segue para PR e gate, nunca fecha sozinha", %{
      state: state,
      task: task
    } do
      assert {:noreply, state} = DevAgentServer.handle_cast(:work, state)
      assert state.status == :awaiting_gate
      assert_received {:gate_dispatch, :qa, _, ^task}
      refute_received {:task_marked, ^task, "done", _}
    end
  end

  describe "WorktreeManager.sem_diff_contra_a_dev?/1" do
    setup do
      dir = Path.join(System.tmp_dir!(), "brabo-semdiff-#{System.unique_integer([:positive])}")
      File.mkdir_p!(dir)
      on_exit(fn -> File.rm_rf!(dir) end)
      git!(dir, ["init", "-q", "-b", "dev", "."])
      git!(dir, ["config", "user.email", "t@t"])
      git!(dir, ["config", "user.name", "t"])
      File.write!(Path.join(dir, "a.txt"), "a\n")
      git!(dir, ["add", "-A"])
      git!(dir, ["commit", "-qm", "base"])
      git!(dir, ["checkout", "-q", "-b", "feature/task-x"])
      %{dir: dir}
    end

    test "branch sem commit próprio e árvore limpa: true", %{dir: dir} do
      assert WorktreeManager.sem_diff_contra_a_dev?(dir)
    end

    test "commit próprio ou arquivo sem commit: false; pasta inexistente: false", %{dir: dir} do
      File.write!(Path.join(dir, "b.txt"), "b\n")
      refute WorktreeManager.sem_diff_contra_a_dev?(dir)
      git!(dir, ["add", "-A"])
      git!(dir, ["commit", "-qm", "b"])
      refute WorktreeManager.sem_diff_contra_a_dev?(dir)
      refute WorktreeManager.sem_diff_contra_a_dev?(Path.join(dir, "nao-existe"))
    end
  end

  defp git!(dir, args), do: {:ok, _} = GitCmd.run(dir, args)
end
