defmodule Engine.Dev.ContextBuilderTest do
  # DataCase — montar o prompt lê `agent_instructions` e o contexto do projeto
  # do banco (camadas `instruction_files`/`contexto_projeto` do harness).
  # async: false: o fake do EngineApiClient é scriptado por dicionário de
  # processo e o AGENTS.md vai pro disco.
  use Engine.DataCase, async: false

  alias Engine.Dev.ContextBuilder
  alias Engine.Harness.PromptAssembler
  alias Engine.Sessions.FakeEngineApiClient

  setup do
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    project_id = Ecto.UUID.generate()

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :test_pid)
      # O cache de InstructionFiles é chaveado por {project_id, agent, root};
      # sem limpar, um teste veria o AGENTS.md do anterior.
      Engine.Harness.InstructionFiles.invalidate_all(project_id, "dev-api")
    end)

    %{project_id: project_id, session_id: Ecto.UUID.generate()}
  end

  defp dev_context(adrs) do
    %{
      "task" => %{
        "id" => "t-1",
        "title" => "Endpoint de cadastro",
        "description" => "POST /usuarios"
      },
      "story" => %{
        "id" => "st-1",
        "title" => "Cadastro de usuários",
        "description" => "Permitir criar conta",
        "rf" => ["RF1: e-mail único"],
        "rnf" => ["RNF1: responder em até 300ms"],
        "dod" => ["testes passando"],
        "dor" => ["regra aprovada"]
      },
      "businessRules" => [
        %{"title" => "E-mail único", "description" => "Não pode haver duplicado"}
      ],
      "adrs" => adrs
    }
  end

  # Monta o system prompt exatamente como o ToolLoop.Default faz.
  defp system_prompt(project_id, ctx, workspace_root) do
    project_id
    |> Engine.Harness.ContextBuilder.build_layers("dev-api",
      workspace_root: workspace_root,
      business_rules_units: ctx.business_rules_units,
      task_state_units: ctx.task_state_units
    )
    |> PromptAssembler.assemble()
    |> PromptAssembler.Default.render()
  end

  test "o prompt carrega RF/RNF/DoD da story, a task, as regras e os ADRs", %{
    project_id: project_id,
    session_id: session_id
  } do
    Process.put(
      :fake_dev_context,
      dev_context([%{"title" => "Persistência", "content" => "Usar Postgres"}])
    )

    root = Path.join(System.tmp_dir!(), "brabo-ctx-#{System.unique_integer([:positive])}")
    File.mkdir_p!(root)
    File.write!(Path.join(root, "AGENTS.md"), "Convenção do repo: commits em pt-BR.")
    on_exit(fn -> File.rm_rf!(root) end)

    assert {:ok, ctx} = ContextBuilder.fetch(project_id, session_id, "t-1", "api")

    prompt = system_prompt(project_id, ctx, root)

    # Story completa — o que o dev precisa pra implementar.
    assert prompt =~ "Cadastro de usuários"
    assert prompt =~ "RF1: e-mail único"
    assert prompt =~ "RNF1: responder em até 300ms"
    assert prompt =~ "testes passando"
    # Task.
    assert prompt =~ "Endpoint de cadastro"
    # Regras de negócio.
    assert prompt =~ "E-mail único"
    # ADR.
    assert prompt =~ "Usar Postgres"
    # AGENTS.md do repo do projeto (lido da raiz = worktree do agente).
    assert prompt =~ "commits em pt-BR"
  end

  test "o módulo do dev viaja pra api (é o filtro de ADR)", %{
    project_id: project_id,
    session_id: session_id
  } do
    Process.put(:fake_dev_context, dev_context([]))

    assert {:ok, _} = ContextBuilder.fetch(project_id, session_id, "t-1", "api")
    assert_received {:dev_context_fetched, "t-1", "api"}
  end

  test "sem módulo (gates QA/SecOps reusam o contexto) não há filtro", %{
    project_id: project_id,
    session_id: session_id
  } do
    Process.put(:fake_dev_context, dev_context([]))

    assert {:ok, _} = ContextBuilder.fetch(project_id, session_id, "t-1")
    assert_received {:dev_context_fetched, "t-1", nil}
  end

  test "sob pressão de contexto, os ADRs são descartados ANTES da story", %{
    project_id: project_id,
    session_id: session_id
  } do
    # Muitos ADRs gordos: a camada `estado_tarefa` estoura o teto e precisa
    # cortar. O que NÃO pode sumir é a story/task — sem elas o prompt não
    # serve pra implementar nada.
    adrs =
      for i <- 1..12 do
        %{"title" => "ADR #{i}", "content" => String.duplicate("decisão arquitetural ", 200)}
      end

    Process.put(:fake_dev_context, dev_context(adrs))

    root = Path.join(System.tmp_dir!(), "brabo-ctx-#{System.unique_integer([:positive])}")
    File.mkdir_p!(root)
    on_exit(fn -> File.rm_rf!(root) end)

    assert {:ok, ctx} = ContextBuilder.fetch(project_id, session_id, "t-1", "api")
    prompt = system_prompt(project_id, ctx, root)

    assert prompt =~ "RF1: e-mail único",
           "a story foi descartada e os ADRs sobreviveram — prioridade invertida"

    assert prompt =~ "Endpoint de cadastro"
  end
end
