defmodule Engine.Dev.WorktreeManagerTest do
  # async: false — mexe em Application env global (:project_workspaces_root) e no
  # filesystem, e (desde a RN-507) em `Engine.Runners.Registry`, que usa
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

  # RN-715: `adopt/3` é `add_worktree/4` com a própria branch da PR como base —
  # o agente volta a ela com os commits que a PR já tem, mesmo depois de ter
  # recriado o worktree para OUTRA task.
  test "readotar a branch da PR preserva os commits dela", %{work_dir: work_dir} do
    assert {:ok, wt} = WorktreeManager.add_worktree(work_dir, "dev-api", "task-a")
    File.write!(Path.join(wt.path, "a.txt"), "trabalho da PR")
    git(wt.path, ["add", "-A"])
    git(wt.path, ["commit", "-m", "pr"])

    assert {:ok, _} = WorktreeManager.add_worktree(work_dir, "dev-api", "task-b")

    assert {:ok, de_volta} =
             WorktreeManager.add_worktree(work_dir, "dev-api", "task-a", "feature/task-a")

    assert de_volta.branch == "feature/task-a"
    assert File.read!(Path.join(de_volta.path, "a.txt")) == "trabalho da PR"
  end

  test "readotar branch que não existe: recusa nomeada", %{work_dir: work_dir} do
    assert {:error, motivo} =
             WorktreeManager.add_worktree(work_dir, "dev-api", "task-z", "feature/task-z")

    assert motivo =~ "feature/task-z"
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

  # RN-664 (AT-250) — a branch do agente nasce da de TRABALHO (`dev`), a mesma
  # que a PR mira e que o gate usa no diff, e não do HEAD do working tree.
  describe "base explícita (RN-664)" do
    # Uma `dev` com um commit a mais que o HEAD (a `main`/`master` do setup).
    defp cria_dev_adiante!(work_dir) do
      git(work_dir, ["checkout", "-b", "dev"])
      File.write!(Path.join(work_dir, "SO_NA_DEV.md"), "trabalho integrado")
      git(work_dir, ["add", "-A"])
      git(work_dir, ["commit", "-m", "dev"])
      git(work_dir, ["checkout", "-"])
    end

    test "a branch nasce da `dev`, não do HEAD", %{work_dir: work_dir} do
      cria_dev_adiante!(work_dir)
      refute File.exists?(Path.join(work_dir, "SO_NA_DEV.md"))

      assert {:ok, wt} = WorktreeManager.add_worktree(work_dir, "dev-api", "task-a", "dev")
      assert File.exists?(Path.join(wt.path, "SO_NA_DEV.md"))
    end

    test "workspace de ANTES da RN-664 (parado na default, só com origin/dev) ganha a `dev` local",
         %{root: root, work_dir: work_dir} do
      bare = Path.join(root, "origem.git")
      git(root, ["init", "--bare", "origem.git"])
      git(work_dir, ["remote", "add", "origin", bare])
      cria_dev_adiante!(work_dir)
      git(work_dir, ["push", "origin", "dev"])
      git(work_dir, ["fetch", "origin"])
      git(work_dir, ["branch", "-D", "dev"])

      assert {:ok, wt} = WorktreeManager.add_worktree(work_dir, "dev-api", "task-a", "dev")
      assert File.exists?(Path.join(wt.path, "SO_NA_DEV.md"))

      {_, 0} =
        System.cmd("git", ["rev-parse", "--verify", "refs/heads/dev"],
          cd: work_dir,
          stderr_to_stdout: true
        )
    end

    test "sem `dev` nem `origin/dev`: recusa NOMEADA, sem nascer do HEAD", %{work_dir: work_dir} do
      assert {:error, mensagem} =
               WorktreeManager.add_worktree(work_dir, "dev-api", "task-a", "dev")

      assert mensagem =~ "não tem a branch `dev`"
      assert mensagem =~ "RN-664"
      assert WorktreeManager.list_at(work_dir) == []
    end
  end

  # RN-507/ADR 0145 — as MESMAS quatro operações, para um projeto
  # `execution_mode: runner`: bifurcam para `Engine.Actions.Workspace.
  # RunnerGit`, pelo canal Phoenix, nunca `File.ls`/`System.cmd` local (que
  # não alcançaria a pasta do usuário de qualquer jeito).
  describe "runner (RN-507, ADR 0145)" do
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
        {:dispatch_exec, ref, command, cwd, _env, _git_credenciado, from, _timeout_ms} ->
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

  # RN-743 (AT-429): o trabalho não commitado sobrevive ao bloqueio.
  describe "preservar_em/3 e create_from/4" do
    test "commita o worktree sujo na branch da task e a próxima nasce dela", %{
      work_dir: work_dir
    } do
      {:ok, %{path: path, branch: branch}} =
        WorktreeManager.add_worktree(work_dir, "dev-api", "task-aaaa1111")

      File.write!(Path.join(path, "package.json"), "{}")

      assert {:ok, sha} = WorktreeManager.preservar_em(path, "dev-api", "t1")
      {autor, 0} = System.cmd("git", ["log", "-1", "--format=%an", branch], cd: work_dir)
      assert String.trim(autor) == "dev-api[bot]"

      {:ok, %{path: novo}} =
        WorktreeManager.add_worktree(work_dir, "dev-api", "task-bbbb2222", branch)

      assert File.exists?(Path.join(novo, "package.json"))
      {head, 0} = System.cmd("git", ["rev-parse", "HEAD~0"], cd: novo)
      assert String.trim(head) == sha
    end

    test "worktree limpo é :nada, e pasta que não é repositório é erro nomeado", %{
      work_dir: work_dir,
      root: root
    } do
      {:ok, %{path: path}} = WorktreeManager.add_worktree(work_dir, "dev-web", "task-cccc3333")
      assert :nada == WorktreeManager.preservar_em(path, "dev-web", "t2")

      solta = Path.join(root, "nao-e-repo")
      File.mkdir_p!(solta)
      assert {:error, _} = WorktreeManager.preservar_em(solta, "dev-web", "t3")
    end
  end

  # RN-760 (AT-447): branch anterior já mergeada na `dev` não é ponto de partida.
  describe "add_worktree/4 com a branch da task anterior" do
    test "não mergeada: parte dela; mergeada na dev: parte da dev", %{work_dir: work_dir} do
      {:ok, %{path: path, branch: branch}} =
        WorktreeManager.add_worktree(work_dir, "dev-api", "task-eeee5555")

      File.write!(Path.join(path, "login.ts"), "rota")
      {:ok, _} = WorktreeManager.preservar_em(path, "dev-api", "t5")

      {:ok, %{path: p2}} =
        WorktreeManager.add_worktree(work_dir, "dev-api", "task-ffff6666", branch)

      assert File.exists?(Path.join(p2, "login.ts"))

      {_, 0} = System.cmd("git", ["branch", "-f", "dev", branch], cd: work_dir)
      {_, 0} = System.cmd("git", ["branch", "-f", branch, "dev~1"], cd: work_dir)

      {:ok, %{path: p3}} =
        WorktreeManager.add_worktree(work_dir, "dev-api", "task-abab7777", branch)

      assert File.exists?(Path.join(p3, "login.ts"))
    end
  end

  # RN-779 (AT-458): o merge das PRs acontece no remoto; o worktree da task
  # (re)pegada parte da ponta ATUAL da `dev` e integra-a quando parte de outra
  # branch.
  describe "integração da dev atual (RN-779)" do
    # Um remoto com `dev`; o work_dir fica com a `dev` local PARADA e um outro
    # clone faz o papel do merge das PRs, que anda o remoto.
    defp remoto_com_dev!(root, work_dir) do
      bare = Path.join(root, "origem.git")
      git(root, ["init", "--bare", "origem.git"])
      git(work_dir, ["remote", "add", "origin", bare])
      git(work_dir, ["checkout", "-b", "dev"])
      git(work_dir, ["push", "origin", "dev"])
      git(work_dir, ["fetch", "origin"])

      outro = Path.join(root, "outro")
      git(root, ["clone", "-b", "dev", bare, "outro"])
      git(outro, ["config", "user.email", "t@brabo.dev"])
      git(outro, ["config", "user.name", "t"])
      outro
    end

    defp anda_o_remoto!(outro, work_dir, arquivo, conteudo) do
      File.write!(Path.join(outro, arquivo), conteudo)
      git(outro, ["add", "-A"])
      git(outro, ["commit", "-m", "merge de outra PR"])
      git(outro, ["push", "origin", "dev"])
      git(work_dir, ["fetch", "origin"])
    end

    defp branch_com_trabalho!(work_dir, slug, arquivo, conteudo) do
      {:ok, %{path: path, branch: branch}} =
        WorktreeManager.add_worktree(work_dir, "dev-api", slug, "dev")

      File.write!(Path.join(path, arquivo), conteudo)
      {:ok, _} = WorktreeManager.preservar_em(path, "dev-api", slug)
      branch
    end

    test "a task retomada com branch antiga já mergeada parte da dev ATUAL do remoto",
         %{root: root, work_dir: work_dir} do
      outro = remoto_com_dev!(root, work_dir)
      _ = branch_com_trabalho!(work_dir, "task-c80daf6c", "velho.txt", "x")
      # A branch velha entrou na dev pelo merge de outra PR, e a dev andou.
      git(work_dir, ["push", "origin", "feature/task-c80daf6c"])
      git(outro, ["fetch", "origin"])
      git(outro, ["merge", "--no-edit", "origin/feature/task-c80daf6c"])
      anda_o_remoto!(outro, work_dir, "doze_tarefas.txt", "y")

      {:ok, %{path: p}} =
        WorktreeManager.add_worktree(work_dir, "dev-api", "task-c80daf6c", "dev")

      assert File.exists?(Path.join(p, "doze_tarefas.txt"))
      assert File.exists?(Path.join(p, "velho.txt"))
    end

    test "a task retomada com trabalho preservado parte dele e integra a dev nova (RN-743)",
         %{root: root, work_dir: work_dir} do
      outro = remoto_com_dev!(root, work_dir)
      _ = branch_com_trabalho!(work_dir, "task-aaaa1111", "meu.txt", "x")
      anda_o_remoto!(outro, work_dir, "novo_na_dev.txt", "y")

      {:ok, %{path: p}} =
        WorktreeManager.add_worktree(work_dir, "dev-api", "task-aaaa1111", "dev")

      assert File.exists?(Path.join(p, "meu.txt"))
      assert File.exists?(Path.join(p, "novo_na_dev.txt"))
    end

    test "a anterior aprovada e não mergeada (awaiting_user) é a base, com a dev atual integrada",
         %{root: root, work_dir: work_dir} do
      outro = remoto_com_dev!(root, work_dir)
      anterior = branch_com_trabalho!(work_dir, "task-bbbb2222", "login.ts", "rota")
      anda_o_remoto!(outro, work_dir, "infra.txt", "y")

      {:ok, %{path: p}} =
        WorktreeManager.add_worktree(work_dir, "dev-api", "task-cccc3333", anterior)

      assert File.exists?(Path.join(p, "login.ts"))
      assert File.exists?(Path.join(p, "infra.txt"))
    end

    test "conflito ao integrar é recusa NOMEADA, com os arquivos, e o trabalho fica",
         %{root: root, work_dir: work_dir} do
      outro = remoto_com_dev!(root, work_dir)
      anterior = branch_com_trabalho!(work_dir, "task-dddd4444", "README.md", "da task")
      anda_o_remoto!(outro, work_dir, "README.md", "da dev")

      assert {:error, motivo} =
               WorktreeManager.add_worktree(work_dir, "dev-api", "task-eeee5555", anterior)

      assert WorktreeManager.conflito_de_integracao?(motivo)
      assert motivo =~ "README.md"
      {log, 0} = System.cmd("git", ["log", "-1", "--format=%an", anterior], cd: work_dir)
      assert String.trim(log) == "dev-api[bot]"
    end
  end

  # RN-744 (AT-444): o kickoff do dev diz a branch e o que já existe.
  describe "retrato/2" do
    test "lista a branch e os arquivos, rastreados e novos", %{work_dir: work_dir} do
      {:ok, %{path: path, branch: branch}} =
        WorktreeManager.add_worktree(work_dir, "dev-api", "task-dddd4444")

      File.write!(Path.join(path, "package.json"), "{}")
      texto = WorktreeManager.retrato(path, branch)

      assert texto =~ "branch `feature/task-dddd4444`"
      assert texto =~ "README.md"
      assert texto =~ "package.json"
      assert texto =~ "2 arquivo(s)"
    end

    test "pasta que o engine não alcança diz que está indisponível" do
      texto = WorktreeManager.retrato("/nao/existe/#{System.unique_integer()}", "feature/x")
      assert texto =~ "indisponível"
    end
  end

  test "a descrição do terminal diz que o shell é sh, sem brace expansion" do
    %{description: d} = Engine.Harness.Tools.Terminal.spec()
    assert d =~ "`sh`"
    assert d =~ "brace expansion"
  end
end
