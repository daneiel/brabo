defmodule Engine.Gates.QaEstrategiaAgentTest do
  # DataCase — o ToolLoop monta o system prompt via o harness (lê o banco,
  # `ContextBuilder.build_layers/2`), como QaPerformanceSegurancaAgentTest.
  # O ToolLoop real roda síncrono contra o fake de LLM (dicionário de
  # processo).
  #
  # Desde o ADR 0192 (RN-674) este agente roda DEPOIS da entrega do dev, com
  # o MESMO `dev_state`/`dev_context` das subespecialidades de QA e a lista de
  # arquivos do diff — quem a calcula é o `QaLeadServer`, e a fiação inteira
  # (plano antes da Automação, reuso por task, falha que não segura a
  # revisão) está provada em `qa_lead_server_test.exs`.
  use Engine.DataCase, async: false

  alias Engine.Gates.QaEstrategiaAgent
  alias Engine.Sessions.FakeEngineApiClient

  setup do
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    worktree =
      Path.join(
        System.tmp_dir!(),
        "brabo-qa-estrategia-#{System.os_time(:microsecond)}-#{System.unique_integer([:positive])}"
      )

    File.mkdir_p!(worktree)

    on_exit(fn ->
      File.rm_rf!(worktree)
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :test_pid)
      Application.delete_env(:engine, :tool_loop_max_iterations)
    end)

    # UUID de verdade: `ContextBuilder.build_layers/2` (via `system_prompt/1`
    # do ToolLoop) lê o banco por `project_id`, e o tipo da coluna é uuid.
    %{
      project_id: Ecto.UUID.generate(),
      session_id: Ecto.UUID.generate(),
      dev_state: %{worktree_path: worktree, task_budget_micros: nil}
    }
  end

  defp dev_context do
    %{
      task: %{"id" => "task-1", "title" => "Cadastro na api"},
      story: %{
        "id" => "st-1",
        "title" => "Cadastro de usuário",
        "description" => "Como visitante, quero me cadastrar.",
        "rf" => ["Aceita e-mail e senha"],
        "rnf" => [],
        "dod" => ["Testes de unidade verdes"]
      },
      business_rules_units: [],
      task_state_units: []
    }
  end

  defp emitir_plano do
    FakeEngineApiClient.tool_call_response("emit_plano_de_teste", %{
      "planoDeTeste" => "Cobrir cadastro feliz e e-mail duplicado.",
      "criteriosExecutaveis" => ["dado e-mail novo, quando cadastra, então cria a conta"],
      "estrategiaDeAutomacao" => "testes de integração na api"
    })
  end

  defp conteudo_inicial(messages) do
    # messages[0] é o system prompt que o ToolLoop injeta; a mensagem que
    # `build_ctx/5` monta é a seguinte.
    messages |> Enum.at(1) |> Map.get("content")
  end

  test "lê a entrega, emite o plano, e o artefato carrega story E task", %{
    project_id: project_id,
    session_id: session_id,
    dev_state: dev_state
  } do
    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("read_file", %{"path" => "src/cadastro.ts"}),
      emitir_plano()
    ])

    assert {:ok, plano} =
             QaEstrategiaAgent.run(
               project_id,
               session_id,
               "task-1",
               dev_state,
               dev_context(),
               {:ok, ["src/cadastro.ts"]}
             )

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
    assert payload.taskId == "task-1"
    assert payload.estrategiaDeAutomacao == "testes de integração na api"
  end

  # RN-805 (AT-478): no uso real o modelo mandou `criteriosExecutaveis` como
  # STRING JSON; a tool (args normalizados) disse "9 critérios", o hook leu o
  # cru, o artefato foi recusado com `:criterios_vazios` e a Automação caiu no
  # `Enum` da string — o QA Lead morreu e o gate ficou 18 min parado.
  test "critérios em string JSON viram lista: o plano é gravado e devolvido como lista", %{
    project_id: project_id,
    session_id: session_id,
    dev_state: dev_state
  } do
    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("read_file", %{"path" => "src/app.js"}),
      FakeEngineApiClient.tool_call_response("emit_plano_de_teste", %{
        "planoDeTeste" => "Cobrir o handler de erros.",
        "criteriosExecutaveis" => ~s(["dado X, quando Y, então Z", "dado A, então B"]),
        "estrategiaDeAutomacao" => "integração"
      })
    ])

    assert {:ok, plano} =
             QaEstrategiaAgent.run(
               project_id,
               session_id,
               "task-1",
               dev_state,
               dev_context(),
               {:ok, []}
             )

    assert plano.criterios_executaveis == ["dado X, quando Y, então Z", "dado A, então B"]

    assert_received {:event_appended, ^project_id, ^session_id,
                     %{type: "artifact.plano_de_teste", payload: payload}}

    assert payload.criteriosExecutaveis == plano.criterios_executaveis
    refute_received {:event_appended, _, _, %{type: "qa-estrategia.error"}}
  end

  test "os arquivos da entrega entram na mensagem — é o que aponta as 8 iterações", %{
    project_id: project_id,
    session_id: session_id,
    dev_state: dev_state
  } do
    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("read_file", %{"path" => "src/cadastro.ts"}),
      emitir_plano()
    ])

    assert {:ok, _plano} =
             QaEstrategiaAgent.run(
               project_id,
               session_id,
               "task-1",
               dev_state,
               dev_context(),
               {:ok, ["apps/api/src/cadastro.ts", "apps/api/test/cadastro.spec.ts"]}
             )

    assert_received {:llm_turn, "qa-estrategia", messages, _tools}
    conteudo = conteudo_inicial(messages)
    assert conteudo =~ "- apps/api/src/cadastro.ts"
    assert conteudo =~ "- apps/api/test/cadastro.spec.ts"
    assert conteudo =~ "ENTREGOU"
    assert conteudo =~ "Cadastro na api"
  end

  test "diff que falhou não derruba o plano: a mensagem diz POR QUE não listou", %{
    project_id: project_id,
    session_id: session_id,
    dev_state: dev_state
  } do
    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("search_workspace", %{"query" => "cadastro"}),
      emitir_plano()
    ])

    assert {:ok, _plano} =
             QaEstrategiaAgent.run(
               project_id,
               session_id,
               "task-1",
               dev_state,
               dev_context(),
               {:error, :not_found}
             )

    assert_received {:llm_turn, "qa-estrategia", messages, _tools}
    assert conteudo_inicial(messages) =~ "não consegui listar: :not_found"
  end

  test "limite de iterações sem emit_plano_de_teste vira agent.error, origem modelo", %{
    project_id: project_id,
    session_id: session_id,
    dev_state: dev_state
  } do
    Process.put(
      :fake_llm_always,
      FakeEngineApiClient.tool_call_response("read_file", %{"path" => "x"})
    )

    Application.put_env(:engine, :tool_loop_max_iterations, 2)

    assert {:error, motivo} =
             QaEstrategiaAgent.run(
               project_id,
               session_id,
               "task-1",
               dev_state,
               dev_context(),
               {:ok, []}
             )

    assert motivo =~ "limite de iterações"

    assert_received {:event_appended, ^project_id, ^session_id,
                     %{type: "agent.error", actorId: "qa-estrategia", payload: payload}}

    assert payload.origem == "modelo"
    refute_received {:event_appended, _, _, %{type: "artifact.plano_de_teste"}}
  end

  test "modelo para sem chamar a ferramenta: falha narrada, origem modelo", %{
    project_id: project_id,
    session_id: session_id,
    dev_state: dev_state
  } do
    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.final_response("não sei o que fazer")
    ])

    assert {:error, motivo} =
             QaEstrategiaAgent.run(
               project_id,
               session_id,
               "task-1",
               dev_state,
               dev_context(),
               {:ok, []}
             )

    assert motivo =~ "emit_plano_de_teste"

    assert_received {:event_appended, ^project_id, ^session_id,
                     %{type: "agent.error", payload: %{origem: "modelo"}}}
  end
end
