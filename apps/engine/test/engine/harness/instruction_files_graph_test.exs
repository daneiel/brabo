defmodule Engine.Harness.InstructionFilesGraphTest do
  @moduledoc """
  Fonte `:graph` de `Engine.Harness.InstructionFiles` (Onda 2, frente C1) —
  `graph_template/2` isolado e a precedência `banco > grafo > diretório >
  raiz` do merge de `load/3`. Mesmo idioma dos vizinhos
  (`engine_api_client_rag_test.exs`): troca `Engine.Sessions.EngineApiClient`
  por `Engine.Sessions.FakeEngineApiClient` e scripta a resposta via
  `Process.put(:fake_prompt_template, ...)`.

  `async: false` — mexe em `Application.env` global
  (`:graph_instruction_templates_enabled?`, `:engine_api_client`) e no cache
  ETS global do harness (`Engine.Harness.InstructionFiles.Cache`); nomes de
  template/projeto são gerados ÚNICOS por teste (`System.unique_integer/1`)
  pra nunca colidir com uma entrada cacheada por outro teste da suite.
  """

  use Engine.DataCase, async: false

  alias Engine.Harness.InstructionFiles
  alias Engine.Actions.Workspace

  setup do
    Application.put_env(:engine, :engine_api_client, Engine.Sessions.FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())
    Application.put_env(:engine, :graph_instruction_templates_enabled?, false)

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :test_pid)
      Application.put_env(:engine, :graph_instruction_templates_enabled?, false)
    end)

    :ok
  end

  defp unique_name(prefix), do: "#{prefix}-#{System.unique_integer([:positive])}"

  describe "graph_template/2" do
    test "devolve o corpo quando a flag está ligada e a api responde com sucesso" do
      Application.put_env(:engine, :graph_instruction_templates_enabled?, true)
      nome = unique_name("tpl")

      Process.put(:fake_prompt_template, %{
        "name" => nome,
        "version" => "1",
        "body" => "conteúdo vindo do grafo",
        "hash" => "abc123"
      })

      assert {:ok, "conteúdo vindo do grafo"} = InstructionFiles.graph_template(nome)
      assert_received {:prompt_template_fetched, ^nome, nil}
    end

    test "não contribui (degrada) quando a api devolve {:error, :not_found}" do
      Application.put_env(:engine, :graph_instruction_templates_enabled?, true)
      nome = unique_name("tpl-404")
      Process.put(:fake_prompt_template, {:error, :not_found})

      assert :none = InstructionFiles.graph_template(nome)
    end

    test "não contribui (degrada) quando a api falha por outro motivo" do
      Application.put_env(:engine, :graph_instruction_templates_enabled?, true)
      nome = unique_name("tpl-down")
      Process.put(:fake_prompt_template, {:error, :econnrefused})

      assert :none = InstructionFiles.graph_template(nome)
    end

    test "flag desligada (default): nunca chama a api" do
      # graph_instruction_templates_enabled? já é false pelo setup — nem
      # precisa scriptar o fake, uma chamada real derrubaria o teste.
      nome = unique_name("tpl-off")

      assert :none = InstructionFiles.graph_template(nome)
      refute_received {:prompt_template_fetched, _, _}
    end

    test "cache: dentro do TTL, a segunda chamada não bate na api de novo" do
      Application.put_env(:engine, :graph_instruction_templates_enabled?, true)
      nome = unique_name("tpl-cache")

      Process.put(:fake_prompt_template, %{
        "name" => nome,
        "version" => "1",
        "body" => "primeira resposta",
        "hash" => "h1"
      })

      assert {:ok, "primeira resposta"} = InstructionFiles.graph_template(nome)
      assert_received {:prompt_template_fetched, ^nome, nil}

      # Mesmo trocando o script, a segunda chamada serve do cache — não há
      # uma segunda notificação de fetch.
      Process.put(:fake_prompt_template, %{
        "name" => nome,
        "version" => "1",
        "body" => "resposta diferente, não deveria aparecer",
        "hash" => "h2"
      })

      assert {:ok, "primeira resposta"} = InstructionFiles.graph_template(nome)
      refute_received {:prompt_template_fetched, ^nome, nil}
    end
  end

  describe "precedência do merge com a fonte :graph" do
    setup do
      root =
        Path.join(
          System.tmp_dir!(),
          "brabo-instr-graph-test-#{System.os_time(:microsecond)}-#{System.unique_integer([:positive])}"
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

    test "grafo entra ACIMA do diretório/raiz e ABAIXO do banco" do
      Application.put_env(:engine, :graph_instruction_templates_enabled?, true)
      project_id = Ecto.UUID.generate()
      # O nome do template do merge genérico é o próprio agente — usar um
      # agente único evita colidir com o cache de outro teste da suite.
      agent = unique_name("agente")

      write_agents!(project_id, "AGENTS.md", "instrução da RAIZ")

      Process.put(:fake_prompt_template, %{
        "name" => agent,
        "version" => "1",
        "body" => "instrução do GRAFO",
        "hash" => "h1"
      })

      result = InstructionFiles.load(project_id, agent)

      assert Enum.map(result.sources, & &1.origin) == [:root, :graph]
      assert result.merged =~ "instrução da RAIZ"
      assert result.merged =~ "instrução do GRAFO"
      assert String.ends_with?(result.merged, "instrução do GRAFO")
    end

    test "banco vence o grafo mesmo com um template ativo no grafo" do
      Application.put_env(:engine, :graph_instruction_templates_enabled?, true)
      project_id = Ecto.UUID.generate()
      agent = unique_name("agente-db")

      Process.put(:fake_prompt_template, %{
        "name" => agent,
        "version" => "1",
        "body" => "instrução do GRAFO",
        "hash" => "h1"
      })

      insert_db_instruction!(project_id, agent, "instrução do BANCO (instruction_patch)", 1)

      result = InstructionFiles.load(project_id, agent)

      assert Enum.map(result.sources, & &1.origin) == [:graph, :db]
      assert String.ends_with?(result.merged, "instrução do BANCO (instruction_patch)")
    end

    test "flag desligada: o merge não inclui fonte :graph nenhuma" do
      # graph_instruction_templates_enabled? volta a false pelo setup pai.
      project_id = Ecto.UUID.generate()
      agent = unique_name("agente-flag-off")

      write_agents!(project_id, "AGENTS.md", "instrução da RAIZ")

      Process.put(:fake_prompt_template, %{
        "name" => agent,
        "version" => "1",
        "body" => "não deveria aparecer",
        "hash" => "h1"
      })

      result = InstructionFiles.load(project_id, agent)

      assert Enum.map(result.sources, & &1.origin) == [:root]
      refute result.merged =~ "não deveria aparecer"
      refute_received {:prompt_template_fetched, _, _}
    end
  end
end
