defmodule Engine.Agents.CriativoServerTest do
  # DataCase — o CriativoServer monta o system prompt via o harness, que LÊ o
  # banco. async: false por causa do Application env global. Os callbacks são
  # exercitados DIRETO no processo de teste (init/1 + handle_call/3), então o
  # fake scriptado por dicionário de processo funciona (mesmo padrão do
  # tool_loop_test) — desde RN-122 o turno de verdade roda numa Task, e
  # `sync_call/3` (Engine.Agents.TurnoAssincronoCase) leva o dicionário
  # scriptado pra dentro dela e devolve a MESMA forma de tupla de antes.
  use Engine.DataCase, async: false

  alias Engine.Agents.CriativoServer
  alias Engine.Sessions.FakeEngineApiClient
  import Engine.Agents.TurnoAssincronoCase, only: [sync_call: 3]

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
             sync_call(CriativoServer, {:user_message, "quero um app de cadastro"}, state)

    assert_received {:event_appended, _, _, %{type: "agent.response"}}
    assert_received {:event_appended, _, _, %{type: "artifact.business_rule"}}
    # A mensagem do usuário + a resposta entraram no histórico em memória.
    assert Enum.any?(new_state.messages, &(&1["role"] == "user"))
    assert Enum.any?(new_state.messages, &(&1["role"] == "assistant"))
  end

  # Achado do problema 2 (RN-146): o `agent.response` carrega o nome do
  # modelo que gerou a resposta, extraído do frame `final` da api.
  test "agent.response carrega o nome do modelo", %{state: state, session_id: session_id} do
    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.final_response("Oi! Me conta sobre o produto.", "llama3.2:3b")
    ])

    assert {:reply, :ok, _} =
             sync_call(CriativoServer, {:user_message, "oi"}, state)

    assert_received {:event_appended, _, ^session_id,
                     %{
                       type: "agent.response",
                       payload: %{
                         content: "Oi! Me conta sobre o produto.",
                         modelName: "llama3.2:3b"
                       }
                     }}
  end

  # Borda: a api pode não mandar `modelName` (versão antiga durante rollout, ou
  # frame `final` sem o campo) — o engine não deve quebrar, só gravar `nil`. É
  # o mesmo caminho que produz o payload de um evento GRAVADO antes desta
  # mudança, que `SessionPage.tsx` sabe degradar para o rótulo genérico.
  test "sem modelName no frame final: grava modelName nil, sem quebrar", %{
    state: state,
    session_id: session_id
  } do
    Process.put(:fake_llm_turns, [FakeEngineApiClient.final_response("oi")])

    assert {:reply, :ok, _} =
             sync_call(CriativoServer, {:user_message, "oi"}, state)

    assert_received {:event_appended, _, ^session_id,
                     %{type: "agent.response", payload: %{content: "oi", modelName: nil}}}
  end

  test "guardrail: turno normal NÃO emite product_brief nem por tool call", %{state: state} do
    Process.put(:fake_llm_turns, [product_brief_tool_turn()])

    assert {:reply, :ok, _} =
             sync_call(CriativoServer, {:user_message, "tenta emitir o brief"}, state)

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

    assert {:reply, :ok, _} = sync_call(CriativoServer, :confirm_readiness, state)

    assert_received {:event_appended, _, _, %{type: "artifact.product_brief", payload: payload}}
    assert payload["summary"] == "Resumo executivo do produto"
    assert payload["rules"] == ["evt-a", "evt-b"]

    assert_received {:handoff_created, _, ^session_id, "criativo", "po", _artifact_id}
  end

  # RN-116: `{:ok, _handoff} = ...` era um match rígido — a api recusando o
  # handoff (aqui: 500 simulado) derrubava o GenServer inteiro com
  # `MatchError`, DEPOIS do turno já ter rodado e do product_brief já ter sido
  # gravado. Nem `agent.error`, nem resposta no fio: o processo só sumia, e
  # "nada iniciou" do lado do PO porque o handoff nunca chegou a existir.
  test "prontidão: falha ao criar o handoff NÃO derruba o processo, e vira agent.error durável",
       %{state: state, session_id: session_id} do
    Phoenix.PubSub.subscribe(Engine.PubSub, "session:" <> session_id)
    Process.put(:fake_handoff_error, {500, %{"message" => "erro interno"}})
    # O guardrail de zero regra de negócio roda ANTES: sem isto a recusa dele
    # dispara primeiro, e o teste nunca alcançaria o cenário de falha do
    # handoff que é o assunto aqui.
    Process.put(:fake_events, [
      %{"id" => "evt-a", "type" => "artifact.business_rule", "payload" => %{}}
    ])

    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.final_response("Resumo executivo do produto")
    ])

    # O ponto central: isto NÃO derruba o processo — antes, isto crashava com
    # MatchError, e nem chegava a devolver `{:reply, :ok, _}`.
    assert {:reply, :ok, _} = sync_call(CriativoServer, :confirm_readiness, state)

    # O product_brief já tinha sido gravado ANTES da falha — é a "informação
    # que passou mesmo assim" do relato original deste bug.
    assert_received {:event_appended, _, _, %{type: "artifact.product_brief"}}

    assert_received {:event_appended, _, ^session_id, %{type: "agent.error", payload: payload}}
    assert payload.origem == "infra"
    assert payload.mensagem =~ "não consegui oferecer o handoff ao po"
    refute payload.mensagem =~ "Nada foi gasto"

    assert_received %Phoenix.Socket.Broadcast{event: "agent.error"}
  end

  # Confirmar prontidão sem NENHUMA regra de negócio capturada é recusado
  # ANTES de subir a Task: nem o turno de consolidação roda, nem o
  # product_brief, nem o handoff nascem. O controller ignora o retorno deste
  # `GenServer.call` e sempre responde 202 (RN-122) — a única forma do
  # usuário saber é o `agent.error` durável no fio.
  test "prontidão: recusa quando NENHUMA regra de negócio foi capturada", %{
    state: state,
    session_id: session_id
  } do
    Phoenix.PubSub.subscribe(Engine.PubSub, "session:" <> session_id)
    # Sem `Process.put(:fake_events, ...)` — a fila default é [], simulando
    # uma conversa em que o usuário clicou "Estou pronto para produzir" sem
    # ter capturado regra nenhuma.

    assert {:reply, {:error, :sem_regra_de_negocio}, ^state} =
             sync_call(CriativoServer, :confirm_readiness, state)

    # Nem o turno de consolidação rodou (nenhuma chamada ao LLM), nem o
    # brief, nem o handoff.
    refute_received {:llm_turn_stream, _, _, _}
    refute_received {:event_appended, _, ^session_id, %{type: "artifact.product_brief"}}
    refute_received {:handoff_created, _, ^session_id, "criativo", "po", _artifact_id}

    # A recusa É narrada — durável no event log e no canal, com origem
    # "politica" (é decisão de produto, não falha de infra/modelo/código).
    assert_received {:event_appended, _, ^session_id, %{type: "agent.error", payload: payload}}
    assert payload.origem == "politica"
    assert payload.mensagem =~ "regra de negócio"

    assert_received %Phoenix.Socket.Broadcast{
      event: "agent.error",
      payload: %{origem: "politica"}
    }
  end

  test "deltas são rebroadcastados no canal Phoenix da sessão", %{
    state: state,
    session_id: session_id
  } do
    Phoenix.PubSub.subscribe(Engine.PubSub, "session:" <> session_id)
    Process.put(:fake_deltas, ["Oi", " tudo bem?"])
    Process.put(:fake_llm_turns, [FakeEngineApiClient.final_response("Oi tudo bem?")])

    assert {:reply, :ok, _} =
             sync_call(CriativoServer, {:user_message, "oi"}, state)

    # O `agent` viaja em TODO delta (achado C). Sem ele a tela não tem como
    # saber quem está falando, e rotulava a bolha ao vivo com o nome do MODELO —
    # que trocava para o nome do agente quando o evento persistido chegava,
    # mudando o interlocutor na cara de quem estava lendo.
    assert_received %Phoenix.Socket.Broadcast{
      event: "agent.delta",
      payload: %{text: "Oi", agent: "criativo"}
    }

    assert_received %Phoenix.Socket.Broadcast{
      event: "agent.delta",
      payload: %{text: " tudo bem?", agent: "criativo"}
    }

    assert_received %Phoenix.Socket.Broadcast{event: "agent.done"}
  end

  # A falha de um turno era o pior desfecho possível: `agent.response` VAZIO no
  # event log (indistinguível de sucesso) e o motivo só por broadcast, que é
  # efêmero. Quem não estivesse com a aba aberta nunca saberia.
  test "falha de turno vira agent.error DURÁVEL, com origem e mensagem", %{
    state: state,
    session_id: session_id
  } do
    Phoenix.PubSub.subscribe(Engine.PubSub, "session:" <> session_id)
    Process.put(:fake_llm_turns, [{:error, :no_final_event}])

    assert {:reply, :ok, _} =
             sync_call(CriativoServer, {:user_message, "oi"}, state)

    assert_received {:event_appended, _, ^session_id, %{type: "agent.error", payload: payload}}

    assert payload.origem == "infra"
    assert payload.mensagem =~ "Não consegui completar este turno"
    assert payload.mensagem =~ "Nada foi gasto"

    # E o agente FALA no canal também, para quem está na conversa agora.
    assert_received %Phoenix.Socket.Broadcast{event: "agent.error"}
  end

  test "falha NUNCA grava agent.response vazio", %{state: state, session_id: session_id} do
    Process.put(:fake_llm_turns, [{:error, :no_final_event}])

    assert {:reply, :ok, _} =
             sync_call(CriativoServer, {:user_message, "oi"}, state)

    refute_received {:event_appended, _, ^session_id,
                     %{type: "agent.response", payload: %{content: ""}}}
  end

  # A api narra budget/credencial/binding no PRÓPRIO frame final. Isso não caía
  # no ramo de erro e não emitia evento nenhum — o turno acabava em silêncio
  # absoluto, pior que o balão vazio.
  test "erro narrado no frame final também vira evento, com origem política", %{
    state: state,
    session_id: session_id
  } do
    Process.put(:fake_llm_turns, [%{"error" => "Nenhuma credencial cadastrada para openrouter"}])

    assert {:reply, :ok, _} =
             sync_call(CriativoServer, {:user_message, "oi"}, state)

    assert_received {:event_appended, _, ^session_id, %{type: "agent.error", payload: payload}}

    assert payload.origem == "politica"
    assert payload.mensagem =~ "credencial"
  end

  # O payload recusado pelo schema sumia: o resultado da ferramenta era
  # DESCARTADO (`_ =`), o Criativo dizia "registrei as regras", e quatro regras
  # de negócio iam para o lixo com o painel vazio.
  test "ferramenta recusada vira tool.result com erro, e o agente fala", %{
    state: state,
    session_id: session_id
  } do
    # Payload no idioma da conversa, contra um schema em inglês — o caso real.
    Process.put(:fake_llm_turns, [
      %{
        "message" => %{
          "role" => "assistant",
          "content" => "Vou registrar as regras.",
          "toolCalls" => [
            %{
              "id" => "tc1",
              "name" => "emit_artifact",
              "arguments" => %{
                "type" => "business_rule",
                "payload" => %{"titulo" => "Saudação", "descricao" => "…"}
              }
            }
          ]
        }
      }
    ])

    assert {:reply, :ok, _} =
             sync_call(CriativoServer, {:user_message, "oi"}, state)

    assert_received {:event_appended, _, ^session_id,
                     %{type: "tool.result", payload: %{ok: false, erro: erro}}}

    assert erro =~ "title" or erro =~ "obrigat"

    # E o agente DIZ o que houve, em vez de seguir como se tivesse registrado.
    # O casamento é por PREFIXO: a primeira `agent.response` do turno é a fala
    # normal do modelo ("Vou registrar as regras"), e `assert_received` pega a
    # primeira que casar — sem o prefixo, o teste passaria olhando a mensagem
    # errada.
    assert_received {:event_appended, _, ^session_id,
                     %{
                       type: "agent.response",
                       payload: %{content: "Não consegui registrar" <> _}
                     }}
  end

  # RN-162: o Criativo pode emitir várias perguntas de uma vez, num formato
  # estruturado, em vez de deixar o usuário responder item por item em texto
  # livre.
  defp structured_question_turn do
    %{
      "message" => %{
        "role" => "assistant",
        "content" => "Preciso entender melhor o produto.",
        "toolCalls" => [
          %{
            "id" => "tc3",
            "name" => "ask_structured_questions",
            "arguments" => %{
              "questions" => [
                %{"id" => "nome", "label" => "Qual o nome do produto?"},
                %{
                  "id" => "plataforma",
                  "label" => "Qual plataforma?",
                  "type" => "select",
                  "options" => ["Web", "Mobile"]
                }
              ]
            }
          }
        ]
      },
      "usage" => %{"estimated" => true},
      "error" => nil
    }
  end

  test "ask_structured_questions: emite chat.structured_question com as perguntas", %{
    state: state
  } do
    Process.put(:fake_llm_turns, [structured_question_turn()])

    assert {:reply, :ok, new_state} =
             sync_call(CriativoServer, {:user_message, "quero um app"}, state)

    assert_received {:event_appended, _, _, %{type: "agent.response"}}

    assert_received {:event_appended, _, _, %{type: "chat.structured_question", payload: payload}}

    assert payload.questions == [
             %{id: "nome", label: "Qual o nome do produto?", type: "text", options: []},
             %{
               id: "plataforma",
               label: "Qual plataforma?",
               type: "select",
               options: ["Web", "Mobile"]
             }
           ]

    # O tool call e o resultado entram no histórico como o resto do turno.
    assert Enum.any?(
             new_state.messages,
             &(&1["role"] == "tool" and &1["name"] == "ask_structured_questions")
           )
  end

  test "ask_structured_questions recusado (sem label) vira tool.result de erro, e o agente fala",
       %{state: state} do
    Process.put(:fake_llm_turns, [
      %{
        "message" => %{
          "role" => "assistant",
          "content" => "",
          "toolCalls" => [
            %{
              "id" => "tc4",
              "name" => "ask_structured_questions",
              "arguments" => %{"questions" => [%{"id" => "a"}]}
            }
          ]
        }
      }
    ])

    assert {:reply, :ok, _} =
             sync_call(CriativoServer, {:user_message, "oi"}, state)

    assert_received {:event_appended, _, _,
                     %{type: "tool.result", payload: %{ok: false, erro: erro}}}

    assert erro =~ "label"

    assert_received {:event_appended, _, _,
                     %{
                       type: "agent.response",
                       payload: %{content: "Não consegui montar essas perguntas" <> _}
                     }}
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
