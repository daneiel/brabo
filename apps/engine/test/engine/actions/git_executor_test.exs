defmodule Engine.Actions.GitExecutorTest do
  # async: false — filesystem + git de verdade. Sem banco: exercita o executor
  # contra worktrees reais montados pelo WorktreeManager, que é o par que o
  # NoopDevAgent valida de ponta a ponta (worktree isolado → commit assinado).
  use ExUnit.Case, async: false

  alias Engine.Actions.GitExecutor
  alias Engine.Dev.WorktreeManager

  setup do
    root =
      Path.join(
        System.tmp_dir!(),
        "brabo-gitexec-#{System.os_time(:microsecond)}-#{System.unique_integer([:positive])}"
      )

    project_id = Ecto.UUID.generate()
    work_dir = Path.join(root, project_id)
    File.mkdir_p!(work_dir)

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
    {out, 0} = System.cmd("git", args, cd: cd, stderr_to_stdout: true)
    out
  end

  # Payload exatamente como o dev agent o propõe (ver Engine.Dev.AgentIo).
  defp commit_payload(worktree, agent_id, message) do
    %{
      "worktree" => worktree,
      "message" => message,
      "author" => "#{agent_id}[bot]",
      "authorEmail" => "#{agent_id}-bot@brabo.dev",
      "coAuthor" => "Daniel Souza <daniel@brabo.dev>"
    }
  end

  test "commit usa a identidade do bot e mantém o usuário como co-author", %{
    work_dir: work_dir
  } do
    {:ok, wt} = WorktreeManager.add_worktree(work_dir, "dev-api", "task-a")
    File.write!(Path.join(wt.path, "NOOP-task-a.md"), "trabalho do dev-api\n")

    assert {:ok, %{sha: sha, branch: branch}} =
             GitExecutor.commit(commit_payload(wt.path, "dev-api", "dev-api: Cadastro"))

    assert branch == "feature/task-a"
    assert String.length(sha) == 40

    # O author do commit é o bot — não o usuário do git local.
    assert git(wt.path, ["log", "-1", "--format=%an"]) |> String.trim() == "dev-api[bot]"

    assert git(wt.path, ["log", "-1", "--format=%ae"]) |> String.trim() ==
             "dev-api-bot@brabo.dev"

    # E o usuário viaja no corpo como co-author (regra do CLAUDE.md).
    corpo = git(wt.path, ["log", "-1", "--format=%B"])
    assert corpo =~ "dev-api: Cadastro"
    assert corpo =~ "Co-authored-by: Daniel Souza <daniel@brabo.dev>"
  end

  test "sem coAuthor no payload, o corpo não ganha trailer nenhum", %{work_dir: work_dir} do
    {:ok, wt} = WorktreeManager.add_worktree(work_dir, "dev-api", "task-a")
    File.write!(Path.join(wt.path, "a.txt"), "a")

    assert {:ok, _} =
             GitExecutor.commit(%{
               "worktree" => wt.path,
               "message" => "sem co-author",
               "author" => "dev-api[bot]",
               "authorEmail" => "dev-api-bot@brabo.dev"
             })

    refute git(wt.path, ["log", "-1", "--format=%B"]) =~ "Co-authored-by"
  end

  test "dois agentes commitam em paralelo sem um enxergar o diff do outro", %{
    work_dir: work_dir
  } do
    {:ok, api} = WorktreeManager.add_worktree(work_dir, "dev-api", "task-a")
    {:ok, web} = WorktreeManager.add_worktree(work_dir, "dev-web", "task-b")

    File.write!(Path.join(api.path, "NOOP-task-a.md"), "trabalho do dev-api\n")
    File.write!(Path.join(web.path, "NOOP-task-b.md"), "trabalho do dev-web\n")

    assert {:ok, api_commit} =
             GitExecutor.commit(commit_payload(api.path, "dev-api", "dev-api: Cadastro"))

    assert {:ok, web_commit} =
             GitExecutor.commit(commit_payload(web.path, "dev-web", "dev-web: Listagem"))

    assert api_commit.sha != web_commit.sha
    assert api_commit.branch == "feature/task-a"
    assert web_commit.branch == "feature/task-b"

    # Cada branch carrega SÓ o arquivo do seu dono — worktrees isolados de fato.
    api_files = git(api.path, ["show", "--name-only", "--format=", "HEAD"])
    web_files = git(web.path, ["show", "--name-only", "--format=", "HEAD"])

    assert api_files =~ "NOOP-task-a.md"
    refute api_files =~ "NOOP-task-b.md"
    assert web_files =~ "NOOP-task-b.md"
    refute web_files =~ "NOOP-task-a.md"

    assert git(api.path, ["log", "-1", "--format=%an"]) |> String.trim() == "dev-api[bot]"
    assert git(web.path, ["log", "-1", "--format=%an"]) |> String.trim() == "dev-web[bot]"
  end

  test "commit num worktree sem mudança nenhuma falha em vez de fingir sucesso", %{
    work_dir: work_dir
  } do
    {:ok, wt} = WorktreeManager.add_worktree(work_dir, "dev-api", "task-a")

    assert {:error, saida} =
             GitExecutor.commit(commit_payload(wt.path, "dev-api", "nada a commitar"))

    assert saida =~ "nothing to commit"
  end
end
