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

  @doc false
  # A regressão que isto pega: `remove_worktree/2` limpava o DIRETÓRIO e deixava
  # a BRANCH para trás. Como o nome dela vem do slug da task, retentar a mesma
  # task caía sempre em `fatal: a branch named 'feature/<slug>' already exists`,
  # e a task ficava presa para sempre — destravar não adiantava. Numa execução
  # real só saiu com cirurgia manual no git.
  test "retentar a MESMA task recria o worktree em vez de falhar", %{work_dir: work_dir} do
    assert {:ok, primeiro} = WorktreeManager.add_worktree(work_dir, "dev-api", "task-a")
    assert primeiro.branch == "feature/task-a"

    # Segunda tentativa da mesma task, mesmo agente: é o caminho do retry.
    assert {:ok, segundo} = WorktreeManager.add_worktree(work_dir, "dev-api", "task-a")
    assert segundo.branch == "feature/task-a"
    assert segundo.path == primeiro.path
    assert File.dir?(segundo.path)
  end

  test "retentar três vezes seguidas continua funcionando", %{work_dir: work_dir} do
    for _ <- 1..3 do
      assert {:ok, _} = WorktreeManager.add_worktree(work_dir, "dev-api", "task-a")
    end
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
