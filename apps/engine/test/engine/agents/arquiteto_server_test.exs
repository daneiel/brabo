defmodule Engine.Agents.ArquitetoServerTest do
  # DataCase — o ArquitetoServer monta o system prompt via o harness (lê o
  # banco). async: false (Application env global). Callbacks exercitados DIRETO
  # no processo de teste (fake scriptado por dicionário de processo).
  use Engine.DataCase, async: false

  alias Engine.Agents.ArquitetoServer
  alias Engine.Sessions.FakeEngineApiClient

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

    assert {:noreply, _new_state} = ArquitetoServer.handle_cast(:kickoff, state)

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

    assert {:noreply, new_state} = ArquitetoServer.handle_cast(:kickoff, state)

    tool_msgs = Enum.filter(new_state.messages, &(&1["role"] == "tool"))
    assert Enum.any?(tool_msgs, &String.contains?(&1["content"], "falha ao criar module_map"))
  end

  test "deltas são rebroadcastados no canal Phoenix", %{state: state, session_id: session_id} do
    Phoenix.PubSub.subscribe(Engine.PubSub, "session:" <> session_id)
    Process.put(:fake_deltas, ["Analisando", " a arquitetura"])
    Process.put(:fake_llm_turns, [FakeEngineApiClient.final_response("feito")])

    assert {:reply, :ok, _} =
             ArquitetoServer.handle_call({:user_message, "defina a arquitetura"}, self(), state)

    assert_received %Phoenix.Socket.Broadcast{
      event: "agent.delta",
      payload: %{text: "Analisando"}
    }

    assert_received %Phoenix.Socket.Broadcast{event: "agent.done"}
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
end
