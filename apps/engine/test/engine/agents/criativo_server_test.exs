defmodule Engine.Agents.CriativoServerTest do
  # DataCase — o CriativoServer monta o system prompt via o harness, que LÊ o
  # banco. async: false por causa do Application env global. Os callbacks são
  # exercitados DIRETO no processo de teste (init/1 + handle_call/3), então o
  # fake scriptado por dicionário de processo funciona (mesmo padrão do
  # tool_loop_test).
  use Engine.DataCase, async: false

  alias Engine.Agents.CriativoServer
  alias Engine.Sessions.FakeEngineApiClient

  setup do
    root =
      Path.join(
        System.tmp_dir!(),
        "brabo-criativo-#{System.os_time(:microsecond)}-#{System.unique_integer([:positive])}"
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
    {:ok, state} = CriativoServer.init({session_id, project_id})
    %{state: state, session_id: session_id}
  end

  defp business_rule_turn(origin) do
    %{
      "message" => %{
        "role" => "assistant",
        "content" => "Boa! Registrei uma regra de negócio.",
        "toolCalls" => [
          %{
            "id" => "tc1",
            "name" => "emit_artifact",
            "arguments" => %{
              "type" => "business_rule",
              "payload" => %{
                "title" => "Só maiores de 18",
                "description" => "Cadastro exige idade >= 18",
                "origin" => origin
              }
            }
          }
        ]
      },
      "usage" => %{"inputTokens" => 1, "outputTokens" => 1, "estimated" => true},
      "error" => nil
    }
  end

  defp product_brief_tool_turn do
    %{
      "message" => %{
        "role" => "assistant",
        "content" => "",
        "toolCalls" => [
          %{
            "id" => "tc2",
            "name" => "emit_artifact",
            "arguments" => %{
              "type" => "product_brief",
              "payload" => %{"title" => "x", "summary" => "y", "rules" => []}
            }
          }
        ]
      },
      "usage" => %{"estimated" => true},
      "error" => nil
    }
  end

  test "turno normal: emite agent.response e artifact.business_rule (origem válida)", %{
    state: state
  } do
    Process.put(:fake_llm_turns, [business_rule_turn([2])])

    assert {:reply, :ok, new_state} =
             CriativoServer.handle_call(
               {:user_message, "quero um app de cadastro"},
               self(),
               state
             )

    assert_received {:event_appended, _, _, %{type: "agent.response"}}
    assert_received {:event_appended, _, _, %{type: "artifact.business_rule"}}
    # A mensagem do usuário + a resposta entraram no histórico em memória.
    assert Enum.any?(new_state.messages, &(&1["role"] == "user"))
    assert Enum.any?(new_state.messages, &(&1["role"] == "assistant"))
  end

  test "guardrail: turno normal NÃO emite product_brief nem por tool call", %{state: state} do
    Process.put(:fake_llm_turns, [product_brief_tool_turn()])

    assert {:reply, :ok, _} =
             CriativoServer.handle_call({:user_message, "tenta emitir o brief"}, self(), state)

    refute_received {:event_appended, _, _, %{type: "artifact.product_brief"}}
  end

  test "prontidão: emite product_brief e oferece handoff ao PO", %{
    state: state,
    session_id: session_id
  } do
    # Regras já emitidas na sessão viram as refs do brief.
    Process.put(:fake_events, [
      %{"id" => "evt-a", "type" => "artifact.business_rule", "payload" => %{}},
      %{"id" => "evt-b", "type" => "artifact.business_rule", "payload" => %{}}
    ])

    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.final_response("Resumo executivo do produto")
    ])

    assert {:reply, :ok, _} = CriativoServer.handle_call(:confirm_readiness, self(), state)

    assert_received {:event_appended, _, _, %{type: "artifact.product_brief", payload: payload}}
    assert payload["summary"] == "Resumo executivo do produto"
    assert payload["rules"] == ["evt-a", "evt-b"]

    assert_received {:handoff_created, _, ^session_id, "criativo", "po", _artifact_id}
  end

  test "deltas são rebroadcastados no canal Phoenix da sessão", %{
    state: state,
    session_id: session_id
  } do
    Phoenix.PubSub.subscribe(Engine.PubSub, "session:" <> session_id)
    Process.put(:fake_deltas, ["Oi", " tudo bem?"])
    Process.put(:fake_llm_turns, [FakeEngineApiClient.final_response("Oi tudo bem?")])

    assert {:reply, :ok, _} =
             CriativoServer.handle_call({:user_message, "oi"}, self(), state)

    assert_received %Phoenix.Socket.Broadcast{event: "agent.delta", payload: %{text: "Oi"}}

    assert_received %Phoenix.Socket.Broadcast{
      event: "agent.delta",
      payload: %{text: " tudo bem?"}
    }

    assert_received %Phoenix.Socket.Broadcast{event: "agent.done"}
  end

  test "rehydration: reconstrói o histórico do event log no init", %{} do
    Process.put(:fake_events, [
      %{"type" => "chat.message", "payload" => %{"text" => "minha ideia é X"}},
      %{"type" => "agent.response", "payload" => %{"content" => "legal, me conta mais"}},
      %{"type" => "tool.call", "payload" => %{}}
    ])

    {:ok, state} = CriativoServer.init({Ecto.UUID.generate(), Ecto.UUID.generate()})

    roles = Enum.map(state.messages, & &1["role"])
    # system (pinned) + user + assistant; o tool.call é ignorado.
    assert roles == ["system", "user", "assistant"]
    assert Enum.at(state.messages, 1)["content"] == "minha ideia é X"
    assert Enum.at(state.messages, 2)["content"] == "legal, me conta mais"
  end
end
