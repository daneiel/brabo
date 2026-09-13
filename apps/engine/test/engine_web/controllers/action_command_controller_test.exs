defmodule EngineWeb.ActionCommandControllerTest do
  @moduledoc """
  O GATILHO do espelho (ADR 0147 ponto 8, RN-516): o **commit** é um momento
  NOMEADO, e é dele que sai o `mirror_sync`. Nunca um watcher do outro lado —
  watcher é trabalho ilimitado disparado por qualquer coisa, inclusive pelas
  escritas do próprio espelho, que é laço.

  `async: false`: `Engine.Runners.Registry` usa `:global`, global ao node de
  teste inteiro (mesmo motivo de `EngineWeb.TerminalChannelTest`), e o
  repositório git é de VERDADE em `tmp` — mesmo molde de
  `Engine.Actions.GitExecutorTest`.

  A action é chamada DIRETO, sem passar pelo router: o que está sob teste é a
  decisão do controller, não o pipeline de auth (mesma disciplina de
  `EngineWeb.ExecutionCommandControllerTest`).

  O `Registry` recebe o pid do PRÓPRIO teste como se fosse o canal do runner —
  é assim que a mensagem interna `{:dispatch_mirror_sync, ...}` fica
  observável sem subir canal nenhum. Que ela vira um `push "mirror_sync"` de
  verdade é o que `EngineWeb.TerminalChannelTest` prova.
  """

  use EngineWeb.ConnCase, async: false

  alias Engine.Runners.Registry
  alias EngineWeb.ActionCommandController

  setup do
    raiz =
      Path.join(
        System.tmp_dir!(),
        "brabo-espelho-commit-#{System.os_time(:microsecond)}-#{System.unique_integer([:positive])}"
      )

    worktree = Path.join(raiz, "worktree")
    File.mkdir_p!(worktree)

    git(worktree, ["init", "-q", "."])
    git(worktree, ["config", "user.email", "t@brabo.dev"])
    git(worktree, ["config", "user.name", "t"])
    File.write!(Path.join(worktree, "README.md"), "x")
    git(worktree, ["add", "-A"])
    git(worktree, ["commit", "-qm", "inicial"])

    on_exit(fn -> File.rm_rf!(raiz) end)

    %{worktree: worktree}
  end

  defp git(cd, args) do
    {_out, 0} = System.cmd("git", args, cd: cd, stderr_to_stdout: true)
    :ok
  end

  defp inserir_projeto!(mirror_path) do
    project_id = Ecto.UUID.generate()

    Engine.Repo.query!(
      "INSERT INTO public.projects " <>
        "(id, name, slug, workspace_dir_name, execution_mode, workspace_path, " <>
        "workspace_verified_at, mirror_path) " <>
        "VALUES ($1, 'proj', 'proj', 'proj-abc12345', 'runner', " <>
        "'/home/voce/projetos/proj', now(), $2)",
      [Ecto.UUID.dump!(project_id), mirror_path]
    )

    project_id
  end

  defp conectar_runner!(project_id) do
    :ok = Registry.register(project_id, self())
    on_exit(fn -> Registry.unregister(project_id) end)
  end

  defp commit!(conn, project_id, worktree, mensagem) do
    ActionCommandController.execute_git(conn, %{
      "type" => "git_commit",
      "projectId" => project_id,
      "payload" => %{"worktree" => worktree, "message" => mensagem}
    })
  end

  test "commit BEM-SUCEDIDO dispara mirror_sync com o momento \"commit\"", %{
    conn: conn,
    worktree: worktree
  } do
    project_id = inserir_projeto!("/home/voce/espelhos/proj")
    conectar_runner!(project_id)
    File.write!(Path.join(worktree, "novo.txt"), "trabalho do agente")

    conn = commit!(conn, project_id, worktree, "feat: trabalho")

    assert %{"sha" => _, "branch" => _} = json_response(conn, 200)
    assert_receive {:dispatch_mirror_sync, _ref, "/home/voce/espelhos/proj", "commit"}
  end

  test "commit que FALHA não dispara espelho nenhum — nada mudou que valha copiar", %{
    conn: conn,
    worktree: worktree
  } do
    project_id = inserir_projeto!("/home/voce/espelhos/proj")
    conectar_runner!(project_id)

    # Nada para commitar: `git commit` sai diferente de zero.
    conn = commit!(conn, project_id, worktree, "feat: nada")

    assert %{"error" => _} = json_response(conn, 422)
    refute_receive {:dispatch_mirror_sync, _, _, _}
  end

  test "projeto SEM destino de espelho commita exatamente como antes", %{
    conn: conn,
    worktree: worktree
  } do
    project_id = inserir_projeto!(nil)
    conectar_runner!(project_id)
    File.write!(Path.join(worktree, "novo.txt"), "trabalho do agente")

    conn = commit!(conn, project_id, worktree, "feat: trabalho")

    assert %{"sha" => _} = json_response(conn, 200)
    refute_receive {:dispatch_mirror_sync, _, _, _}
  end

  test "corpo SEM projectId continua commitando — o espelho nunca quebra o commit", %{
    conn: conn,
    worktree: worktree
  } do
    File.write!(Path.join(worktree, "novo.txt"), "trabalho do agente")

    conn =
      ActionCommandController.execute_git(conn, %{
        "type" => "git_commit",
        "payload" => %{"worktree" => worktree, "message" => "feat: trabalho"}
      })

    assert %{"sha" => _} = json_response(conn, 200)
  end
end
