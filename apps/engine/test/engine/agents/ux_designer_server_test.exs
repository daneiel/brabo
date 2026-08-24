defmodule Engine.Agents.UxDesignerServerTest do
  # DataCase — o UxDesignerServer monta o system prompt via o harness (lê o
  # banco). async: false (Application env global). Callbacks exercitados
  # DIRETO no processo de teste, como no ArquitetoServerTest/DevLeadServerTest.
  use Engine.DataCase, async: false

  alias Engine.Agents.UxDesignerServer
  alias Engine.Sessions.FakeEngineApiClient
  import Engine.Agents.TurnoAssincronoCase, only: [sync_cast: 3, sync_call: 3]

  setup do
    root =
      Path.join(
        System.tmp_dir!(),
        "brabo-uxdesigner-#{System.os_time(:microsecond)}-#{System.unique_integer([:positive])}"
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
    {:ok, state} = UxDesignerServer.init({session_id, project_id})
    %{state: state, session_id: session_id}
  end

  defp prototipo_turn do
    %{
      "message" => %{
        "role" => "assistant",
        "content" => "",
        "toolCalls" => [
          %{
            "id" => "call-1",
            "name" => "propose_prototype",
            "arguments" => %{
              "personas" => [%{"nome" => "Ana", "objetivo" => "achar o botão"}],
              "jornadas" => [%{"titulo" => "Achar o botão", "passos" => ["abrir", "clicar"]}],
              "prototipo" => %{
                "telas" => [%{"nome" => "Home", "descricao" => "lista de projetos"}],
                "anotacoes" => "botão em --accent"
              },
              "resumo" => "protótipo de uma tela"
            }
          }
        ]
      },
      "usage" => %{"estimated" => true},
      "error" => nil
    }
  end

  defp brief_events do
    [
      %{
        "id" => "b1",
        "type" => "artifact.product_brief",
        "payload" => %{"summary" => "App de tarefas para times pequenos"}
      }
    ]
  end

  describe "kickoff" do
    test "lê o product_brief mais recente e propõe o protótipo", %{state: state} do
      Process.put(:fake_events, brief_events())

      Process.put(:fake_llm_turns, [
        prototipo_turn(),
        FakeEngineApiClient.final_response("Protótipo pronto.")
      ])

      assert {:noreply, _new_state} = sync_cast(UxDesignerServer, :kickoff, state)

      # A instrução de kickoff carrega o resumo do product brief.
      assert_received {:llm_turn_stream, "ux-designer", messages, _tools}
      kickoff_msg = Enum.find(messages, &(&1["role"] == "user"))
      assert kickoff_msg["content"] =~ "App de tarefas para times pequenos"

      assert_received {:event_appended, _, _, %{type: "artifact.prototipo_navegavel"}}
      assert_received {:handoff_created, _, _, "ux-designer", "po", _artifact_id}
      assert_received {:handoff_created, _, _, "ux-designer", "dev-lead", _artifact_id}
    end

    test "sem product_brief na sessão: kickoff genérico, sem derrubar o turno", %{state: state} do
      Process.put(:fake_events, [])
      Process.put(:fake_llm_turns, [FakeEngineApiClient.final_response("Preciso do brief.")])

      assert {:noreply, _} = sync_cast(UxDesignerServer, :kickoff, state)

      assert_received {:llm_turn_stream, "ux-designer", messages, _tools}
      kickoff_msg = Enum.find(messages, &(&1["role"] == "user"))
      assert kickoff_msg["content"] =~ "sem product brief"
    end
  end

  test "agent.response carrega o nome do modelo", %{state: state} do
    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.final_response("Protótipo em andamento.", "claude-haiku")
    ])

    assert {:reply, :ok, _} =
             sync_call(UxDesignerServer, {:user_message, "e aí?"}, state)

    session_id = state.session_id

    assert_received {:event_appended, _, ^session_id,
                     %{
                       type: "agent.response",
                       payload: %{content: "Protótipo em andamento.", modelName: "claude-haiku"}
                     }}
  end

  # A api narra budget/credencial/binding no PRÓPRIO frame final — mesmo
  # ramo crítico de dev_lead_server_test.exs/arquiteto_server_test.exs.
  test "erro narrado no frame final vira agent.error, sem derrubar o processo", %{state: state} do
    Process.put(:fake_llm_turns, [%{"error" => "Nenhuma credencial cadastrada para openrouter"}])

    assert {:reply, :ok, final_state} =
             sync_call(UxDesignerServer, {:user_message, "e aí?"}, state)

    session_id = state.session_id

    assert_received {:event_appended, _, ^session_id, %{type: "agent.error", payload: payload}}
    assert payload.origem == "politica"
    assert payload.mensagem =~ "credencial"

    assert final_state.turno_assincrono == nil
  end

  test "propose_prototype registrado ENCERRA o turno: um só artefato", %{state: state} do
    Process.put(:fake_llm_always, prototipo_turn())

    # `fake_llm_always` sempre devolve a MESMA tool call — se o laço não
    # parasse sozinho, o teto de iterações produziria vários artefatos.
    assert {:reply, :ok, _} = sync_call(UxDesignerServer, {:user_message, "vai"}, state)

    artefatos =
      receber_eventos([])
      |> Enum.filter(&(&1.type == "artifact.prototipo_navegavel"))

    assert length(artefatos) == 1
  end

  # A faixa de atividade da tela de Sessão narra o que o agente está fazendo
  # AO VIVO — o `tool.call` durável já existia, mas só chega no próximo poll
  # do event log. O broadcast é o mesmo evento, efêmero, sem `args` (payload
  # cru nunca viaja por aqui — RN-096/RN-412).
  test "tool.call é rebroadcastado no canal Phoenix, sem os args crus", %{state: state} do
    session_id = state.session_id
    Phoenix.PubSub.subscribe(Engine.PubSub, "session:" <> session_id)
    Process.put(:fake_events, brief_events())
    Process.put(:fake_llm_turns, [prototipo_turn(), FakeEngineApiClient.final_response("ok")])

    assert {:noreply, _} = sync_cast(UxDesignerServer, :kickoff, state)

    assert_received %Phoenix.Socket.Broadcast{
      event: "tool.call",
      payload: %{tool: "propose_prototype", agent: "ux-designer"} = payload
    }

    refute Map.has_key?(payload, :args)
  end

  # RN-166 (aplicada ao PO) estendida ao UX Designer: o teto de iterações era
  # SILENCIOSO aqui — `run_turn(state, remaining) when remaining <= 0, do:
  # state` — e um UX Designer que esgotasse as 14 idas ao modelo terminava
  # sem rastro nenhum. Ferramenta desconhecida nunca conta como sucesso
  # (`desfecho == :ok`), então ela mantém o laço vivo até o teto.
  test "teto de iterações emite toolloop.limit_reached", %{state: state} do
    session_id = state.session_id

    Process.put(
      :fake_llm_always,
      %{
        "message" => %{
          "role" => "assistant",
          "content" => "",
          "toolCalls" => [
            %{"id" => "tc-x", "name" => "ferramenta_desconhecida", "arguments" => %{}}
          ]
        },
        "usage" => %{"estimated" => true},
        "error" => nil
      }
    )

    assert {:reply, :ok, _} = sync_call(UxDesignerServer, {:user_message, "vai"}, state)

    assert_received {:event_appended, _, ^session_id,
                     %{type: "toolloop.limit_reached", payload: %{max_iterations: 14}}}
  end

  defp receber_eventos(acc) do
    receive do
      {:event_appended, _proj, _sess, event} -> receber_eventos([event | acc])
    after
      0 -> acc
    end
  end
end
