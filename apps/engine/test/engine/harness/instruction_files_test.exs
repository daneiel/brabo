defmodule Engine.Harness.InstructionFilesTest do
  # async: false — mexe no Application env global (:project_workspaces_root) e
  # no cache ETS global do harness. Engine.DataCase porque lê agent_instructions
  # (tabela da api) via Engine.Repo sob sandbox.
  use Engine.DataCase, async: false

  alias Engine.Harness.InstructionFiles
  alias Engine.Actions.Workspace

  setup do
    root =
      Path.join(
        System.tmp_dir!(),
        "brabo-instr-test-#{System.os_time(:microsecond)}-#{System.unique_integer([:positive])}"
      )

    File.mkdir_p!(root)
    Application.put_env(:engine, :project_workspaces_root, root)
    on_exit(fn -> File.rm_rf!(root) end)
    :ok
  end

  defp write_agents!(project_id, rel_path, content) do
    path = Path.join(Workspace.workspace_dir(project_id), rel_path)
    File.mkdir_p!(Path.dirname(path))
    File.write!(path, content)
  end

  defp insert_db_instruction!(project_id, agent, content, version) do
    Repo.query!(
      "INSERT INTO public.agent_instructions (id, project_id, agent, content, version) VALUES ($1, $2, $3, $4, $5)",
      [Ecto.UUID.bingenerate(), Ecto.UUID.dump!(project_id), agent, content, version]
    )
  end

  test "precedência do merge: banco > diretório > raiz (banco por último, vence)" do
    project_id = Ecto.UUID.generate()
    agent = "arquiteto"

    write_agents!(project_id, "AGENTS.md", "instrução da RAIZ")
    write_agents!(project_id, "modulo/AGENTS.md", "instrução do DIRETÓRIO")
    insert_db_instruction!(project_id, agent, "instrução do BANCO", 1)

    result = InstructionFiles.load(project_id, agent)

    # Ordem crescente de precedência (raiz -> diretório -> banco).
    assert Enum.map(result.sources, & &1.origin) == [:root, :directory, :db]
    # Banco é o mais autoritativo -> aparece por último no merge (last wins).
    assert String.starts_with?(result.merged, "<!-- AGENTS.md (raiz) -->")
    assert String.ends_with?(result.merged, "instrução do BANCO")
  end

  test "diretório mais profundo tem precedência sobre o mais raso" do
    project_id = Ecto.UUID.generate()
    write_agents!(project_id, "a/AGENTS.md", "raso")
    write_agents!(project_id, "a/b/AGENTS.md", "profundo")

    result = InstructionFiles.load(project_id, "po")

    dir_paths = for s <- result.sources, s.origin == :directory, do: s.path
    # a/AGENTS.md (raso) antes de a/b/AGENTS.md (profundo) na ordem crescente.
    assert dir_paths == ["a/AGENTS.md", "a/b/AGENTS.md"]
  end

  test "sem nenhuma fonte: resultado vazio, sem crash" do
    project_id = Ecto.UUID.generate()
    assert InstructionFiles.load(project_id, "criativo") == %{sources: [], merged: ""}
  end

  test "recarga por invalidação simples: cache serve o antigo até invalidar" do
    project_id = Ecto.UUID.generate()
    agent = "arquiteto"
    insert_db_instruction!(project_id, agent, "conteudo-v1", 1)

    assert InstructionFiles.load(project_id, agent).merged =~ "conteudo-v1"

    # Muda no banco; sem invalidar, o cache ainda serve o antigo.
    Repo.query!(
      "UPDATE public.agent_instructions SET content = $1 WHERE project_id = $2 AND agent = $3",
      ["conteudo-v2", Ecto.UUID.dump!(project_id), agent]
    )

    assert InstructionFiles.load(project_id, agent).merged =~ "conteudo-v1"

    :ok = InstructionFiles.invalidate(project_id, agent)
    assert InstructionFiles.load(project_id, agent).merged =~ "conteudo-v2"
  end

  # Fase 4b: a chave do cache é {project_id, agent, root} e a root varia —
  # nil pro workspace compartilhado, o path do worktree pros dev agents.
  # Um patch/rollback precisa limpar TODAS, senão o dev segue servindo a
  # instrução velha do worktree dele.
  test "invalidate_all limpa o cache do agente em TODAS as raízes" do
    project_id = Ecto.UUID.generate()
    agent = "dev-api"
    worktree = Path.join(System.tmp_dir!(), "wt-#{System.unique_integer([:positive])}")
    File.mkdir_p!(worktree)
    on_exit(fn -> File.rm_rf!(worktree) end)

    Repo.query!(
      "INSERT INTO public.agent_instructions (id, project_id, agent, content, version) VALUES ($1, $2, $3, $4, $5)",
      [
        Ecto.UUID.dump!(Ecto.UUID.generate()),
        Ecto.UUID.dump!(project_id),
        agent,
        "conteudo-v1",
        1
      ]
    )

    # Popula o cache nas DUAS raízes.
    assert InstructionFiles.load(project_id, agent).merged =~ "conteudo-v1"
    assert InstructionFiles.load(project_id, agent, root: worktree).merged =~ "conteudo-v1"

    Repo.query!(
      "UPDATE public.agent_instructions SET content = $1 WHERE project_id = $2 AND agent = $3",
      ["conteudo-v2", Ecto.UUID.dump!(project_id), agent]
    )

    # Invalidar só a raiz default deixaria a do worktree velha.
    :ok = InstructionFiles.invalidate_all(project_id, agent)

    assert InstructionFiles.load(project_id, agent).merged =~ "conteudo-v2"
    assert InstructionFiles.load(project_id, agent, root: worktree).merged =~ "conteudo-v2"
  end
end
