defmodule Engine.Workers.AnamneseWorkerTest do
  # DataCase — o ContextBuilder lê a janela de eventos do Postgres e o
  # ToolLoop real roda síncrono no processo de teste.
  use Engine.DataCase, async: false

  alias Engine.Sessions.FakeEngineApiClient
  alias Engine.Workers.AnamneseWorker

  setup do
    Engine.GlobalSessionTestLock.acquire()

    root =
      Path.join(
        System.tmp_dir!(),
        "brabo-anam-#{System.os_time(:microsecond)}-#{System.unique_integer([:positive])}"
      )

    Application.put_env(:engine, :project_workspaces_root, root)
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    # Template do grafo AUSENTE por padrão nesta suíte — a maioria dos testes
    # aqui é sobre o CONTEÚDO da rodada (fila, decisões, catálogo), e quer o
    # caminho de FALLBACK inline (mesmo texto de sempre), não o de template.
    # Os testes do template do grafo (describe abaixo) sobrescrevem isto.
    Process.put(:fake_prompt_template, {:error, :not_found})

    on_exit(fn ->
      File.rm_rf!(root)
      Application.delete_env(:engine, :project_workspaces_root)
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :test_pid)
      Application.delete_env(:engine, :graph_templates_enabled?)
      Engine.GlobalSessionTestLock.release()
    end)

    %{project_id: Ecto.UUID.generate(), session_id: Ecto.UUID.generate()}
  end

  defp job(project_id, session_id) do
    %Oban.Job{args: %{"project_id" => project_id, "session_id" => session_id}}
  end

  defp context(overrides \\ %{}) do
    Map.merge(
      %{
        "competencyCatalog" => ["nestjs", "git"],
        "members" => [
          %{"userId" => "user-1", "name" => "Dani", "email" => "d@x.dev", "role" => "owner"}
        ],
        "queuedHypotheses" => [],
        "currentProfiles" => [],
        "instructions" => [],
        "windowFrom" => nil
      },
      overrides
    )
  end

  # `context()` sozinho não tem material pra passar `Triage.should_run?/3`
  # (evento/decisão/fila zerados < min_events, default 10) — a rodada seria
  # PULADA e `llm_turn` nunca chamado. Testes que só querem exercitar a
  # RENDERIZAÇÃO do prompt (template/RAG), sem se importar com a régua de
  # "vale a pena rodar", forçam via min_events baixo.
  defp forcar_rodada! do
    Application.put_env(:engine, :anamnese_min_events, 0)
    on_exit(fn -> Application.delete_env(:engine, :anamnese_min_events) end)
  end

  defp profile do
    %{
      "userId" => "user-1",
      "competency" => "nestjs",
      "level" => "avancado",
      "rationale" => "corrigiu o agente",
      "evidenceEventIds" => ["evt-1"]
    }
  end

  test "pula sem gastar nada quando não há material novo nem fila", %{
    project_id: project_id,
    session_id: session_id
  } do
    # Janela vazia (o banco de teste não tem eventos) e fila vazia.
    Process.put(:fake_anamnese_context, context())

    assert :ok = AnamneseWorker.perform(job(project_id, session_id))

    assert_received {:anamnese_context_fetched, ^project_id}
    refute_received {:llm_turn, _agent, _messages, _tools}
    refute_received {:proficiency_recorded, _}
  end

  test "hipótese aceita na fila FORÇA a rodada mesmo com janela vazia", %{
    project_id: project_id,
    session_id: session_id
  } do
    Process.put(
      :fake_anamnese_context,
      context(%{
        "queuedHypotheses" => [
          %{
            "queueId" => "queue-1",
            "hypothesisId" => "hyp-7",
            "agenteAlvo" => "dev-api",
            "hipotese" => "o dev explica demais o básico",
            "sugestao" => "encurtar as explicações",
            "confiancaPercent" => 80
          }
        ]
      })
    )

    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("emit_proficiency", %{
        "profiles" => [profile()]
      })
    ])

    assert :ok = AnamneseWorker.perform(job(project_id, session_id))

    assert_received {:llm_turn, "anamnese", _messages, _tools}
    assert_received {:proficiency_recorded, payload}

    # A fila NÃO é consumida por aqui: quem consome é a api, quando o patch
    # que referencia a hipótese nasce. Uma rodada que lê a hipótese e não
    # gera patch tem que deixá-la pendente pra próxima.
    refute Map.has_key?(payload, :consumedQueueIds)
  end

  test "a hipótese da fila entra no prompt como input priorizado", %{
    project_id: project_id,
    session_id: session_id
  } do
    Process.put(
      :fake_anamnese_context,
      context(%{
        "queuedHypotheses" => [
          %{
            "queueId" => "queue-1",
            "hypothesisId" => "hyp-7",
            "agenteAlvo" => "dev-api",
            "hipotese" => "explica demais",
            "sugestao" => "encurtar",
            "confiancaPercent" => 80
          }
        ]
      })
    )

    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("emit_proficiency", %{
        "profiles" => [profile()]
      })
    ])

    assert :ok = AnamneseWorker.perform(job(project_id, session_id))

    assert_received {:llm_turn, _agent, messages, _tools}
    content = messages |> Enum.map_join("\n", &Map.get(&1, "content", ""))
    assert content =~ "hyp-7"
    assert content =~ "input PRIORIZADO"
    assert content =~ "propose_instruction_patch"
  end

  test "o catálogo permitido e a proibição de atributo sensível vão no prompt", %{
    project_id: project_id,
    session_id: session_id
  } do
    Process.put(
      :fake_anamnese_context,
      context(%{
        "queuedHypotheses" => [
          %{
            "queueId" => "q",
            "hypothesisId" => "h",
            "agenteAlvo" => "a",
            "hipotese" => "x",
            "sugestao" => "y",
            "confiancaPercent" => 1
          }
        ]
      })
    )

    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("emit_proficiency", %{
        "profiles" => [profile()]
      })
    ])

    assert :ok = AnamneseWorker.perform(job(project_id, session_id))

    assert_received {:llm_turn, _agent, messages, _tools}
    content = messages |> Enum.map_join("\n", &Map.get(&1, "content", ""))
    assert content =~ "nestjs"
    assert content =~ "NUNCA infira saúde"
  end

  test "modelo nunca emite perfis: narra anamnese.run_failed, sem gravar rodada", %{
    project_id: project_id,
    session_id: session_id
  } do
    Process.put(
      :fake_anamnese_context,
      context(%{
        "queuedHypotheses" => [
          %{
            "queueId" => "q",
            "hypothesisId" => "h",
            "agenteAlvo" => "a",
            "hipotese" => "x",
            "sugestao" => "y",
            "confiancaPercent" => 1
          }
        ]
      })
    )

    # Fila vazia de turnos -> final_response sem tool call -> {:ok, ctx}.
    Process.put(:fake_llm_turns, [])

    assert :ok = AnamneseWorker.perform(job(project_id, session_id))

    refute_received {:proficiency_recorded, _}

    assert_received {:event_appended, ^project_id, ^session_id, %{type: "anamnese.run_failed"}}
  end

  # A saída honesta. Sem ela, a Anamnese que descobria "não há membro elegível"
  # na PRIMEIRA iteração insistia em `emit_proficiency` com lista vazia até o
  # teto — 145 mil tokens de entrada e 4x o gasto do Criativo e do PO numa
  # execução real, sem produzir nada, e de novo a cada tick do agendador.
  test "encerrar sem perfis é DESFECHO: narra run_skipped com o motivo, não falha", %{
    project_id: project_id,
    session_id: session_id
  } do
    Process.put(
      :fake_anamnese_context,
      context(%{
        "queuedHypotheses" => [
          %{
            "queueId" => "q",
            "hypothesisId" => "h",
            "agenteAlvo" => "a",
            "hipotese" => "x",
            "sugestao" => "y",
            "confiancaPercent" => 1
          }
        ]
      })
    )

    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("skip_proficiency", %{
        "motivo" => "nenhum membro elegível nesta janela"
      })
    ])

    assert :ok = AnamneseWorker.perform(job(project_id, session_id))

    refute_received {:proficiency_recorded, _}

    assert_received {:event_appended, ^project_id, ^session_id,
                     %{type: "anamnese.run_skipped", payload: %{motivo: motivo}}}

    assert motivo =~ "elegível"

    # E NÃO narra falha: uma rodada que fez a coisa certa não pode aparecer
    # como falha, senão quem lê o log aprende a ignorar o evento de falha.
    refute_received {:event_appended, ^project_id, ^session_id, %{type: "anamnese.run_failed"}}
  end

  test "sem sessão no projeto: não roda (não há onde narrar)", %{
    project_id: project_id
  } do
    Process.put(:fake_anamnese_context, context())

    assert :ok = AnamneseWorker.perform(job(project_id, nil))

    refute_received {:llm_turn, _agent, _messages, _tools}
  end

  test "contexto indisponível devolve {:error, _} pro Oban retentar", %{
    project_id: project_id,
    session_id: session_id
  } do
    # `:ok` marcaria o job `completed` e a rodada do projeto sumiria em
    # silêncio até o próximo tick, com o max_attempts como peso morto.
    Process.put(:fake_anamnese_context, {:error, :api_fora})

    assert {:error, :api_fora} = AnamneseWorker.perform(job(project_id, session_id))

    refute_received {:llm_turn, _agent, _messages, _tools}
  end

  test "falha de provider é narrada como falha de provider", %{
    project_id: project_id,
    session_id: session_id
  } do
    Process.put(
      :fake_anamnese_context,
      context(%{
        "queuedHypotheses" => [
          %{"queueId" => "queue-1", "hypothesisId" => "hyp-7", "agenteAlvo" => "dev-api"}
        ]
      })
    )

    Process.put(:fake_llm_turn_error, :timeout)

    assert :ok = AnamneseWorker.perform(job(project_id, session_id))

    assert_received {:event_appended, ^project_id, ^session_id,
                     %{type: "anamnese.run_failed", payload: %{reason: reason}}}

    assert reason =~ "provider"
  end

  test "decisões do usuário entram no prompt com o motivo da negação", %{
    project_id: project_id,
    session_id: session_id
  } do
    # "comandos que aprova/nega" é um dos quatro sinais do enunciado, e não
    # está no event log — vem de proposed_actions pelo contexto.
    Application.put_env(:engine, :anamnese_min_events, 1)
    on_exit(fn -> Application.delete_env(:engine, :anamnese_min_events) end)

    Process.put(
      :fake_anamnese_context,
      context(%{
        "decisions" => [
          %{
            "actionType" => "terminal",
            "status" => "denied",
            "rejectionReason" => "não roda migration em prod",
            "decidedBy" => "user-1",
            "decidedAt" => "2026-07-20T10:00:00Z"
          }
        ]
      })
    )

    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("emit_proficiency", %{
        "profiles" => [profile()]
      })
    ])

    assert :ok = AnamneseWorker.perform(job(project_id, session_id))

    assert_received {:llm_turn, "anamnese", messages, _tools}
    content = Enum.map_join(messages, "\n", &Map.get(&1, "content", ""))
    assert content =~ "DECISÕES DO USUÁRIO NA JANELA"
    assert content =~ "não roda migration em prod"
  end

  # A regra que decide QUANDO o produto pede para gastar mais. Ela precisa de
  # teste próprio: um limiar errado aqui vira ou ruído constante na fila de
  # aprovações, ou um sinal que nunca dispara.
  defp decisoes_parallelize(aprovadas, negadas) do
    aprovadas_lista =
      for i <- 1..aprovadas//1 do
        %{
          "actionType" => "parallelize",
          "status" => "approved",
          "rejectionReason" => nil,
          "decidedBy" => "user-1",
          "decidedAt" => "2026-07-2#{i}T10:00:00Z"
        }
      end

    negadas_lista =
      for _ <- 1..negadas//1 do
        %{
          "actionType" => "parallelize",
          "status" => "rejected",
          "rejectionReason" => "dois já bastam",
          "decidedBy" => "user-1",
          "decidedAt" => "2026-07-28T10:00:00Z"
        }
      end

    aprovadas_lista ++ negadas_lista
  end

  defp prompt_com_decisoes(project_id, session_id, decisions) do
    Application.put_env(:engine, :anamnese_min_events, 1)
    on_exit(fn -> Application.delete_env(:engine, :anamnese_min_events) end)

    Process.put(:fake_anamnese_context, context(%{"decisions" => decisions}))

    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("emit_proficiency", %{
        "profiles" => [profile()]
      })
    ])

    assert :ok = AnamneseWorker.perform(job(project_id, session_id))
    assert_received {:llm_turn, "anamnese", messages, _tools}
    Enum.map_join(messages, "\n", &Map.get(&1, "content", ""))
  end

  test "tres aprovacoes sem negacao: o prompt sugere propor subir o teto", %{
    project_id: project_id,
    session_id: session_id
  } do
    content = prompt_com_decisoes(project_id, session_id, decisoes_parallelize(3, 0))

    assert content =~ "AUTORIZAR MAIS AGENTES VIROU ROTINA"
    assert content =~ "propose_max_parallel"
  end

  test "duas aprovacoes NAO sao rotina — sao duas", %{
    project_id: project_id,
    session_id: session_id
  } do
    content = prompt_com_decisoes(project_id, session_id, decisoes_parallelize(2, 0))

    refute content =~ "AUTORIZAR MAIS AGENTES VIROU ROTINA"
  end

  test "uma NEGACAO derruba o sinal, por mais aprovacoes que haja", %{
    project_id: project_id,
    session_id: session_id
  } do
    # Se o usuario recusou alguma vez, o teto esta fazendo o trabalho dele.
    # Propor subi-lo seria ler o sinal ao contrario.
    content = prompt_com_decisoes(project_id, session_id, decisoes_parallelize(5, 1))

    refute content =~ "AUTORIZAR MAIS AGENTES VIROU ROTINA"
  end

  test "janela só de decisões roda (não é descartada como vazia)", %{
    project_id: project_id,
    session_id: session_id
  } do
    Application.put_env(:engine, :anamnese_min_events, 2)
    on_exit(fn -> Application.delete_env(:engine, :anamnese_min_events) end)

    decisao = fn i ->
      %{
        "actionType" => "terminal",
        "status" => "approved",
        "rejectionReason" => nil,
        "decidedBy" => "user-1",
        "decidedAt" => "2026-07-20T10:0#{i}:00Z"
      }
    end

    Process.put(
      :fake_anamnese_context,
      context(%{"decisions" => [decisao.(1), decisao.(2)]})
    )

    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("emit_proficiency", %{
        "profiles" => [profile()]
      })
    ])

    assert :ok = AnamneseWorker.perform(job(project_id, session_id))

    assert_received {:llm_turn, "anamnese", _messages, _tools}
  end

  # Grafo de conhecimento (ADR 0099/0100): `initial_message/1` resolve o
  # template `anamnese-kickoff` via `get_prompt_template`, com fallback
  # OBRIGATÓRIO pro texto inline em qualquer falha. Um template FAKE simples
  # (mesmos placeholders documentados em prompts/anamnese-kickoff.md) prova
  # que a substituição — incluindo o sub-template condicional de
  # `queued_instruction` — funciona sem depender do arquivo real.
  describe "template do grafo (anamnese-kickoff)" do
    # A flag `:graph_templates_enabled?` (COMPARTILHADA com o Psicólogo, ver
    # config/runtime.exs) nasce DESLIGADA — os testes deste describe são
    # justamente sobre o caminho de template, então ligam por padrão aqui; o
    # teste de "flag desligada" abaixo sobrescreve de volta.
    setup do
      Application.put_env(:engine, :graph_templates_enabled?, true)
      :ok
    end

    @template_fake """
    REGRAS FAKE DO TEMPLATE.
    {{queued_instruction}}

    CATALOGO:
    {{competency_catalog}}

    MEMBROS:
    {{members}}

    PERFIS:
    {{current_profiles}}

    {{instructions}}
    {{decisions}}
    {{relevant_snippets}}
    JANELA ({{window_from}} -> {{window_to}}){{omission_note}}:
    {{events}}
    """

    test "get_prompt_template com sucesso: a mensagem inicial usa o template do grafo, com os placeholders (incluindo o sub-template de queued_instruction) substituídos",
         %{project_id: project_id, session_id: session_id} do
      forcar_rodada!()

      Process.put(:fake_prompt_template, %{
        "name" => "anamnese-kickoff",
        "version" => "1",
        "body" => @template_fake,
        "hash" => "abc"
      })

      Process.put(
        :fake_anamnese_context,
        context(%{
          "queuedHypotheses" => [
            %{
              "queueId" => "queue-1",
              "hypothesisId" => "hyp-7",
              "agenteAlvo" => "dev-api",
              "hipotese" => "explica demais",
              "sugestao" => "encurtar",
              "confiancaPercent" => 80
            }
          ]
        })
      )

      Process.put(:fake_llm_turns, [
        FakeEngineApiClient.tool_call_response("emit_proficiency", %{
          "profiles" => [profile()]
        })
      ])

      assert :ok = AnamneseWorker.perform(job(project_id, session_id))

      assert_received {:prompt_template_fetched, "anamnese-kickoff", nil}
      assert_received {:llm_turn, "anamnese", messages, _tools}

      # `:pinned` não sobrevive até aqui — `Engine.Harness.ToolLoop.to_wire/1`
      # o remove antes de mandar pro `llm_turn` (é o que garante que ele nunca
      # vaza pro provider). `initial_message/1` seta `:pinned => true`
      # incondicionalmente, no MESMO ponto de retorno, nos dois caminhos
      # (template e inline) — não há branch que possa divergir isso.
      msg = Enum.find(messages, &(&1["role"] == "user"))

      content = msg["content"]

      # O molde FAKE apareceu (prova que o template do grafo foi usado, não
      # o fallback inline — que tem outro texto de abertura).
      assert content =~ "REGRAS FAKE DO TEMPLATE"
      refute content =~ "REGRAS INEGOCIÁVEIS:"

      # Placeholders simples substituídos.
      assert content =~ "nestjs"
      assert content =~ "Dani"

      # Sub-template condicional de queued_instruction: hipótese da fila
      # entra formatada, no MESMO texto do caminho inline.
      assert content =~ "hyp-7"
      assert content =~ "input PRIORIZADO"
      assert content =~ "propose_instruction_patch"

      # Nenhum placeholder sobrevive sem substituição.
      refute content =~ "{{"
    end

    test "get_prompt_template falhando ({:error, :not_found} — template ainda não semeado): cai no fallback inline, mensagem continua pinned",
         %{project_id: project_id, session_id: session_id} do
      forcar_rodada!()
      Process.put(:fake_prompt_template, {:error, :not_found})

      Process.put(:fake_anamnese_context, context())

      Process.put(:fake_llm_turns, [
        FakeEngineApiClient.tool_call_response("emit_proficiency", %{
          "profiles" => [profile()]
        })
      ])

      assert :ok = AnamneseWorker.perform(job(project_id, session_id))

      assert_received {:llm_turn, "anamnese", messages, _tools}
      # `:pinned` não sobrevive até aqui — `Engine.Harness.ToolLoop.to_wire/1`
      # o remove antes de mandar pro `llm_turn` (é o que garante que ele nunca
      # vaza pro provider). `initial_message/1` seta `:pinned => true`
      # incondicionalmente, no MESMO ponto de retorno, nos dois caminhos
      # (template e inline) — não há branch que possa divergir isso.
      msg = Enum.find(messages, &(&1["role"] == "user"))

      content = msg["content"]
      refute content =~ "REGRAS FAKE DO TEMPLATE"
      assert content =~ "REGRAS INEGOCIÁVEIS:"
      assert content =~ "nestjs"
    end

    test "get_prompt_template falhando por erro de rede/api: mesmo fallback inline, sem derrubar a rodada",
         %{project_id: project_id, session_id: session_id} do
      forcar_rodada!()
      Process.put(:fake_prompt_template, {:error, :timeout})

      Process.put(:fake_anamnese_context, context())

      Process.put(:fake_llm_turns, [
        FakeEngineApiClient.tool_call_response("emit_proficiency", %{
          "profiles" => [profile()]
        })
      ])

      assert :ok = AnamneseWorker.perform(job(project_id, session_id))

      assert_received {:llm_turn, "anamnese", messages, _tools}
      # `:pinned` não sobrevive até aqui — `Engine.Harness.ToolLoop.to_wire/1`
      # o remove antes de mandar pro `llm_turn` (é o que garante que ele nunca
      # vaza pro provider). `initial_message/1` seta `:pinned => true`
      # incondicionalmente, no MESMO ponto de retorno, nos dois caminhos
      # (template e inline) — não há branch que possa divergir isso.
      msg = Enum.find(messages, &(&1["role"] == "user"))
      assert msg["content"] =~ "REGRAS INEGOCIÁVEIS:"
    end

    test "flag graph_templates_enabled? desligada: nem tenta o grafo, vai direto pro inline",
         %{project_id: project_id, session_id: session_id} do
      forcar_rodada!()
      Application.put_env(:engine, :graph_templates_enabled?, false)

      # Se o worker chamasse get_prompt_template mesmo com a flag desligada,
      # isto quebraria a rodada — prova que ele nem tenta.
      Process.put(:fake_prompt_template, {:error, :boom})

      Process.put(:fake_anamnese_context, context())

      Process.put(:fake_llm_turns, [
        FakeEngineApiClient.tool_call_response("emit_proficiency", %{
          "profiles" => [profile()]
        })
      ])

      assert :ok = AnamneseWorker.perform(job(project_id, session_id))

      refute_received {:prompt_template_fetched, _, _}
      assert_received {:llm_turn, "anamnese", messages, _tools}
      msg = Enum.find(messages, &(&1["role"] == "user"))
      assert msg["content"] =~ "REGRAS INEGOCIÁVEIS:"
    end
  end

  # RAG (ADR 0099/0100, RN-414): a Anamnese consulta trechos relevantes do
  # projeto pelas competências ainda sem perfil, EM COMPOSIÇÃO com a janela
  # temporal — os hits chegam pelo `context` que o `ContextBuilder` já monta
  # (testado em profundidade em `context_builder_test.exs`); aqui importa só
  # que o WORKER os renderiza no prompt, nos dois caminhos (template e
  # inline), e que a degradação aparece de forma legível.
  describe "trechos relevantes do RAG no prompt" do
    test "hits do RAG aparecem no prompt (caminho inline)", %{
      project_id: project_id,
      session_id: session_id
    } do
      forcar_rodada!()
      Process.put(:fake_anamnese_context, context())

      Process.put(:fake_rag_search, %{
        "hits" => [%{"path" => "docs/adr/0080.md", "excerpt" => "trecho do ADR do RAG"}],
        "degraded" => false
      })

      Process.put(:fake_llm_turns, [
        FakeEngineApiClient.tool_call_response("emit_proficiency", %{
          "profiles" => [profile()]
        })
      ])

      assert :ok = AnamneseWorker.perform(job(project_id, session_id))

      assert_received {:llm_turn, "anamnese", messages, _tools}
      content = Enum.map_join(messages, "\n", &Map.get(&1, "content", ""))

      assert content =~ "TRECHOS RELEVANTES DO PROJETO"
      assert content =~ "docs/adr/0080.md"
      assert content =~ "trecho do ADR do RAG"
    end

    test "degraded: true do RAG aparece de forma legível no prompt", %{
      project_id: project_id,
      session_id: session_id
    } do
      forcar_rodada!()
      Process.put(:fake_anamnese_context, context())

      Process.put(:fake_rag_search, %{
        "hits" => [%{"path" => "a.md", "excerpt" => "x"}],
        "degraded" => true
      })

      Process.put(:fake_llm_turns, [
        FakeEngineApiClient.tool_call_response("emit_proficiency", %{
          "profiles" => [profile()]
        })
      ])

      assert :ok = AnamneseWorker.perform(job(project_id, session_id))

      assert_received {:llm_turn, "anamnese", messages, _tools}
      content = Enum.map_join(messages, "\n", &Map.get(&1, "content", ""))

      assert content =~ "AVISO"
      assert content =~ "DEGRADADA"
    end

    test "rag_search falhando: a rodada segue com o comportamento atual (sem trechos, sem erro)",
         %{project_id: project_id, session_id: session_id} do
      forcar_rodada!()
      Process.put(:fake_anamnese_context, context())
      Process.put(:fake_rag_search, {:error, :api_fora})

      Process.put(:fake_llm_turns, [
        FakeEngineApiClient.tool_call_response("emit_proficiency", %{
          "profiles" => [profile()]
        })
      ])

      assert :ok = AnamneseWorker.perform(job(project_id, session_id))

      refute_received {:event_appended, ^project_id, ^session_id, %{type: "anamnese.run_failed"}}
      assert_received {:llm_turn, "anamnese", _messages, _tools}
    end
  end
end
