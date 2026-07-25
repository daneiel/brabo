defmodule Engine.Harness.WorkspaceFilesTest do
  # async: false — o setup muta Application.env GLOBAL
  # (:project_workspaces_root) e apaga a raiz no on_exit; ver a nota em
  # workspace_test.exs.
  use ExUnit.Case, async: false

  alias Engine.Harness.WorkspaceFiles
  alias Engine.Actions.Workspace

  setup do
    root =
      Path.join(
        System.tmp_dir!(),
        "brabo-wf-test-#{System.os_time(:microsecond)}-#{System.unique_integer([:positive])}"
      )

    Application.put_env(:engine, :project_workspaces_root, root)
    project_id = "proj-#{System.unique_integer([:positive])}"
    File.mkdir_p!(Workspace.workspace_dir(project_id))
    on_exit(fn -> File.rm_rf!(root) end)
    %{project_id: project_id}
  end

  test "read_file lê dentro do workspace", %{project_id: pid} do
    dir = Workspace.workspace_dir(pid)
    path = Path.join(dir, "a.txt")
    File.write!(path, "conteúdo")
    assert {:ok, "conteúdo"} = WorkspaceFiles.read_file(dir, "a.txt")
  end

  test "path traversal com ../ é bloqueado", %{project_id: pid} do
    dir = Workspace.workspace_dir(pid)
    assert {:error, :traversal} = WorkspaceFiles.read_file(dir, "../../etc/passwd")
    assert {:error, :traversal} = WorkspaceFiles.safe_path(dir, "../fora.txt")
  end

  test "path absoluto fora do workspace é bloqueado", %{project_id: pid} do
    dir = Workspace.workspace_dir(pid)
    assert {:error, :traversal} = WorkspaceFiles.read_file(dir, "/etc/passwd")
    assert {:error, :traversal} = WorkspaceFiles.write_file(dir, "/tmp/evil", "x")
  end

  test "write_file escreve dentro do workspace (cria subdiretório)", %{project_id: pid} do
    dir = Workspace.workspace_dir(pid)
    assert {:ok, abs} = WorkspaceFiles.write_file(dir, "scratch/n.txt", "oi")
    assert File.read!(abs) == "oi"
    assert String.starts_with?(abs, dir <> "/")
  end

  test "search acha por nome e por conteúdo", %{project_id: pid} do
    dir = Workspace.workspace_dir(pid)
    File.write!(Path.join(dir, "alvo.md"), "nada especial")
    File.mkdir_p!(Path.join(dir, "sub"))
    File.write!(Path.join(dir, "sub/outro.txt"), "tem PALAVRA aqui")

    by_name = WorkspaceFiles.search(dir, "alvo")
    assert Enum.any?(by_name, &(&1.path == "alvo.md"))

    by_content = WorkspaceFiles.search(dir, "palavra")
    assert Enum.any?(by_content, &(&1.path == "sub/outro.txt"))
  end
end
