defmodule Engine.Agents.ArquitetoServerTest do
  # DataCase — o ArquitetoServer monta o system prompt via o harness (lê o
  # banco). async: false (Application env global). Callbacks exercitados DIRETO
  # no processo de teste (fake scriptado por dicionário de processo).
  use Engine.DataCase, async: false

  alias Engine.Agents.ArquitetoServer
  alias Engine.Sessions.FakeEngineApiClient
  import Engine.Agents.TurnoAssincronoCase, only: [sync_call: 3, sync_cast: 3]

  setup do
    root =
      Path.join(
        System.tmp_dir!(),
        "brabo-arq-#{System.os_time(:microsecond)}-#{System.unique_integer([:positive])}"
      )

    Application.put_env(:engine, :project_workspaces_root, root)
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      File.rm_rf!(root)
      Application.delete_env(:engine, :project_workspaces_root)
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :test_pid)
    end)

    project_id = Ecto.UUID.generate()
    session_id = Ecto.UUID.generate()
    {:ok, state} = ArquitetoServer.init({session_id, project_id})
    %{state: state, session_id: session_id}
  end

  defp tool_turn(name, args) do
    %{
      "message" => %{
        "role" => "assistant",
        "content" => "",
        "toolCalls" => [%{"id" => "tc-#{name}", "name" => name, "arguments" => args}]
      },
      "usage" => %{"estimated" => true},
      "error" => nil
    }
  end

  defp brief_rules_backlog do
    [
      %{"id" => "b1", "type" => "artifact.product_brief", "payload" => %{"summary" => "App X"}},
      %{
        "id" => "r1",
        "type" => "artifact.business_rule",
        "payload" => %{"title" => "Regra", "description" => "..."}
      },
      %{
        "type" => "backlog.story_created",
        "payload" => %{"storyId" => "st-1", "title" => "Cadastro"}
      }
    ]
  end

  test "kickoff: cria module_map, atribui módulos, propõe ADR e emite insight", %{state: state} do
    Process.put(:fake_events, brief_rules_backlog())

    Process.put(:fake_llm_turns, [
      tool_turn("create_module_map", %{
        "modules" => [
          %{"name" => "api", "stack" => "ts", "responsibility" => "x", "depends_on" => []}
        ]
      }),
      tool_turn("assign_story_modules", %{"story_id" => "st-1", "module_ids" => ["api"]}),
      tool_turn("propose_adr", %{
        "title" => "Usar Postgres",
        "slug" => "0001-usar-postgres",
        "content" => "# ADR"
      }),
      tool_turn("emit_insight", %{"title" => "RNF sem módulo", "description" => "tensão"}),
      FakeEngineApiClient.final_response("Arquitetura pronta.")
    ])

    assert {:noreply, _new_state} = sync_cast(ArquitetoServer, :kickoff, state)

    assert_received {:module_map_created, _modules}
    assert_received {:story_modules_assigned, %{storyId: "st-1", moduleIds: ["api"]}}
    assert_received {:propose_action, "open_adr_pr", _actor, %{slug: "0001-usar-postgres"}}
    assert_received {:event_appended, _, _, %{type: "artifact.insight"}}
  end

  test "module_map com ciclo vira tool-result de erro (não derruba o loop)", %{state: state} do
    Process.put(:fake_events, brief_rules_backlog())
    Process.put(:fake_module_map_error, {400, %{"message" => "ciclo de dependência"}})

    Process.put(:fake_llm_turns, [
      tool_turn("create_module_map", %{
        "modules" => [
          %{"name" => "a", "stack" => "ts", "responsibility" => "x", "depends_on" => ["b"]},
          %{"name" => "b", "stack" => "ts", "responsibility" => "x", "depends_on" => ["a"]}
        ]
      }),
      FakeEngineApiClient.final_response("ok")
    ])

    assert {:noreply, new_state} = sync_cast(ArquitetoServer, :kickoff, state)

    tool_msgs = Enum.filter(new_state.messages, &(&1["role"] == "tool"))
    assert Enum.any?(tool_msgs, &String.contains?(&1["content"], "falha ao criar module_map"))
  end

  test "deltas são rebroadcastados no canal Phoenix", %{state: state, session_id: session_id} do
    Phoenix.PubSub.subscribe(Engine.PubSub, "session:" <> session_id)
    Process.put(:fake_deltas, ["Analisando", " a arquitetura"])
    Process.put(:fake_llm_turns, [FakeEngineApiClient.final_response("feito")])

    assert {:reply, :ok, _} =
             sync_call(ArquitetoServer, {:user_message, "defina a arquitetura"}, state)

    assert_received %Phoenix.Socket.Broadcast{
      event: "agent.delta",
      payload: %{text: "Analisando"}
    }

    assert_received %Phoenix.Socket.Broadcast{event: "agent.done"}
  end

  # A faixa de atividade da tela de Sessão narra o que o agente está fazendo
  # AO VIVO — o `tool.call` durável já existia, mas só chega no próximo poll
  # do event log. O broadcast é o mesmo evento, efêmero, sem `args` (payload
  # cru nunca viaja por aqui — RN-096/RN-412).
  test "tool.call é rebroadcastado no canal Phoenix, sem os args crus", %{
    state: state,
    session_id: session_id
  } do
    Phoenix.PubSub.subscribe(Engine.PubSub, "session:" <> session_id)
    Process.put(:fake_events, brief_rules_backlog())

    Process.put(:fake_llm_turns, [
      tool_turn("create_module_map", %{"modules" => []}),
      FakeEngineApiClient.final_response("ok")
    ])

    assert {:noreply, _} = sync_cast(ArquitetoServer, :kickoff, state)

    assert_received %Phoenix.Socket.Broadcast{
      event: "tool.call",
      payload: %{tool: "create_module_map", agent: "arquiteto"} = payload
    }

    refute Map.has_key?(payload, :args)
  end

  # RN-166 (aplicada ao PO) estendida ao Arquiteto: o teto de iterações era
  # SILENCIOSO aqui — `run_turn(state, remaining) when remaining <= 0, do:
  # state` — e um Arquiteto que esgotasse as 14 idas ao modelo terminava sem
  # rastro nenhum, indistinguível de um turno bem-sucedido.
  test "teto de iterações emite toolloop.limit_reached", %{state: state, session_id: session_id} do
    Process.put(
      :fake_llm_always,
      tool_turn("ferramenta_desconhecida", %{})
    )

    assert {:reply, :ok, _} =
             sync_call(ArquitetoServer, {:user_message, "vai"}, state)

    assert_received {:event_appended, _, ^session_id,
                     %{type: "toolloop.limit_reached", payload: %{max_iterations: 14}}}
  end

  # Achado do problema 2 (RN-146): o `agent.response` carrega o nome do
  # modelo que gerou a resposta, extraído do frame `final` da api.
  test "agent.response carrega o nome do modelo", %{state: state, session_id: session_id} do
    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.final_response("Arquitetura pronta.", "gpt-4o-mini")
    ])

    assert {:reply, :ok, _} =
             sync_call(ArquitetoServer, {:user_message, "defina a arquitetura"}, state)

    assert_received {:event_appended, _, ^session_id,
                     %{
                       type: "agent.response",
                       payload: %{content: "Arquitetura pronta.", modelName: "gpt-4o-mini"}
                     }}
  end

  test "offer_infra_handoff: roda o turno de fechamento e oferece o handoff ao infra", %{
    state: state,
    session_id: session_id
  } do
    Process.put(:fake_llm_turns, [FakeEngineApiClient.final_response("Arquitetura fechada.")])

    assert {:reply, :ok, _} = sync_call(ArquitetoServer, :offer_infra_handoff, state)

    assert_received {:handoff_created, _, ^session_id, "arquiteto", "infra", nil}
  end

  test "offer_dev_handoff: oferece o handoff ao dev-lead sem rodar turno de LLM", %{
    state: state,
    session_id: session_id
  } do
    assert {:reply, :ok, _} = ArquitetoServer.handle_call(:offer_dev_handoff, self(), state)

    assert_received {:handoff_created, _, ^session_id, "arquiteto", "dev-lead", nil}
  end

  # RN-116: mesmo achado do Criativo → PO (`criativo_server_test.exs`), aqui
  # nos dois handoffs do Arquiteto. `{:ok, _handoff} = ...` era um match
  # rígido — a api recusando o handoff derrubava o GenServer inteiro.
  test "offer_infra_handoff: falha ao criar o handoff NÃO derruba o processo, e vira agent.error",
       %{state: state, session_id: session_id} do
    Phoenix.PubSub.subscribe(Engine.PubSub, "session:" <> session_id)
    Process.put(:fake_handoff_error, {500, %{"message" => "erro interno"}})
    Process.put(:fake_llm_turns, [FakeEngineApiClient.final_response("Arquitetura fechada.")])

    assert {:reply, :ok, _} = sync_call(ArquitetoServer, :offer_infra_handoff, state)

    assert_received {:event_appended, _, ^session_id, %{type: "agent.error", payload: payload}}
    assert payload.origem == "infra"
    assert payload.mensagem =~ "Não consegui oferecer o handoff ao infra"

    assert_received %Phoenix.Socket.Broadcast{event: "agent.error"}
  end

  test "offer_dev_handoff: falha ao criar o handoff NÃO derruba o processo, e vira agent.error",
       %{state: state, session_id: session_id} do
    Phoenix.PubSub.subscribe(Engine.PubSub, "session:" <> session_id)
    Process.put(:fake_handoff_error, {500, %{"message" => "erro interno"}})

    assert {:reply, :ok, _} = ArquitetoServer.handle_call(:offer_dev_handoff, self(), state)

    assert_received {:event_appended, _, ^session_id, %{type: "agent.error", payload: payload}}
    assert payload.origem == "infra"
    assert payload.mensagem =~ "Não consegui oferecer o handoff ao dev-lead"

    assert_received %Phoenix.Socket.Broadcast{event: "agent.error"}
  end

  test "rehydration: reconstrói o histórico do event log no init", %{} do
    Process.put(:fake_events, [
      %{"type" => "chat.message", "payload" => %{"text" => "oi"}},
      %{"type" => "agent.response", "payload" => %{"content" => "olá"}},
      %{"type" => "artifact.product_brief", "payload" => %{"summary" => "s"}}
    ])

    {:ok, state} = ArquitetoServer.init({Ecto.UUID.generate(), Ecto.UUID.generate()})

    roles = Enum.map(state.messages, & &1["role"])
    assert roles == ["system", "user", "assistant"]
  end

  # A api narra budget/credencial/binding no PRÓPRIO frame final, e esse ramo
  # devolvia `{state, ""}` — uma TUPLA onde todos os outros ramos devolvem o
  # mapa do state. `TurnoAssincrono.tratar_resultado/2` faz `Map.put/3` no que a
  # task devolveu: numa tupla isso é `BadMapError` dentro do `handle_info`, e o
  # agente (`restart: :temporary`) morria sem voltar. Aqui o ciclo COMPLETO
  # roda — `sync_call/3` passa pelo `handle_info` —, então a falha derrubaria o
  # teste. A prova a nível de PROCESSO está em `po_server_test.exs`.
  test "erro narrado no frame final vira agent.error e o turno fecha inteiro", %{
    state: state,
    session_id: session_id
  } do
    Process.put(:fake_llm_turns, [%{"error" => "Orçamento da sessão esgotado"}])

    assert {:reply, :ok, final_state} =
             sync_call(ArquitetoServer, {:user_message, "e aí?"}, state)

    assert_received {:event_appended, _, ^session_id, %{type: "agent.error", payload: payload}}
    assert payload.origem == "politica"
    assert payload.mensagem =~ "Orçamento"

    # O ramo devolveu o formato certo, e não foi a segunda barreira do
    # `TurnoAssincrono` que salvou o agente — ela narraria com origem `codigo`.
    refute_received {:event_appended, _, _, %{type: "agent.error", payload: %{origem: "codigo"}}}

    assert final_state.turno_assincrono == nil
  end
end
