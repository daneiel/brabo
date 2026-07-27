defmodule Engine.Dev.WorktreeManagerTest do
  # async: false — mexe em Application env global (:project_workspaces_root) e no
  # filesystem. Não precisa de banco: exercita `add_worktree/3` num work_dir git
  # montado à mão + list/remove/cleanup por workspace_dir.
  use ExUnit.Case, async: false

  alias Engine.Dev.WorktreeManager

  setup do
    root =
      Path.join(
        System.tmp_dir!(),
        "brabo-wt-#{System.os_time(:microsecond)}-#{System.unique_integer([:positive])}"
      )

    project_id = Ecto.UUID.generate()
    work_dir = Path.join(root, project_id)
    File.mkdir_p!(work_dir)

    # Repo git com um commit inicial (worktree add exige HEAD).
    git(work_dir, ["init"])
    git(work_dir, ["config", "user.email", "t@brabo.dev"])
    git(work_dir, ["config", "user.name", "t"])
    File.write!(Path.join(work_dir, "README.md"), "x")
    git(work_dir, ["add", "-A"])
    git(work_dir, ["commit", "-m", "init"])

    Application.put_env(:engine, :project_workspaces_root, root)

    on_exit(fn ->
      Application.delete_env(:engine, :project_workspaces_root)
      File.rm_rf!(root)
    end)

    %{root: root, project_id: project_id, work_dir: work_dir}
  end

  defp git(cd, args) do
    {_, 0} = System.cmd("git", args, cd: cd, stderr_to_stdout: true)
  end

  test "dois agentes trabalham em worktrees paralelos, sem conflito", %{
    project_id: project_id,
    work_dir: work_dir
  } do
    assert {:ok, a} = WorktreeManager.add_worktree(work_dir, "dev-api", "task-a")
    assert {:ok, b} = WorktreeManager.add_worktree(work_dir, "dev-web", "task-b")

    # Worktrees distintos, branches distintas, ambos existem simultaneamente.
    assert a.path != b.path
    assert a.branch == "feature/task-a"
    assert b.branch == "feature/task-b"
    assert File.dir?(a.path)
    assert File.dir?(b.path)

    # Cada um escreve no seu worktree sem pisar no do outro.
    File.write!(Path.join(a.path, "a.txt"), "a")
    File.write!(Path.join(b.path, "b.txt"), "b")
    refute File.exists?(Path.join(a.path, "b.txt"))

    assert Enum.sort(WorktreeManager.list(project_id)) == ["dev-api", "dev-web"]
  end

  test "limpeza de órfãos remove o worktree do agente que não está vivo", %{
    project_id: project_id,
    work_dir: work_dir
  } do
    {:ok, _} = WorktreeManager.add_worktree(work_dir, "dev-api", "task-a")
    {:ok, _} = WorktreeManager.add_worktree(work_dir, "dev-web", "task-b")

    # Só dev-api está "vivo" → dev-web é órfão e some.
    removed = WorktreeManager.cleanup_orphans(project_id, ["dev-api"])

    assert removed == ["dev-web"]
    assert WorktreeManager.list(project_id) == ["dev-api"]
  end
end
