defmodule Engine.Harness.DebugTest do
  # async: false — Application env global (:project_workspaces_root) + cache
  # ETS + leitura de projects/agent_instructions sob sandbox.
  use Engine.DataCase, async: false

  alias Engine.Harness.Debug
  alias Engine.Actions.Workspace

  setup do
    root =
      Path.join(
        System.tmp_dir!(),
        "brabo-debug-test-#{System.os_time(:microsecond)}-#{System.unique_integer([:positive])}"
      )

    File.mkdir_p!(root)
    Application.put_env(:engine, :project_workspaces_root, root)
    on_exit(fn -> File.rm_rf!(root) end)
    :ok
  end

  defp seed!(project_id, agent) do
    Repo.query!(
      "INSERT INTO public.projects (id, name, slug) VALUES ($1, $2, $3)",
      [Ecto.UUID.dump!(project_id), "Loja Online", "loja-online"]
    )

    Repo.query!(
      "INSERT INTO public.project_repositories (id, project_id, provider, external_id, url, default_branch, visibility, provisioned_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        Ecto.UUID.bingenerate(),
        Ecto.UUID.dump!(project_id),
        "local",
        "/tmp/repo.git",
        "file:///tmp/repo.git",
        "main",
        "private",
        Ecto.UUID.bingenerate()
      ]
    )

    Repo.query!(
      "INSERT INTO public.agent_instructions (id, project_id, agent, content, version) VALUES ($1,$2,$3,$4,$5)",
      [Ecto.UUID.bingenerate(), Ecto.UUID.dump!(project_id), agent, "instrução do BANCO", 1]
    )

    path = Path.join(Workspace.workspace_dir(project_id), "AGENTS.md")
    File.mkdir_p!(Path.dirname(path))
    File.write!(path, "instrução da RAIZ")
  end

  test "assemble/2 monta as 5 camadas na ordem certa, com tokens estimados" do
    project_id = Ecto.UUID.generate()
    agent = "arquiteto"
    seed!(project_id, agent)

    report = Debug.assemble(project_id, agent)

    assert Enum.map(report.layers, & &1.id) == [
             :identidade,
             :instruction_files,
             :contexto_projeto,
             :regras_negocio,
             :estado_tarefa
           ]

    assert report.estimated == true
    assert Enum.all?(report.layers, &(&1.estimated == true))
    assert Enum.all?(report.layers, &is_integer(&1.tokens))
    assert report.total_tokens == Enum.sum(Enum.map(report.layers, & &1.tokens))
  end

  test "as camadas trazem o conteúdo real (identidade, instruções mescladas, contexto)" do
    project_id = Ecto.UUID.generate()
    agent = "arquiteto"
    seed!(project_id, agent)

    report = Debug.assemble(project_id, agent)
    by_id = Map.new(report.layers, &{&1.id, &1})

    assert by_id[:identidade].rendered =~ "Arquiteto"
    # Camada de instruções traz raiz + banco mesclados.
    assert by_id[:instruction_files].rendered =~ "instrução da RAIZ"
    assert by_id[:instruction_files].rendered =~ "instrução do BANCO"
    assert by_id[:contexto_projeto].rendered =~ "Loja Online"
    # Sem fonte ainda -> vazias.
    assert by_id[:regras_negocio].rendered == ""
    assert by_id[:estado_tarefa].rendered == ""
  end

  test "print/2 imprime anotação de camada e tokens, retorna :ok" do
    project_id = Ecto.UUID.generate()
    agent = "arquiteto"
    seed!(project_id, agent)

    output =
      ExUnit.CaptureIO.capture_io(fn ->
        assert Debug.print(project_id, agent) == :ok
      end)

    assert output =~ "[identidade]"
    assert output =~ "tokens (est)"
    assert output =~ "total:"
  end
end
