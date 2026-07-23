defmodule Engine.Actions.WorkspaceTest do
  use ExUnit.Case, async: true

  alias Engine.Actions.Workspace

  setup do
    root =
      Path.join(System.tmp_dir!(), "brabo-workspace-test-#{System.unique_integer([:positive])}")

    File.mkdir_p!(root)
    Application.put_env(:engine, :project_workspaces_root, root)
    on_exit(fn -> File.rm_rf!(root) end)
    :ok
  end

  # System.unique_integer/1 reinicia a cada VM (cada `mix test`) — rodar a
  # suite muitas vezes em sequência rápida colide em paths de /tmp de
  # execuções anteriores (causou flakiness real). os_time garante
  # unicidade entre processos de VM diferentes.
  defp unique_tmp_name(prefix) do
    "#{prefix}-#{System.os_time(:microsecond)}-#{System.unique_integer([:positive])}"
  end

  defp create_bare_repo!(with_commit?) do
    bare_dir = Path.join(System.tmp_dir!(), unique_tmp_name("brabo-bare") <> ".git")
    on_exit(fn -> File.rm_rf!(bare_dir) end)

    {_, 0} = System.cmd("git", ["init", "--bare", bare_dir])

    if with_commit? do
      clone_dir = Path.join(System.tmp_dir!(), unique_tmp_name("brabo-clone"))

      {_, 0} = System.cmd("git", ["clone", bare_dir, clone_dir])
      File.write!(Path.join(clone_dir, "README.md"), "oi")
      {_, 0} = System.cmd("git", ["add", "."], cd: clone_dir)

      {_, 0} =
        System.cmd(
          "git",
          ["-c", "user.email=t@t.com", "-c", "user.name=t", "commit", "-m", "init"],
          cd: clone_dir
        )

      {_, 0} = System.cmd("git", ["push", "origin", "HEAD:main"], cd: clone_dir)
      File.rm_rf!(clone_dir)
    end

    bare_dir
  end

  defp unique_project_id, do: "project-#{System.unique_integer([:positive])}"

  test "diretório inexistente + bare repo com commit: cria e faz checkout do branch remoto" do
    bare = create_bare_repo!(true)
    project_id = unique_project_id()

    dir = Workspace.ensure!(project_id, bare, "main")

    assert File.dir?(Path.join(dir, ".git"))
    assert File.exists?(Path.join(dir, "README.md"))
  end

  test "bare repo vazio (nunca recebeu push): cria um branch local vazio válido" do
    bare = create_bare_repo!(false)
    project_id = unique_project_id()

    dir = Workspace.ensure!(project_id, bare, "main")

    assert File.dir?(Path.join(dir, ".git"))
    # rev-parse HEAD falha aqui (branch sem nenhum commit ainda, unborn) —
    # symbolic-ref resolve o nome do branch sem exigir histórico.
    {branch, 0} = System.cmd("git", ["symbolic-ref", "--short", "HEAD"], cd: dir)
    assert String.trim(branch) == "main"
  end

  test "diretório já existe com permissions.json (sem .git ainda): faz o init in-place sem apagar o arquivo" do
    bare = create_bare_repo!(true)
    project_id = unique_project_id()
    dir = Workspace.workspace_dir(project_id)
    File.mkdir_p!(dir)
    File.write!(Path.join(dir, "permissions.json"), "{}")

    result_dir = Workspace.ensure!(project_id, bare, "main")

    assert result_dir == dir
    assert File.exists?(Path.join(dir, "permissions.json"))
    assert File.exists?(Path.join(dir, "README.md"))
  end

  test "ensure!/3 é idempotente — segunda chamada não tenta reclonar nem falha" do
    bare = create_bare_repo!(true)
    project_id = unique_project_id()

    dir1 = Workspace.ensure!(project_id, bare, "main")
    dir2 = Workspace.ensure!(project_id, bare, "main")

    assert dir1 == dir2
    assert File.exists?(Path.join(dir1, "README.md"))
  end
end
