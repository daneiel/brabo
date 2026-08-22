defmodule Engine.Agents.DevLeadServerTest do
  # DataCase — o DevLeadServer monta o system prompt via o harness (lê o
  # banco). async: false (Application env global). Callbacks exercitados
  # DIRETO no processo de teste, como no ArquitetoServerTest.
  use Engine.DataCase, async: false

  alias Engine.Agents.DevLeadServer
  alias Engine.Sessions.FakeEngineApiClient
  import Engine.Agents.TurnoAssincronoCase, only: [sync_cast: 3, sync_call: 3]

  setup do
    root =
      Path.join(
        System.tmp_dir!(),
        "brabo-devlead-#{System.os_time(:microsecond)}-#{System.unique_integer([:positive])}"
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
    {:ok, state} = DevLeadServer.init({session_id, project_id})
    %{state: state}
  end

  defp plano_turn(resumo) do
    %{
      "message" => %{
        "role" => "assistant",
        "content" => "",
        "toolCalls" => [
          %{
            "id" => "call-#{System.unique_integer([:positive])}",
            "name" => "propose_execution_plan",
            "arguments" => %{
              "modulos" => [
                %{"modulo" => "api", "agentes" => 1, "porque" => "uma história"}
              ],
              "resumo" => resumo
            }
          }
        ]
      },
      "usage" => %{"estimated" => true},
      "error" => nil
    }
  end

  defp propostas_de_plano do
    receber_propostas([])
  end

  defp receber_propostas(acc) do
    receive do
      {:propose_action, "propose_execution_plan", _actor, payload} ->
        receber_propostas([payload | acc])

      {:propose_action, _outro_tipo, _actor, _payload} ->
        receber_propostas(acc)
    after
      0 -> Enum.reverse(acc)
    end
  end

  # --- ADR 0090: assess_implementability -------------------------------

  defp assessment_turn(story_id) do
    %{
      "message" => %{
        "role" => "assistant",
        "content" => "",
        "toolCalls" => [
          %{
            "id" => "call-#{System.unique_integer([:positive])}",
            "name" => "assess_implementability",
            "arguments" => %{
              "storyId" => story_id,
              "parecer" => "implementavel",
              "justificativa" => "critérios claros"
            }
          }
        ]
      },
      "usage" => %{"estimated" => true},
      "error" => nil
    }
  end

  defp plano_de_teste_event(story_id) do
    %{
      "type" => "artifact.plano_de_teste",
      "payload" => %{
        "storyId" => story_id,
        "planoDeTeste" => "cobrir X",
        "criteriosExecutaveis" => ["dado X, quando Y, então Z"],
        "estrategiaDeAutomacao" => "integração"
      }
    }
  end

  test "o plano ENCERRA o turno: uma só proposed_action (status auto_approved do fake)", %{
    state: state
  } do
    # Achado da primeira execução real do Dev Lead. O modelo, deixado no laço,
    # propôs de novo: ficaram DUAS propostas na mesma sessão, com textos
    # diferentes e o mesmo total.
    #
    # `fake_llm_always` devolve SEMPRE a mesma chamada de ferramenta: se o
    # laço não parar sozinho, ele só para no teto de iterações, e o teste vê
    # várias propostas. O fake de `propose_action` default `status:
    # "auto_approved"` — o caminho de sucesso IMEDIATO, sem suspensão.
    Process.put(:fake_llm_always, plano_turn("um agente na api"))

    assert {:noreply, _} = sync_cast(DevLeadServer, :kickoff, state)

    assert length(propostas_de_plano()) == 1,
           "o laço voltou ao modelo depois do plano e ele propôs de novo"
  end

  test "o plano recusado NÃO encerra o turno — o modelo pode corrigir", %{
    state: state
  } do
    # A contrapartida do teste acima, e o que impede a correção de virar
    # "parou no primeiro erro": plano inválido devolve tool-result de erro
    # (validação ANTES de qualquer I/O — nem chega a propor a ação), o laço
    # continua, e o turno seguinte pode chegar num plano válido.
    invalido =
      put_in(
        plano_turn("vazio")["message"]["toolCalls"],
        [
          %{
            "id" => "call-ruim",
            "name" => "propose_execution_plan",
            "arguments" => %{"modulos" => [], "resumo" => "sem módulo"}
          }
        ]
      )

    Process.put(:fake_llm_turns, [
      invalido,
      plano_turn("agora vai"),
      FakeEngineApiClient.final_response("plano registrado")
    ])

    assert {:noreply, _} = sync_cast(DevLeadServer, :kickoff, state)

    # UMA proposta: o inválido não propôs nada, o válido propôs e parou.
    assert length(propostas_de_plano()) == 1
  end

  # Achado do problema 2 (RN-146): o `agent.response` carrega o nome do
  # modelo que gerou a resposta, extraído do frame `final` da api.
  test "agent.response carrega o nome do modelo", %{state: state} do
    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.final_response("Plano registrado.", "claude-haiku")
    ])

    assert {:reply, :ok, _} =
             sync_call(DevLeadServer, {:user_message, "e aí?"}, state)

    session_id = state.session_id

    assert_received {:event_appended, _, ^session_id,
                     %{
                       type: "agent.response",
                       payload: %{content: "Plano registrado.", modelName: "claude-haiku"}
                     }}
  end

  # A api narra budget/credencial/binding no PRÓPRIO frame final, e esse ramo
  # devolvia `{state, ""}` — uma TUPLA onde todos os outros ramos devolvem o
  # mapa do state. `TurnoAssincrono.tratar_resultado/2` faz `Map.put/3` no que a
  # task devolveu: numa tupla isso é `BadMapError` dentro do `handle_info`, e o
  # agente (`restart: :temporary`) morria sem voltar. Aqui o ciclo COMPLETO
  # roda — `sync_call/3` passa pelo `handle_info` —, então a falha derrubaria o
  # teste. A prova a nível de PROCESSO está em `po_server_test.exs`.
  test "erro narrado no frame final vira agent.error e o turno fecha inteiro", %{state: state} do
    Process.put(:fake_llm_turns, [%{"error" => "Nenhuma credencial cadastrada para openrouter"}])

    assert {:reply, :ok, final_state} =
             sync_call(DevLeadServer, {:user_message, "e aí?"}, state)

    session_id = state.session_id

    assert_received {:event_appended, _, ^session_id, %{type: "agent.error", payload: payload}}
    assert payload.origem == "politica"
    assert payload.mensagem =~ "credencial"

    # O ramo devolveu o formato certo, e não foi a segunda barreira do
    # `TurnoAssincrono` que salvou o agente — ela narraria com origem `codigo`.
    refute_received {:event_appended, _, _, %{type: "agent.error", payload: %{origem: "codigo"}}}

    assert final_state.turno_assincrono == nil
  end

  describe "suspensão em aprovação (ADR 0086, RN-284)" do
    # As três de sempre não bastam aqui: `sync_cast`/`sync_call` escondem a
    # volta pelo `handle_info`, mas o CENTRO desta feature é exatamente o que
    # acontece DEPOIS que o turno para — por isso os testes chamam
    # `handle_call`/`handle_info` direto, sem o helper, no meio do caminho.

    test "tool call que a api segura como pending vira suspensão, sem agent.done", %{
      state: state
    } do
      Process.put(:fake_propose_action, %{"id" => "pa-1", "status" => "pending"})
      Process.put(:fake_llm_turns, [plano_turn("um agente na api")])

      Phoenix.PubSub.subscribe(Engine.PubSub, "session:" <> state.session_id)

      assert {:noreply, final_state} = sync_cast(DevLeadServer, :kickoff, state)

      assert %{
               action_id: "pa-1",
               tool_call_id: _,
               tool_name: "propose_execution_plan",
               remaining: _
             } = final_state.aguardando_aprovacao

      assert length(propostas_de_plano()) == 1

      # NUNCA agent.done: o turno não terminou.
      refute_received %Phoenix.Socket.Broadcast{event: "agent.done"}
      refute_received %Phoenix.Socket.Broadcast{event: "agent.status", payload: %{status: "idle"}}

      assert_received %Phoenix.Socket.Broadcast{
        event: "agent.status",
        payload: %{status: "awaiting_approval"}
      }
    end

    test "segunda user_message durante a suspensão é recusada com agent.error, sem novo turno", %{
      state: state
    } do
      Process.put(:fake_propose_action, %{"id" => "pa-2", "status" => "pending"})
      Process.put(:fake_llm_turns, [plano_turn("um agente na api")])

      {:noreply, suspenso} = sync_cast(DevLeadServer, :kickoff, state)
      assert suspenso.aguardando_aprovacao != nil

      # Drena a chamada do turno INICIAL (o que produziu o plano) — o que se
      # quer provar é que a segunda `user_message` não gera uma chamada NOVA.
      assert_received {:llm_turn_stream, "dev-lead", _messages, _tools}

      from = {self(), make_ref()}

      assert {:reply, :ok, ainda_suspenso} =
               DevLeadServer.handle_call({:user_message, "e aí?"}, from, suspenso)

      # Nada mudou: nem a suspensão, nem subiu turno novo.
      assert ainda_suspenso.aguardando_aprovacao == suspenso.aguardando_aprovacao
      assert ainda_suspenso.turno_assincrono == nil
      assert ainda_suspenso.messages == suspenso.messages

      session_id = state.session_id

      assert_received {:event_appended, _, ^session_id, %{type: "agent.error", payload: payload}}
      assert payload.origem == "politica"
      assert payload.mensagem =~ "plano de execução"
      assert payload.mensagem =~ "Aprova"

      # Nenhuma chamada nova ao modelo aconteceu.
      refute_received {:llm_turn_stream, _agent, _messages, _tools}
    end

    test "action_settled retoma o laço com o resultado real (nunca a palavra pending)", %{
      state: state
    } do
      Process.put(:fake_propose_action, %{"id" => "pa-3", "status" => "pending"})
      Process.put(:fake_llm_turns, [plano_turn("um agente na api")])

      {:noreply, suspenso} = sync_cast(DevLeadServer, :kickoff, state)
      pendente = suspenso.aguardando_aprovacao
      assert pendente.action_id == "pa-3"

      # A retomada sobe uma TASK NOVA (`TurnoAssincrono.iniciar/3`), que copia
      # o dicionário de processo do chamador NO MOMENTO em que sobe — não do
      # que a primeira task consumiu (aquilo morreu com ela). Sem isto, a
      # segunda task repetiria a MESMA chamada de ferramenta com a lista já
      # "gasta" pelo ponto de vista de quem lê, porque a mutação de
      # `Process.put/2` dentro da primeira task nunca voltou para o processo
      # de teste.
      Process.put(:fake_llm_turns, [
        FakeEngineApiClient.final_response("plano aprovado, seguindo")
      ])

      desfecho = %{
        action_id: "pa-3",
        status: "auto_approved",
        execution_result: nil,
        rejection_reason: nil
      }

      assert {:noreply, retomando} =
               DevLeadServer.handle_info({:action_settled, desfecho}, suspenso)

      %{turno_assincrono: %{task: %Task{ref: ref}}} = retomando
      assert_receive {^ref, resultado}, 5_000

      assert {:noreply, final_state} = DevLeadServer.handle_info({ref, resultado}, retomando)

      assert final_state.aguardando_aprovacao == nil
      assert final_state.turno_assincrono == nil

      # A mensagem "tool" com o resultado REAL entrou no histórico — nunca a
      # palavra "pending", que mentiria pro modelo que o comando ainda está
      # em aberto.
      tool_msg = Enum.find(final_state.messages, &(&1["toolCallId"] == pendente.tool_call_id))
      refute is_nil(tool_msg)
      assert tool_msg["content"] =~ "aprovado"
      refute tool_msg["content"] =~ "pending"

      # O turno RETOMOU de verdade: uma segunda chamada ao modelo aconteceu
      # (a que produziu a resposta final, depois do resultado real).
      assert_received {:llm_turn_stream, "dev-lead", _messages, _tools}
    end

    test "action_settled de OUTRA ação (id que não bate) é ignorado, sem derrubar o processo", %{
      state: state
    } do
      Process.put(:fake_propose_action, %{"id" => "pa-4", "status" => "pending"})
      Process.put(:fake_llm_turns, [plano_turn("um agente na api")])

      {:noreply, suspenso} = sync_cast(DevLeadServer, :kickoff, state)

      desfecho_de_outra_acao = %{
        action_id: "pa-nao-e-esta",
        status: "auto_approved",
        execution_result: nil,
        rejection_reason: nil
      }

      assert {:noreply, ainda_suspenso} =
               DevLeadServer.handle_info({:action_settled, desfecho_de_outra_acao}, suspenso)

      assert ainda_suspenso == suspenso
    end

    test "cancel durante a suspensão é NO-OP (turno_assincrono já é nil nesse momento)", %{
      state: state
    } do
      Process.put(:fake_propose_action, %{"id" => "pa-5", "status" => "pending"})
      Process.put(:fake_llm_turns, [plano_turn("um agente na api")])

      {:noreply, suspenso} = sync_cast(DevLeadServer, :kickoff, state)

      assert {:noreply, depois_do_cancel} = DevLeadServer.handle_cast(:cancel, suspenso)
      assert depois_do_cancel == suspenso
    end

    # ADR 0090 — a MESMA suspensão genérica, agora pela SEGUNDA ferramenta do
    # Dev Lead. Não repete a dança inteira de retomada (já provada acima,
    # agnóstica de tool_name/tool_call_id): só prova que `assess_implementability`
    # também suspende quando a api segura a ação como pending.
    test "assess_implementability pending TAMBÉM suspende, sem agent.done", %{state: state} do
      Process.put(:fake_events, [plano_de_teste_event("st-1")])
      Process.put(:fake_propose_action, %{"id" => "pa-imp-1", "status" => "pending"})
      Process.put(:fake_llm_turns, [assessment_turn("st-1")])

      Phoenix.PubSub.subscribe(Engine.PubSub, "session:" <> state.session_id)

      assert {:reply, :ok, final_state} =
               sync_call(DevLeadServer, {:user_message, "avalie a st-1"}, state)

      assert %{
               action_id: "pa-imp-1",
               tool_name: "assess_implementability"
             } = final_state.aguardando_aprovacao

      assert_received {:propose_action, "assess_implementability", _actor, _payload}
      refute_received %Phoenix.Socket.Broadcast{event: "agent.done"}

      assert_received %Phoenix.Socket.Broadcast{
        event: "agent.status",
        payload: %{status: "awaiting_approval"}
      }
    end

    # RN-163: erro de ferramenta é ENTRADA do laço, não fim de linha — sem
    # plano de teste ainda, `assess_implementability` devolve `{:error, _}`
    # (não `{:pending, _}`), e o turno CONTINUA para o próximo turno
    # scriptado em vez de suspender.
    test "assess_implementability sem plano ainda NÃO suspende — o laço continua", %{
      state: state
    } do
      Process.put(:fake_events, [])
      Application.put_env(:engine, :gate_dispatcher, Engine.Gates.FakeGateDispatcher)
      on_exit(fn -> Application.delete_env(:engine, :gate_dispatcher) end)

      Process.put(:fake_llm_turns, [
        assessment_turn("st-sem-plano"),
        FakeEngineApiClient.final_response("ok, vou esperar o plano")
      ])

      assert {:noreply, final_state} = sync_cast(DevLeadServer, :kickoff, state)

      assert final_state.aguardando_aprovacao == nil
      refute_received {:propose_action, "assess_implementability", _actor, _payload}

      assert_received {:qa_estrategia_dispatch, _project_id, _session_id, "st-sem-plano"}
    end
  end
end
