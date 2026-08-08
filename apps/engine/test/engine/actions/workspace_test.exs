defmodule Engine.Actions.WorkspaceTest do
  # async: false — o setup muta Application.env GLOBAL
  # (:project_workspaces_root), mesmo motivo de worktree_manager_test.exs e
  # terminal_executor_test.exs. Com async: true, outro módulo trocava a raiz
  # entre o workspace_dir/1 e o ensure!/3 daqui (e o on_exit de um apagava o
  # cwd do git do outro) — flakiness real, ~50% da suite.
  use ExUnit.Case, async: false

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

  test "N agentes do MESMO projeto em paralelo: todos resolvem no mesmo working tree" do
    # Cenário exato da ativação da execução: os dev agents do projeto sobem
    # juntos e todos chamam ensure!/3 vendo o working tree ainda inexistente.
    # Sem o lock de inicialização, os git init/fetch colidiam no mesmo
    # diretório e derrubavam todos menos um (com 2 agentes — o número do
    # critério de aceite — 1 falhava de forma reprodutível).
    bare = create_bare_repo!(true)
    project_id = unique_project_id()

    resultados =
      1..8
      |> Task.async_stream(fn _ -> Workspace.ensure(project_id, bare, "main") end,
        max_concurrency: 8,
        timeout: 30_000
      )
      |> Enum.map(fn {:ok, r} -> r end)

    erros = Enum.filter(resultados, &match?({:error, _}, &1))
    assert erros == [], "#{length(erros)}/8 falharam: #{inspect(erros, limit: :infinity)}"

    dirs = resultados |> Enum.map(fn {:ok, d} -> d end) |> Enum.uniq()
    assert length(dirs) == 1

    dir = hd(dirs)
    assert File.exists?(Path.join(dir, "README.md"))
    {branch, 0} = System.cmd("git", ["symbolic-ref", "--short", "HEAD"], cd: dir)
    assert String.trim(branch) == "main"
  end

  test "ensure/3 devolve {:error, _} em vez de levantar quando o git falha" do
    # Caminho de falha: quem roda dentro de um processo supervisionado (dev
    # agent) não pode morrer por causa de um git quebrado — ele precisa do
    # erro pra devolver a task que já reivindicou.
    project_id = unique_project_id()

    assert {:error, msg} =
             Workspace.ensure(project_id, "/repo/que/nao/existe.git", "main")

    assert is_binary(msg)
  end

  test "ensure!/3 é idempotente — segunda chamada não tenta reclonar nem falha" do
    bare = create_bare_repo!(true)
    project_id = unique_project_id()

    dir1 = Workspace.ensure!(project_id, bare, "main")
    dir2 = Workspace.ensure!(project_id, bare, "main")

    assert dir1 == dir2
    assert File.exists?(Path.join(dir1, "README.md"))
  end

  describe "a corrida de dois dev agents (achado da 1ª execução com 2 módulos)" do
    test "um `.git` recém-criado NÃO conta como pronto", %{} do
      # A guarda do caminho rápido era `.git` existir, e `init_from_bare!`
      # começa com `git init` — o `.git` nasce na PRIMEIRA linha, antes do
      # fetch e do checkout. O segundo agente via "pronto", pulava o lock e
      # rodava `git worktree add` num repositório pela metade.
      #
      # Este teste reproduz exatamente esse estado: repo iniciado, inicialização
      # NÃO concluída.
      project_id = Ecto.UUID.generate()
      dir = Workspace.workspace_dir(project_id)
      File.mkdir_p!(dir)
      {_, 0} = System.cmd("git", ["init"], cd: dir, stderr_to_stdout: true)

      refute File.regular?(Path.join(dir, ".brabo-workspace-pronto")),
             "o repo meio-inicializado não pode ter a marca de pronto"

      # Com a guarda antiga (`.git` existe), `ensure!` devolveria o diretório
      # sem nunca completar a inicialização. Com a marca, ele passa pelo lock,
      # reconhece o workspace pré-marca e o conclui.
      bare = create_bare_repo!(true)
      assert Workspace.ensure!(project_id, bare) == dir

      assert File.regular?(Path.join(dir, ".brabo-workspace-pronto")),
             "depois do ensure! o workspace tem de estar marcado como pronto"
    end

    test "workspace JÁ inicializado por versão anterior não é re-inicializado" do
      # Migração: quem já tem repo utilizável e nenhuma marca só ganha a marca.
      # Re-inicializar apagaria trabalho.
      project_id = Ecto.UUID.generate()
      bare = create_bare_repo!(true)
      dir = Workspace.ensure!(project_id, bare)

      testemunha = Path.join(dir, "nao-me-apague.txt")
      File.write!(testemunha, "trabalho do agente")
      File.rm!(Path.join(dir, ".brabo-workspace-pronto"))

      assert Workspace.ensure!(project_id, bare) == dir
      assert File.read!(testemunha) == "trabalho do agente"
      assert File.regular?(Path.join(dir, ".brabo-workspace-pronto"))
    end

    test "dois `ensure!` concorrentes terminam com UM workspace pronto" do
      # O caso real: a ativação sobe um dev agent por módulo, e os dois chamam
      # `ensure!` ao mesmo tempo.
      project_id = Ecto.UUID.generate()
      bare = create_bare_repo!(true)

      resultados =
        [1, 2]
        |> Enum.map(fn _ -> Task.async(fn -> Workspace.ensure!(project_id, bare) end) end)
        |> Enum.map(&Task.await(&1, 30_000))

      dir = Workspace.workspace_dir(project_id)
      assert resultados == [dir, dir]
      assert File.regular?(Path.join(dir, ".brabo-workspace-pronto"))

      # E o repositório está utilizável: é o que o `git worktree add` do
      # segundo agente exige, e o que falhava antes.
      assert {_, 0} =
               System.cmd("git", ["rev-parse", "--is-inside-work-tree"],
                 cd: dir,
                 stderr_to_stdout: true
               )
    end
  end
end
