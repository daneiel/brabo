defmodule Engine.Gates.QaEstrategiaAgentTest do
  # DataCase — o ToolLoop monta o system prompt via o harness (lê o banco,
  # `ContextBuilder.build_layers/2`), como QaPerformanceSegurancaAgentTest.
  # O ToolLoop real roda síncrono contra o fake de LLM (dicionário de
  # processo).
  use Engine.DataCase, async: false

  alias Engine.Gates.QaEstrategiaAgent
  alias Engine.Sessions.FakeEngineApiClient

  setup do
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())
    # `QaEstrategiaAgent` roda sem `workspace_root` (ver o moduledoc dele) —
    # o ToolLoop cai no fallback `Workspace.workspace_dir/1`, que lê este env.
    Application.put_env(:engine, :project_workspaces_root, System.tmp_dir!())

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :test_pid)
      Application.delete_env(:engine, :tool_loop_max_iterations)
      Application.delete_env(:engine, :project_workspaces_root)
    end)

    # UUID de verdade: `ContextBuilder.build_layers/2` (via `system_prompt/1`
    # do ToolLoop) lê o banco por `project_id`, e o tipo da coluna é uuid.
    %{project_id: Ecto.UUID.generate(), session_id: Ecto.UUID.generate()}
  end

  defp story do
    %{
      "id" => "st-1",
      "title" => "Cadastro de usuário",
      "description" => "Como visitante, quero me cadastrar.",
      "rf" => ["Aceita e-mail e senha"],
      "rnf" => [],
      "dod" => ["Testes de unidade verdes"]
    }
  end

  defp emitir_plano do
    FakeEngineApiClient.tool_call_response("emit_plano_de_teste", %{
      "planoDeTeste" => "Cobrir cadastro feliz e e-mail duplicado.",
      "criteriosExecutaveis" => ["dado e-mail novo, quando cadastra, então cria a conta"],
      "estrategiaDeAutomacao" => "testes de integração na api"
    })
  end

  test "lê algo, emite o plano e o artefato entra no event log da sessão", %{
    project_id: project_id,
    session_id: session_id
  } do
    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("read_file", %{"path" => "src/cadastro.ts"}),
      emitir_plano()
    ])

    assert {:ok, plano} = QaEstrategiaAgent.run(project_id, session_id, story(), nil)

    assert plano.criterios_executaveis == [
             "dado e-mail novo, quando cadastra, então cria a conta"
           ]

    assert_received {:event_appended, ^project_id, ^session_id,
                     %{
                       type: "artifact.plano_de_teste",
                       actorId: "qa-estrategia",
                       payload: payload
                     }}

    assert payload.storyId == "st-1"
    assert payload.estrategiaDeAutomacao == "testes de integração na api"
  end

  test "module_map vigente entra no contexto do modelo, sem quebrar sem ele", %{
    project_id: project_id,
    session_id: session_id
  } do
    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("search_workspace", %{"query" => "cadastro"}),
      emitir_plano()
    ])

    module_map = %{"modules" => [%{"name" => "api", "stack" => "NestJS"}]}

    assert {:ok, _plano} = QaEstrategiaAgent.run(project_id, session_id, story(), module_map)

    assert_received {:llm_turn, "qa-estrategia", messages, _tools}
    # messages[0] é o system prompt que o ToolLoop injeta; a mensagem que
    # `build_ctx/4` monta (com o module_map) é a seguinte.
    conteudo = messages |> Enum.at(1) |> Map.get("content")
    assert conteudo =~ "api"
  end

  test "limite de iterações sem emit_plano_de_teste vira agent.error, origem modelo", %{
    project_id: project_id,
    session_id: session_id
  } do
    Process.put(
      :fake_llm_always,
      FakeEngineApiClient.tool_call_response("read_file", %{"path" => "x"})
    )

    Application.put_env(:engine, :tool_loop_max_iterations, 2)

    assert {:error, motivo} = QaEstrategiaAgent.run(project_id, session_id, story(), nil)
    assert motivo =~ "limite de iterações"

    assert_received {:event_appended, ^project_id, ^session_id,
                     %{type: "agent.error", actorId: "qa-estrategia", payload: payload}}

    assert payload.origem == "modelo"
    refute_received {:event_appended, _, _, %{type: "artifact.plano_de_teste"}}
  end

  test "modelo para sem chamar a ferramenta: falha narrada, origem modelo", %{
    project_id: project_id,
    session_id: session_id
  } do
    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.final_response("não sei o que fazer")
    ])

    assert {:error, motivo} = QaEstrategiaAgent.run(project_id, session_id, story(), nil)
    assert motivo =~ "emit_plano_de_teste"

    assert_received {:event_appended, ^project_id, ^session_id,
                     %{type: "agent.error", payload: %{origem: "modelo"}}}
  end
end
