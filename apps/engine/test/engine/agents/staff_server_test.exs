defmodule Engine.Agents.StaffServerTest do
  # DataCase — o StaffServer monta o system prompt via o harness (lê o
  # banco). async: false (Application env global). Mesmo padrão de
  # `arquiteto_server_test.exs`: callbacks exercitados DIRETO no processo de
  # teste, fake scriptado por dicionário de processo.
  use Engine.DataCase, async: false

  alias Engine.Agents.StaffServer
  alias Engine.Sessions.FakeEngineApiClient
  import Engine.Agents.TurnoAssincronoCase, only: [sync_call: 3]

  setup do
    root =
      Path.join(
        System.tmp_dir!(),
        "brabo-staff-#{System.os_time(:microsecond)}-#{System.unique_integer([:positive])}"
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
    {:ok, state} = StaffServer.init({session_id, project_id})
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

  defp rfc_args do
    %{
      "problema" => "cada área reinventa a própria paginação",
      "opcoes" => [
        %{"descricao" => "helper único de paginação", "tradeoffs" => "migração de 6 rotas"},
        %{"descricao" => "manter como está", "tradeoffs" => "a divergência continua crescendo"}
      ],
      "recomendacao" => "helper único, migração incremental",
      "poc" => %{"escopo" => "aplicar o helper numa rota só, comparar antes/depois"}
    }
  end

  # `propose_rfc` não é ativado via kickoff — o StaffServer não tem
  # `kickoff/1` (ADR 0088). O turno é sempre disparado por `user_message`,
  # o mesmo caminho que um handoff aceito manualmente abre.
  test "user_message: propõe o RFC, grava o artefato e devolve o handoff ao arquiteto", %{
    state: state,
    session_id: session_id
  } do
    Process.put(:fake_llm_turns, [
      tool_turn("propose_rfc", rfc_args()),
      FakeEngineApiClient.final_response("RFC registrado.")
    ])

    assert {:reply, :ok, _} =
             sync_call(
               StaffServer,
               {:user_message, "problema sistêmico: paginação duplicada"},
               state
             )

    assert_received {:event_appended, _, ^session_id,
                     %{type: "artifact.rfc_staff", payload: payload}}

    assert payload.problema == "cada área reinventa a própria paginação"
    assert length(payload.opcoes) == 2
    assert payload.poc.descartavel == true

    assert_received {:handoff_created, _, ^session_id, "staff", "arquiteto", _artifact_id}
  end

  test "propose_rfc com opções vazias vira tool-result de erro, sem derrubar o loop", %{
    state: state,
    session_id: session_id
  } do
    Process.put(:fake_llm_turns, [
      tool_turn("propose_rfc", Map.put(rfc_args(), "opcoes", [])),
      FakeEngineApiClient.final_response("ok")
    ])

    assert {:reply, :ok, final_state} =
             sync_call(StaffServer, {:user_message, "problema sistêmico"}, state)

    tool_msgs = Enum.filter(final_state.messages, &(&1["role"] == "tool"))
    assert Enum.any?(tool_msgs, &String.contains?(&1["content"], "ao menos uma opção"))

    refute_received {:event_appended, _, ^session_id, %{type: "artifact.rfc_staff"}}
    refute_received {:handoff_created, _, ^session_id, "staff", "arquiteto", _}
  end

  # RN-116/RN-163: a api recusando o handoff não pode derrubar o processo nem
  # perder o RFC já gravado.
  test "falha ao devolver o handoff ao arquiteto NÃO derruba o processo, e o RFC não se perde",
       %{state: state, session_id: session_id} do
    Process.put(:fake_handoff_error, {500, %{"message" => "erro interno"}})

    Process.put(:fake_llm_turns, [
      tool_turn("propose_rfc", rfc_args()),
      FakeEngineApiClient.final_response("ok")
    ])

    assert {:reply, :ok, final_state} =
             sync_call(StaffServer, {:user_message, "problema sistêmico"}, state)

    assert_received {:event_appended, _, ^session_id, %{type: "artifact.rfc_staff"}}
    assert_received {:handoff_created, _, ^session_id, "staff", "arquiteto", _}

    tool_msgs = Enum.filter(final_state.messages, &(&1["role"] == "tool"))
    assert Enum.any?(tool_msgs, &String.contains?(&1["content"], "RFC registrado, mas"))
  end

  test "deltas são rebroadcastados no canal Phoenix", %{state: state, session_id: session_id} do
    Phoenix.PubSub.subscribe(Engine.PubSub, "session:" <> session_id)
    Process.put(:fake_deltas, ["Analisando", " o problema"])
    Process.put(:fake_llm_turns, [FakeEngineApiClient.final_response("feito")])

    assert {:reply, :ok, _} = sync_call(StaffServer, {:user_message, "explica o problema"}, state)

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

    Process.put(:fake_llm_turns, [
      tool_turn("propose_rfc", rfc_args()),
      FakeEngineApiClient.final_response("RFC registrado.")
    ])

    assert {:reply, :ok, _} =
             sync_call(StaffServer, {:user_message, "problema sistêmico"}, state)

    assert_received %Phoenix.Socket.Broadcast{
      event: "tool.call",
      payload: %{tool: "propose_rfc", agent: "staff"} = payload
    }

    refute Map.has_key?(payload, :args)
  end

  # RN-166 (aplicada ao PO) estendida ao Staff: o teto de iterações era
  # SILENCIOSO aqui — `run_turn(state, remaining) when remaining <= 0, do:
  # state` — e um Staff que esgotasse as 14 idas ao modelo terminava sem
  # rastro nenhum.
  test "teto de iterações emite toolloop.limit_reached", %{
    state: state,
    session_id: session_id
  } do
    Process.put(
      :fake_llm_always,
      tool_turn("ferramenta_desconhecida", %{})
    )

    assert {:reply, :ok, _} = sync_call(StaffServer, {:user_message, "vai"}, state)

    assert_received {:event_appended, _, ^session_id,
                     %{type: "toolloop.limit_reached", payload: %{max_iterations: 14}}}
  end

  test "agent.response carrega o nome do modelo (RN-146)", %{
    state: state,
    session_id: session_id
  } do
    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.final_response("RFC pronto.", "gpt-4o-mini")
    ])

    assert {:reply, :ok, _} = sync_call(StaffServer, {:user_message, "problema sistêmico"}, state)

    assert_received {:event_appended, _, ^session_id,
                     %{
                       type: "agent.response",
                       payload: %{content: "RFC pronto.", modelName: "gpt-4o-mini"}
                     }}
  end

  test "erro narrado no frame final vira agent.error e o turno fecha inteiro", %{
    state: state,
    session_id: session_id
  } do
    Process.put(:fake_llm_turns, [%{"error" => "Orçamento da sessão esgotado"}])

    assert {:reply, :ok, final_state} =
             sync_call(StaffServer, {:user_message, "problema sistêmico"}, state)

    assert_received {:event_appended, _, ^session_id, %{type: "agent.error", payload: payload}}
    assert payload.origem == "politica"
    assert payload.mensagem =~ "Orçamento"

    assert final_state.turno_assincrono == nil
  end

  test "rehydration: reconstrói o histórico do event log no init", %{} do
    Process.put(:fake_events, [
      %{"type" => "chat.message", "payload" => %{"text" => "problema sistêmico X"}},
      %{"type" => "agent.response", "payload" => %{"content" => "entendi, vou investigar"}}
    ])

    {:ok, state} = StaffServer.init({Ecto.UUID.generate(), Ecto.UUID.generate()})

    roles = Enum.map(state.messages, & &1["role"])
    assert roles == ["system", "user", "assistant"]
  end

  # `cancel` sem turno em curso é NO-OP — mesmo padrão de
  # `dev_lead_server_test.exs`. O cancelamento de um turno REAL (brutal kill
  # da Task) é genérico e coberto por `turno_assincrono_test.exs`, comum a
  # todos os agentes conversacionais.
  test "cancel sem turno em curso é NO-OP", %{state: state} do
    assert {:noreply, depois_do_cancel} = StaffServer.handle_cast(:cancel, state)
    assert depois_do_cancel == state
  end
end
