defmodule Engine.Actions.GitExecutorPushTest do
  @moduledoc """
  O `push` depois do ADR 0056.

  Antes ele empurrava para um `origin` que era sempre um caminho local, e não
  precisava saber de projeto nenhum. Agora o `origin` pode ser uma URL limpa, e
  a credencial entra por invocação — o que obriga o push a resolver o remoto de
  trabalho antes.
  """

  # DataCase: `remoto_de_trabalho/1` consulta `project_repositories`.
  use Engine.DataCase, async: false

  alias Engine.Actions.GitExecutor

  setup do
    root =
      Path.join(
        System.tmp_dir!(),
        "brabo-push-#{System.os_time(:microsecond)}-#{System.unique_integer([:positive])}"
      )

    File.mkdir_p!(root)
    Application.put_env(:engine, :project_workspaces_root, root)

    on_exit(fn ->
      Application.delete_env(:engine, :project_workspaces_root)
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :fake_git_remote)
      File.rm_rf!(root)
    end)

    %{root: root}
  end

  defp git!(cd, args) do
    {out, 0} = System.cmd("git", args, cd: cd, stderr_to_stdout: true)
    out
  end

  defp insert_repo!(project_id, provider, external_id) do
    Repo.query!(
      """
      INSERT INTO public.project_repositories
        (id, project_id, provider, external_id, url, default_branch, visibility, provisioned_by)
      VALUES ($1, $2, $3, $4, $5, 'main', 'private', $6)
      """,
      [
        Ecto.UUID.dump!(Ecto.UUID.generate()),
        Ecto.UUID.dump!(project_id),
        provider,
        external_id,
        "file://#{external_id}",
        Ecto.UUID.dump!(Ecto.UUID.generate())
      ]
    )
  end

  test "provider local: empurra de verdade, sem credencial nenhuma", %{root: root} do
    bare = Path.join(root, "origem.git")
    git!(root, ["init", "--bare", "origem.git"])

    worktree = Path.join(root, "wt")
    File.mkdir_p!(worktree)
    git!(worktree, ["init"])
    git!(worktree, ["config", "user.email", "t@brabo.dev"])
    git!(worktree, ["config", "user.name", "t"])
    git!(worktree, ["remote", "add", "origin", bare])
    File.write!(Path.join(worktree, "a.txt"), "conteudo")
    git!(worktree, ["add", "-A"])
    git!(worktree, ["commit", "-m", "trabalho"])
    git!(worktree, ["checkout", "-B", "feature/x"])

    project_id = Ecto.UUID.generate()
    insert_repo!(project_id, "local", bare)

    assert {:ok, %{branch: "feature/x"}} =
             GitExecutor.push(project_id, %{"worktree" => worktree, "branch" => "feature/x"})

    # Chegou mesmo do outro lado.
    assert git!(bare, ["branch", "--list", "feature/x"]) =~ "feature/x"
  end

  test "remoto indisponível: erro NOMEIA o que faltou, em vez de um erro de git cru" do
    # Sem isto, o desfecho que chega ao usuário é a saída bruta de uma falha de
    # autenticação do git — que manda procurar no lugar errado. A regra do
    # CLAUDE.md é que a falha diga a origem, e aqui ela é `infra`.
    Application.put_env(:engine, :engine_api_client, Engine.Sessions.FakeEngineApiClient)
    Application.put_env(:engine, :fake_git_remote, %{origin: nil})

    project_id = Ecto.UUID.generate()
    insert_repo!(project_id, "github", "org/repo")

    assert {:error, mensagem} =
             GitExecutor.push(project_id, %{"worktree" => "/tmp", "branch" => "feature/x"})

    assert mensagem =~ "remoto de trabalho indisponível"
  end

  test "projeto sem repositório provisionado: também nomeia" do
    assert {:error, mensagem} =
             GitExecutor.push(Ecto.UUID.generate(), %{
               "worktree" => "/tmp",
               "branch" => "feature/x"
             })

    assert mensagem =~ "remoto de trabalho indisponível"
  end
end
