defmodule Engine.Agents.PoServerTest do
  # DataCase — o PoServer monta o system prompt via o harness (lê o banco).
  # async: false por causa do Application env global. Os callbacks são
  # exercitados DIRETO no processo de teste (init/1 + handle_cast/2 +
  # handle_call/3), então o fake scriptado por dicionário de processo funciona.
  use Engine.DataCase, async: false

  alias Engine.Agents.PoServer
  alias Engine.Sessions.FakeEngineApiClient
  import Engine.Agents.TurnoAssincronoCase, only: [sync_call: 3, sync_cast: 3]

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

    assert {:noreply, new_state} = sync_cast(PoServer, :kickoff, state)

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

    assert {:noreply, new_state} = sync_cast(PoServer, :kickoff, state)

    tool_msgs = Enum.filter(new_state.messages, &(&1["role"] == "tool"))
    assert Enum.any?(tool_msgs, &String.contains?(&1["content"], "falha ao criar história"))
  end

  test "deltas são rebroadcastados no canal Phoenix", %{state: state, session_id: session_id} do
    Phoenix.PubSub.subscribe(Engine.PubSub, "session:" <> session_id)
    Process.put(:fake_deltas, ["Vou ", "montar o backlog"])
    Process.put(:fake_llm_turns, [FakeEngineApiClient.final_response("feito")])

    assert {:reply, :ok, _} =
             sync_call(PoServer, {:user_message, "gere o backlog"}, state)

    assert_received %Phoenix.Socket.Broadcast{event: "agent.delta", payload: %{text: "Vou "}}
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
    Process.put(:fake_events, brief_and_rules())

    Process.put(:fake_llm_turns, [
      tool_turn("create_epic", %{"title" => "Cadastro"}),
      FakeEngineApiClient.final_response("ok")
    ])

    assert {:noreply, _} = sync_cast(PoServer, :kickoff, state)

    assert_received %Phoenix.Socket.Broadcast{
      event: "tool.call",
      payload: %{tool: "create_epic", agent: "po"} = payload
    }

    refute Map.has_key?(payload, :args)
  end

  # Achado do problema 2 (RN-146): o `agent.response` carrega o nome do
  # modelo que gerou a resposta, extraído do frame `final` da api.
  test "agent.response carrega o nome do modelo", %{state: state, session_id: session_id} do
    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.final_response("Backlog pronto.", "llama3.2:3b")
    ])

    assert {:reply, :ok, _} =
             sync_call(PoServer, {:user_message, "gere o backlog"}, state)

    assert_received {:event_appended, _, ^session_id,
                     %{
                       type: "agent.response",
                       payload: %{content: "Backlog pronto.", modelName: "llama3.2:3b"}
                     }}
  end

  describe "revise/2 — devolução de história recusada (Fase 12c, RN-048)" do
    test "injeta a recusa como mensagem FIXADA e roda um turno", %{state: state} do
      Process.put(:fake_llm_turns, [FakeEngineApiClient.final_response("vou revisar")])

      assert {:reply, :ok, new_state} =
               sync_call(
                 PoServer,
                 {:revise,
                  %{
                    "id" => "story-1",
                    "title" => "Cadastro",
                    "reason" => "Falta o caso de recusa do pagamento"
                  }},
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

  describe "RN-164 — o PO lê o que já existe" do
    test "as ferramentas de leitura são advertidas ao modelo, ANTES das de escrita", %{
      state: state
    } do
      nomes = Enum.map(state.tool_specs, & &1.name)

      assert "listar_regras_de_negocio" in nomes
      assert "listar_backlog" in nomes
      # RN-407: a terceira leitura do PO — funil/DORA parcial do projeto.
      assert "listar_metricas_de_produto" in nomes
      # RN-165: perguntar é uma saída, e só existe se estiver na lista.
      assert "ask_structured_questions" in nomes

      indice = fn nome -> Enum.find_index(nomes, &(&1 == nome)) end
      assert indice.("listar_regras_de_negocio") < indice.("create_epic")
      assert indice.("listar_metricas_de_produto") < indice.("create_epic")
    end

    test "listar_regras_de_negocio roda e injeta o resultado como tool-result", %{state: state} do
      Process.put(:fake_business_rules, %{
        "rules" => [
          %{
            "id" => "evt-r1",
            "title" => "Só maiores de 18",
            "description" => "idade >= 18",
            "coveredByStoryIds" => [],
            "covered" => false
          }
        ],
        "uncoveredCount" => 1
      })

      Process.put(:fake_llm_turns, [
        tool_turn("listar_regras_de_negocio", %{}),
        FakeEngineApiClient.final_response("já sei o que falta")
      ])

      assert {:reply, :ok, new_state} =
               sync_call(PoServer, {:user_message, "o que falta?"}, state)

      assert_received {:business_rules_listed, _}

      tool_msgs = Enum.filter(new_state.messages, &(&1["role"] == "tool"))
      assert Enum.any?(tool_msgs, &String.contains?(&1["content"], "id=evt-r1"))
    end

    test "listar_backlog roda e injeta o resultado como tool-result", %{state: state} do
      Process.put(:fake_backlog, [%{"id" => "ep-1", "title" => "Cadastro", "stories" => []}])

      Process.put(:fake_llm_turns, [
        tool_turn("listar_backlog", %{}),
        FakeEngineApiClient.final_response("vi o backlog")
      ])

      assert {:reply, :ok, new_state} =
               sync_call(PoServer, {:user_message, "o que já existe?"}, state)

      assert_received {:backlog_listed, _}

      tool_msgs = Enum.filter(new_state.messages, &(&1["role"] == "tool"))
      assert Enum.any?(tool_msgs, &String.contains?(&1["content"], "ÉPICO id=ep-1"))
    end

    test "listar_metricas_de_produto roda e injeta o resultado como tool-result", %{
      state: state
    } do
      Process.put(:fake_product_metrics, %{
        "project" => %{"id" => "p1", "name" => "exp003"},
        "totalActionsConsidered" => 1,
        "funnel" => %{
          "etapas" => [
            %{"etapa" => "sessão produziu commit", "sessoes" => 1, "taxaDaEtapaAnterior" => nil}
          ],
          "sessoesComCommit" => ["s1"],
          "sessoesComPr" => [],
          "sessoesComMerge" => []
        },
        "leadTimes" => %{"perSession" => [], "averageMs" => nil},
        "deploymentFrequency" => []
      })

      Process.put(:fake_llm_turns, [
        tool_turn("listar_metricas_de_produto", %{}),
        FakeEngineApiClient.final_response("vi o funil")
      ])

      assert {:reply, :ok, new_state} =
               sync_call(PoServer, {:user_message, "o produto está entregando?"}, state)

      assert_received {:product_metrics_listed, _}

      tool_msgs = Enum.filter(new_state.messages, &(&1["role"] == "tool"))

      assert Enum.any?(
               tool_msgs,
               &String.contains?(&1["content"], "Funil de entrega e DORA parcial")
             )

      # As três ausências permanentes viajam SEMPRE no texto (RN-407) —
      # nunca só nos números, que sozinhos deixariam o modelo concluir por
      # omissão que não há lacuna.
      assert Enum.any?(tool_msgs, &String.contains?(&1["content"], "Não medido, de propósito"))
    end
  end

  describe "RN-165 — épico sem história não encerra calado" do
    test "épico criado sem nenhuma história vira evento durável com origem", %{
      state: state,
      session_id: session_id
    } do
      Process.put(:fake_events, brief_and_rules())

      Process.put(:fake_llm_turns, [
        tool_turn("create_epic", %{"title" => "Cadastro"}),
        FakeEngineApiClient.final_response("pronto!")
      ])

      assert {:noreply, new_state} = sync_cast(PoServer, :kickoff, state)

      assert_received {:event_appended, _, ^session_id,
                       %{
                         type: "backlog.epic_without_story",
                         payload: %{origem: "modelo", epicTitles: ["Cadastro"], mensagem: msg}
                       }}

      assert msg =~ "sem nenhuma história"
      # Reportada UMA vez: a cobrança é por ocorrência, não alarme que repete.
      assert new_state.epicos_sem_historia == %{}
    end

    test "épico COM história não gera cobrança nenhuma", %{state: state} do
      Process.put(:fake_events, brief_and_rules())
      Process.put(:fake_epic, %{"id" => "ep-42", "title" => "Cadastro"})

      Process.put(:fake_llm_turns, [
        tool_turn("create_epic", %{"title" => "Cadastro"}),
        tool_turn("create_story", %{
          "epic_id" => "ep-42",
          "title" => "Cadastrar usuário",
          "business_rule_ids" => ["evt-r1"]
        }),
        FakeEngineApiClient.final_response("backlog pronto")
      ])

      assert {:noreply, new_state} = sync_cast(PoServer, :kickoff, state)

      refute_received {:event_appended, _, _, %{type: "backlog.epic_without_story"}}
      assert new_state.epicos_sem_historia == %{}
    end

    test "história RECUSADA pela api não quita a obrigação do épico", %{state: state} do
      # O caminho que mais engana: o modelo "criou" a história, a api recusou
      # (regra inexistente), e sem esta distinção o épico sairia como coberto.
      Process.put(:fake_events, brief_and_rules())
      Process.put(:fake_epic, %{"id" => "ep-42", "title" => "Cadastro"})
      Process.put(:fake_story_error, {422, %{"message" => "business_rule_id inexistente"}})

      Process.put(:fake_llm_turns, [
        tool_turn("create_epic", %{"title" => "Cadastro"}),
        tool_turn("create_story", %{"epic_id" => "ep-42", "title" => "x"}),
        FakeEngineApiClient.final_response("desisti")
      ])

      assert {:noreply, _} = sync_cast(PoServer, :kickoff, state)

      assert_received {:event_appended, _, _, %{type: "backlog.epic_without_story"}}
    end

    test "a instrução de kickoff manda PERGUNTAR quando falta informação", %{state: state} do
      Process.put(:fake_events, brief_and_rules())
      Process.put(:fake_llm_turns, [FakeEngineApiClient.final_response("ok")])

      assert {:noreply, new_state} = sync_cast(PoServer, :kickoff, state)

      instrucao =
        Enum.find(new_state.messages, fn m ->
          m["role"] == "user" and String.contains?(m["content"], "PRODUCT BRIEF")
        end)

      assert instrucao["content"] =~ "ÉPICO SEM HISTÓRIA NÃO SERVE PARA NADA"
      assert instrucao["content"] =~ "PERGUNTE"
      assert instrucao["content"] =~ "ask_structured_questions"
    end
  end

  # RN-166: o teto de iterações era o único desfecho do PO que não deixava
  # rastro nenhum — do lado de fora, um laço esgotado era indistinguível de um
  # turno que simplesmente acabou.
  test "teto de iterações emite toolloop.limit_reached", %{state: state, session_id: session_id} do
    Process.put(
      :fake_llm_always,
      tool_turn("create_task", %{"story_id" => "st-1", "title" => "t"})
    )

    assert {:reply, :ok, _} = sync_call(PoServer, {:user_message, "vai"}, state)

    assert_received {:event_appended, _, ^session_id,
                     %{type: "toolloop.limit_reached", payload: %{max_iterations: 12}}}
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

  # A api narra budget/credencial/binding no PRÓPRIO frame final, e esse ramo
  # devolvia `{state, ""}` — uma TUPLA onde todos os outros ramos de `run_turn`
  # devolvem o mapa do state. `TurnoAssincrono.tratar_resultado/2` faz
  # `Map.put/3` no que a task devolveu, e `Map.put/3` numa tupla levanta
  # `BadMapError` DENTRO do `handle_info`: o agente morria e, sendo
  # `restart: :temporary`, não voltava. O gatilho é o mais corriqueiro de
  # todos — acabar o orçamento.
  #
  # Este teste NÃO usa `sync_call/3` de propósito: lá os callbacks rodam no
  # processo de TESTE, onde "o agente morreu" e "o teste falhou" viram a mesma
  # coisa e nada prova que o PROCESSO sobreviveu. Aqui o PoServer sobe de
  # verdade, sem link (para uma queda não levar o teste junto), e a pergunta
  # final é `Process.alive?/1`.
  #
  # `:sys.replace_state/2` roda a função DENTRO do processo do agente — é a
  # única forma de semear o dicionário DELE, de onde o `FakeEngineApiClient` lê
  # o script (o `TurnoAssincrono` copia o dicionário do agente para a task).
  test "erro narrado no frame final vira agent.error e NÃO derruba o agente" do
    project_id = Ecto.UUID.generate()
    session_id = Ecto.UUID.generate()

    {:ok, pid} = GenServer.start(PoServer, {session_id, project_id})

    :sys.replace_state(pid, fn estado ->
      Process.put(:fake_llm_turns, [%{"error" => "Orçamento da sessão esgotado"}])
      estado
    end)

    assert :ok = GenServer.call(pid, {:user_message, "e aí?"})

    assert Process.alive?(pid),
           "o agente tinha que sobreviver à falha narrada — era exatamente isto que o BadMapError derrubava"

    assert_receive {:event_appended, ^project_id, ^session_id,
                    %{type: "agent.error", payload: payload}},
                   5_000

    assert payload.origem == "politica"
    assert payload.mensagem =~ "Orçamento"

    # O ramo devolveu o formato certo, e não foi a segunda barreira do
    # `TurnoAssincrono` que salvou o agente. Sem esta linha o teste passaria
    # com a tupla de volta no lugar (a barreira narraria em vez de derrubar), e
    # a regressão do ramo em si ficaria invisível.
    refute_received {:event_appended, _, _, %{type: "agent.error", payload: %{origem: "codigo"}}}

    # O turno fechou de verdade: sem isto, um `turno_assincrono` pendurado
    # faria a próxima mensagem do usuário responder `:turno_em_andamento`.
    assert :sys.get_state(pid).turno_assincrono == nil

    GenServer.stop(pid)
  end
end
