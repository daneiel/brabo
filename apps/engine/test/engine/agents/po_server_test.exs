defmodule Engine.Agents.PoServerTest do
  # DataCase — o PoServer monta o system prompt via o harness (lê o banco).
  # async: false por causa do Application env global. Os callbacks são
  # exercitados DIRETO no processo de teste (init/1 + handle_cast/2 +
  # handle_call/3), então o fake scriptado por dicionário de processo funciona.
  use Engine.DataCase, async: false

  alias Engine.Agents.PoServer
  alias Engine.Sessions.FakeEngineApiClient

  setup do
    root =
      Path.join(
        System.tmp_dir!(),
        "brabo-po-#{System.os_time(:microsecond)}-#{System.unique_integer([:positive])}"
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
    {:ok, state} = PoServer.init({session_id, project_id})
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

  defp brief_and_rules do
    [
      %{
        "id" => "evt-brief",
        "type" => "artifact.product_brief",
        "payload" => %{"summary" => "App de cadastro de usuários"}
      },
      %{
        "id" => "evt-r1",
        "type" => "artifact.business_rule",
        "payload" => %{"title" => "Só maiores de 18", "description" => "idade >= 18"}
      }
    ]
  end

  test "kickoff: encadeia create_epic → create_story e injeta o resultado", %{state: state} do
    Process.put(:fake_events, brief_and_rules())

    Process.put(:fake_llm_turns, [
      tool_turn("create_epic", %{"title" => "Cadastro"}),
      tool_turn("create_story", %{
        "epic_id" => "ep-1",
        "title" => "Cadastrar usuário",
        "rf" => ["formulário de cadastro"],
        "dod" => ["testes passando"],
        "dor" => ["aceite claro"],
        "business_rule_ids" => ["evt-r1"]
      }),
      FakeEngineApiClient.final_response("Backlog pronto.")
    ])

    assert {:noreply, new_state} = PoServer.handle_cast(:kickoff, state)

    assert_received {:epic_created, %{title: "Cadastro"}}
    assert_received {:story_created, story_fields}
    assert story_fields[:businessRuleIds] == ["evt-r1"]

    # O resultado do create_epic (com id) foi injetado como mensagem `tool`.
    tool_msgs = Enum.filter(new_state.messages, &(&1["role"] == "tool"))
    assert Enum.any?(tool_msgs, &String.contains?(&1["content"], "épico criado"))
  end

  test "create_story com regra inválida vira tool-result de erro (não derruba o loop)", %{
    state: state
  } do
    Process.put(:fake_events, brief_and_rules())
    Process.put(:fake_story_error, {422, %{"message" => "business_rule_id inexistente"}})

    Process.put(:fake_llm_turns, [
      tool_turn("create_story", %{
        "epic_id" => "ep-1",
        "title" => "x",
        "business_rule_ids" => ["nao-existe"]
      }),
      FakeEngineApiClient.final_response("ok")
    ])

    assert {:noreply, new_state} = PoServer.handle_cast(:kickoff, state)

    tool_msgs = Enum.filter(new_state.messages, &(&1["role"] == "tool"))
    assert Enum.any?(tool_msgs, &String.contains?(&1["content"], "falha ao criar história"))
  end

  test "deltas são rebroadcastados no canal Phoenix", %{state: state, session_id: session_id} do
    Phoenix.PubSub.subscribe(Engine.PubSub, "session:" <> session_id)
    Process.put(:fake_deltas, ["Vou ", "montar o backlog"])
    Process.put(:fake_llm_turns, [FakeEngineApiClient.final_response("feito")])

    assert {:reply, :ok, _} =
             PoServer.handle_call({:user_message, "gere o backlog"}, self(), state)

    assert_received %Phoenix.Socket.Broadcast{event: "agent.delta", payload: %{text: "Vou "}}
    assert_received %Phoenix.Socket.Broadcast{event: "agent.done"}
  end

  describe "revise/2 — devolução de história recusada (Fase 12c, RN-048)" do
    test "injeta a recusa como mensagem FIXADA e roda um turno", %{state: state} do
      Process.put(:fake_llm_turns, [FakeEngineApiClient.final_response("vou revisar")])

      assert {:reply, :ok, new_state} =
               PoServer.handle_call(
                 {:revise,
                  %{
                    "id" => "story-1",
                    "title" => "Cadastro",
                    "reason" => "Falta o caso de recusa do pagamento"
                  }},
                 self(),
                 state
               )

      devolucao =
        Enum.find(new_state.messages, fn m ->
          m["role"] == "user" and String.contains?(m["content"], "RECUSOU promover")
        end)

      assert devolucao, "a devolução tem que entrar no histórico como mensagem do usuário"

      # Fixada: se a compactação a engolisse, o PO reproporia a mesma história
      # com o mesmo defeito.
      assert devolucao[:pinned] == true

      assert String.contains?(devolucao["content"], "Cadastro")
      assert String.contains?(devolucao["content"], "Falta o caso de recusa do pagamento")
      # A frase de precedência (lição do ADR 0020).
      assert String.contains?(devolucao["content"], "PREVALECE")
      # O modelo precisa saber o que PODE fazer: não existe editar história.
      assert String.contains?(devolucao["content"], "create_story")
    end

    test "vivo?/1 é falso quando não há PO registrado para a sessão" do
      refute PoServer.vivo?(Ecto.UUID.generate())
    end
  end

  test "rehydration: reconstrói o histórico do event log no init", %{} do
    Process.put(:fake_events, [
      %{"type" => "chat.message", "payload" => %{"text" => "quero um app"}},
      %{"type" => "agent.response", "payload" => %{"content" => "beleza"}},
      %{"type" => "artifact.product_brief", "payload" => %{"summary" => "s"}}
    ])

    {:ok, state} = PoServer.init({Ecto.UUID.generate(), Ecto.UUID.generate()})

    roles = Enum.map(state.messages, & &1["role"])
    # system (pinned) + user + assistant; artefatos são ignorados na rehydration.
    assert roles == ["system", "user", "assistant"]
  end
end
