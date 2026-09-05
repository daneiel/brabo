defmodule Engine.Dev.WorktreeManagerTest do
  # async: false — mexe em Application env global (:project_workspaces_root) e no
  # filesystem, e (desde a RN-505) em `Engine.Runners.Registry`, que usa
  # `:global` — o mesmo motivo de `Engine.Runners.RunnerRouterTest`. Os testes
  # ORIGINAIS (local, sem projeto no banco) continuam funcionando sem tocar o
  # banco — `WorktreeManager.runner?/1` degrada pra `false` sem sandbox
  # (mesmo raciocínio de `Engine.Actions.Workspace.projeto_runner/1`, agora
  # removido de lá); os NOVOS (describe "runner") precisam do banco de
  # verdade para inserir o projeto e o ciclo de vida do container.
  use Engine.DataCase, async: false

  alias Engine.Dev.WorktreeManager
  alias Engine.Runners.Registry

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

  # RN-505/ADR 0145 — as MESMAS quatro operações, para um projeto
  # `execution_mode: runner`: bifurcam para `Engine.Actions.Workspace.
  # RunnerGit`, pelo canal Phoenix, nunca `File.ls`/`System.cmd` local (que
  # não alcançaria a pasta do usuário de qualquer jeito).
  describe "runner (RN-505, ADR 0145)" do
    defp insert_runner_project!(project_id, workspace_path) do
      Repo.query!(
        "INSERT INTO public.projects " <>
          "(id, name, slug, execution_mode, workspace_path, workspace_verified_at) " <>
          "VALUES ($1, 'proj', 'proj', 'runner', $2, now())",
        [Ecto.UUID.dump!(project_id), workspace_path]
      )
    end

    defp insert_container_lifecycle!(project_id, status) do
      Repo.query!(
        "INSERT INTO public.project_containers " <>
          "(id, project_id, status, image_version, cpus, memory_mb, pids_limit) " <>
          "VALUES ($1, $2, #{status}, 1, 1.0, 512, 128)",
        [Ecto.UUID.dump!(Ecto.UUID.generate()), Ecto.UUID.dump!(project_id)]
      )
    end

    defp fake_work_dir do
      Path.join(
        System.tmp_dir!(),
        "brabo-wt-runner-#{System.os_time(:microsecond)}-#{System.unique_integer([:positive])}"
      )
    end

    # Fake runner GENÉRICO, parametrizado por `responder` — cada teste decide
    # o que cada comando devolve (mesmo desenho do fake runner de
    # `Engine.Actions.WorkspaceRunnerTest`, um nível acima da resposta fixa).
    defp start_fake_runner!(project_id, responder) do
      parent = self()

      pid =
        spawn(fn ->
          Ecto.Adapters.SQL.Sandbox.allow(Engine.Repo, parent, self())
          :ok = Registry.register(project_id, self())
          send(parent, :fake_runner_ready)
          fake_runner_loop(parent, responder)
        end)

      assert_receive :fake_runner_ready, 1_000
      on_exit(fn -> Process.exit(pid, :kill) end)
      pid
    end

    defp fake_runner_loop(parent, responder) do
      receive do
        {:dispatch_exec, ref, command, cwd, _env, from, _timeout_ms} ->
          send(parent, {:comando, command})
          {exit_code, output} = responder.(command, cwd)

          send(
            from,
            {:runner_exec_result, ref,
             %{"exitCode" => exit_code, "output" => output, "timedOut" => false}}
          )

          fake_runner_loop(parent, responder)
      end
    end

    test "list/1 num projeto runner PRONTO lista via o canal, nunca File.ls local" do
      project_id = Ecto.UUID.generate()
      work_dir = fake_work_dir()
      insert_runner_project!(project_id, work_dir)
      insert_container_lifecycle!(project_id, "'running'")

      start_fake_runner!(project_id, fn command, _cwd ->
        if String.starts_with?(command, "find "),
          do: {0, "dev-api\ndev-web\n"},
          else: {0, ""}
      end)

      # A pasta nunca existiu no disco do engine — se `list/1` tivesse caído
      # no caminho LOCAL (`File.ls`), teria devolvido `[]` em silêncio, em
      # vez dos dois agentes que só o runner "sabe".
      refute File.exists?(work_dir)
      assert Enum.sort(WorktreeManager.list(project_id)) == ["dev-api", "dev-web"]
    end

    test "cleanup_orphans/2 num projeto runner remove o órfão via o canal" do
      project_id = Ecto.UUID.generate()
      work_dir = fake_work_dir()
      insert_runner_project!(project_id, work_dir)
      insert_container_lifecycle!(project_id, "'running'")

      test_pid = self()

      start_fake_runner!(project_id, fn command, _cwd ->
        cond do
          String.starts_with?(command, "find ") ->
            {0, "dev-api\ndev-web\n"}

          String.contains?(command, "worktree remove") ->
            send(test_pid, {:removeu, command})
            {0, ""}

          true ->
            {0, ""}
        end
      end)

      removidos = WorktreeManager.cleanup_orphans(project_id, ["dev-api"])

      assert removidos == ["dev-web"]
      assert_receive {:removeu, comando}
      assert comando =~ "dev-web"
    end

    test "list/1 num projeto runner SEM container running devolve [] — não dá pra saber agora" do
      project_id = Ecto.UUID.generate()
      work_dir = fake_work_dir()
      insert_runner_project!(project_id, work_dir)
      # SEM insert_container_lifecycle! nem runner conectado.

      assert WorktreeManager.list(project_id) == []
    end
  end
end
