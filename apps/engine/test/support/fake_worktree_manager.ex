defmodule Engine.Dev.FakeWorktreeManager do
  @moduledoc "Fake do WorktreeManager pros testes do DevAgentServer — sem git real."

  def create(project_id, agent_id, slug) do
    case Process.get(:fake_worktree_error) do
      nil -> do_create(slug)
      reason -> {:error, reason}
    end
    |> tap(fn _ -> send(self(), {:worktree_created, project_id, agent_id, slug}) end)
  end

  def adopt(project_id, agent_id, slug) do
    case Process.get(:fake_worktree_error) do
      nil -> do_create(slug)
      reason -> {:error, reason}
    end
    |> tap(fn _ -> send(self(), {:worktree_adopted, project_id, agent_id, slug}) end)
  end

  def create_from(project_id, agent_id, slug, base) do
    send(self(), {:worktree_created_from, project_id, agent_id, slug, base})
    do_create(slug)
  end

  def preservar(_project_id, _path, _agent_id, _task_id) do
    Process.get(:fake_preservar, :nada)
  end

  defp do_create(slug) do
    path =
      Path.join(
        System.tmp_dir!(),
        "brabo-fake-wt-#{slug}-#{System.unique_integer([:positive])}"
      )

    File.mkdir_p!(path)
    {:ok, %{path: path, branch: "feature/#{slug}"}}
  end
end
