defmodule Engine.Workers.PsychologistWorkerTest do
  # DataCase — o ContextBuilder lê o event log direto do Postgres e o
  # ToolLoop real roda síncrono no processo de teste (mesmo padrão de
  # Engine.Gates.QaAutomacaoAgentTest).
  use Engine.DataCase, async: false

  alias Engine.Sessions.FakeEngineApiClient
  alias Engine.Workers.PsychologistWorker

  setup do
    Engine.GlobalSessionTestLock.acquire()

    root =
      Path.join(
        System.tmp_dir!(),
        "brabo-psi-#{System.os_time(:microsecond)}-#{System.unique_integer([:positive])}"
      )

    Application.put_env(:engine, :project_workspaces_root, root)
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      File.rm_rf!(root)
      Application.delete_env(:engine, :project_workspaces_root)
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :test_pid)
      Engine.GlobalSessionTestLock.release()
    end)

    %{project_id: Ecto.UUID.generate(), session_id: Ecto.UUID.generate()}
  end

  defp job(session_id, project_id, extra_payload \\ %{}) do
    %Oban.Job{
      args: %{
        "aggregate_id" => session_id,
        "payload" => Map.merge(%{"projectId" => project_id}, extra_payload)
      }
    }
  end

  defp context(overrides \\ %{}) do
    Map.merge(
      %{
        "alreadyAnalyzed" => false,
        "sessionStatus" => "closed",
        "terminationReason" => nil,
        "businessRules" => [],
        "priorHypotheses" => []
      },
      overrides
    )
  end

  defp hypothesis do
    %{
      "agenteAlvo" => "dev-api",
      "observacao" => "obs",
      "hipotese" => "hip",
      "sugestao" => "sug",
      "confiancaPercent" => 70,
      "evidenceEventIds" => ["evt-1"]
    }
  end

  defp abnormal_hypothesis do
    Map.put(hypothesis(), "terminationAnalysis", %{
      "causa" => "kill",
      "estadoDaSessao" => "em andamento",
      "analise" => "processo morto externamente"
    })
  end

  # session_events é fixture do test_helper (tabela da api, sem FK) — dá pra
  # semear o log direto, que é como a triagem enxerga o tamanho da sessão.
  defp seed_events!(session_id, count, payload \\ %{"texto" => "curto"}) do
    for seq <- 1..count do
      Engine.Repo.insert_all("session_events", [
        %{
          id: "evt-#{seq}-#{System.unique_integer([:positive])}",
          session_id: Ecto.UUID.dump!(session_id),
          seq: seq,
          type: "agent.response",
          actor_kind: "agent",
          actor_id: "dev-api",
          payload: payload,
          created_at: DateTime.utc_now() |> DateTime.truncate(:second)
        }
      ])
    end
  end

  defp prompt_content do
    assert_received {:llm_turn, _agent, messages, _tools}
    Enum.map_join(messages, "\n", &Map.get(&1, "content", ""))
  end

  test "idempotência: sessão já analisada no caminho automático não chama o LLM", %{
    project_id: project_id,
    session_id: session_id
  } do
    Process.put(:fake_psychologist_context, context(%{"alreadyAnalyzed" => true}))

    assert :ok = PsychologistWorker.perform(job(session_id, project_id))

    assert_received {:psychologist_context_fetched, ^session_id}
    refute_received {:llm_turn, _agent, _messages, _tools}
    refute_received {:hypotheses_proposed, _, _, _, _, _}
  end

  test "reprocessamento explícito (manual) roda mesmo com análise já existente", %{
    project_id: project_id,
    session_id: session_id
  } do
    Process.put(:fake_psychologist_context, context(%{"alreadyAnalyzed" => true}))

    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("emit_hypotheses", %{
        "hypotheses" => [hypothesis()]
      })
    ])

    assert :ok =
             PsychologistWorker.perform(job(session_id, project_id, %{"triggeredBy" => "manual"}))

    assert_received {:hypotheses_proposed, _tier, "manual", _count, _cause, [_h]}
  end

  test "sessão trivial (sem eventos) usa triagem LEVE — agent psicologo-leve", %{
    project_id: project_id,
    session_id: session_id
  } do
    Process.put(:fake_psychologist_context, context())

    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("emit_hypotheses", %{
        "hypotheses" => [hypothesis()]
      })
    ])

    assert :ok = PsychologistWorker.perform(job(session_id, project_id))

    assert_received {:llm_turn, "psicologo-leve", _messages, _tools}
    assert_received {:hypotheses_proposed, "leve", "auto", 0, "normal", [_h]}
  end

  test "sessão no limiar usa triagem PESADA — agent psicologo e tetos maiores", %{
    project_id: project_id,
    session_id: session_id
  } do
    # A contagem vem de um COUNT no event log real, não do tamanho da lista
    # que entra no prompt — por isso o teste semeia o banco.
    seed_events!(session_id, Engine.Psychologist.Triage.threshold())

    Process.put(:fake_psychologist_context, context())

    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("emit_hypotheses", %{
        "hypotheses" => [hypothesis()]
      })
    ])

    assert :ok = PsychologistWorker.perform(job(session_id, project_id))

    assert_received {:llm_turn, "psicologo", _messages, _tools}
    limiar = Engine.Psychologist.Triage.threshold()
    assert_received {:hypotheses_proposed, "pesada", "auto", ^limiar, "normal", [_h]}
  end

  test "término anormal: causa classificada entra no prompt e pede terminationAnalysis", %{
    project_id: project_id,
    session_id: session_id
  } do
    Process.put(
      :fake_psychologist_context,
      context(%{
        "sessionStatus" => "closed_abnormally",
        "terminationReason" => "killed"
      })
    )

    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("emit_hypotheses", %{
        "hypotheses" => [abnormal_hypothesis()]
      })
    ])

    assert :ok = PsychologistWorker.perform(job(session_id, project_id))

    content = prompt_content()
    assert content =~ "morto externamente"
    assert content =~ "terminationAnalysis"

    # A causa vai pra api junto do lote: é ela, e não o status, que decide
    # se terminationAnalysis é obrigatória.
    assert_received {:hypotheses_proposed, _tier, "auto", _count, "kill", [_h]}
  end

  test "timeout de heartbeat fecha como closed mas ainda exige seção de término", %{
    project_id: project_id,
    session_id: session_id
  } do
    # Monitor.classify/1 manda heartbeat_timeout fechar como "closed" — antes
    # isso fazia a causa virar :normal e a seção nunca ser pedida.
    Process.put(
      :fake_psychologist_context,
      context(%{
        "sessionStatus" => "closed",
        "terminationReason" => "heartbeat_timeout"
      })
    )

    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("emit_hypotheses", %{
        "hypotheses" => [abnormal_hypothesis()]
      })
    ])

    assert :ok = PsychologistWorker.perform(job(session_id, project_id))

    content = prompt_content()
    assert content =~ "timeout de heartbeat"
    assert content =~ "terminationAnalysis"

    assert_received {:hypotheses_proposed, _tier, "auto", _count, "timeout", [_h]}
  end

  test "kill do engine -> análise pós-restart: run sem análise prévia conclui normalmente", %{
    project_id: project_id,
    session_id: session_id
  } do
    # Cenário: o engine morreu antes de concluir a análise, então NÃO há
    # linha em psychologist_analyses (alreadyAnalyzed: false). A nova
    # tentativa (retry do Oban após o Lifeline resgatar o job órfão, ou
    # reentrega do outbox) roda a análise inteira e conclui — é isso que o
    # desenho "run falho não grava linha" permite.
    Process.put(
      :fake_psychologist_context,
      context(%{
        "alreadyAnalyzed" => false,
        "sessionStatus" => "closed_abnormally",
        "terminationReason" => "killed"
      })
    )

    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("emit_hypotheses", %{
        "hypotheses" => [abnormal_hypothesis()]
      })
    ])

    assert :ok = PsychologistWorker.perform(job(session_id, project_id))

    assert_received {:hypotheses_proposed, _tier, "auto", _count, _cause, [_h]}
  end

  test "contexto indisponível devolve {:error, _} pro Oban retentar", %{
    project_id: project_id,
    session_id: session_id
  } do
    # `:ok` aqui marcaria o job `completed` e perderia a análise em silêncio.
    Process.put(:fake_psychologist_context, {:error, :api_fora})

    assert {:error, :api_fora} = PsychologistWorker.perform(job(session_id, project_id))

    refute_received {:llm_turn, _agent, _messages, _tools}
    refute_received {:event_appended, _, _, %{type: "psychologist.analysis_failed"}}
  end

  test "modelo corrige evidência rejeitada no turno seguinte e a análise conclui", %{
    project_id: project_id,
    session_id: session_id
  } do
    Process.put(:fake_psychologist_context, context())

    # Primeira chamada é rejeitada pela api; o ToolLoop injeta a mensagem
    # como tool-result e o modelo tenta de novo — é ISSO que materializa o
    # "até M tentativas" do enunciado.
    Process.put(:fake_propose_hypotheses_error_once, {400, %{"message" => "evidência inválida"}})

    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("emit_hypotheses", %{
        "hypotheses" => [Map.put(hypothesis(), "evidenceEventIds", ["evt-x"])]
      }),
      FakeEngineApiClient.tool_call_response("emit_hypotheses", %{
        "hypotheses" => [hypothesis()]
      })
    ])

    assert :ok = PsychologistWorker.perform(job(session_id, project_id))

    # Duas tentativas: a rejeitada e a corrigida.
    assert_received {:hypotheses_proposed, _, _, _, _, [%{"evidenceEventIds" => ["evt-x"]}]}
    assert_received {:hypotheses_proposed, _, _, _, _, [%{"evidenceEventIds" => ["evt-1"]}]}

    # Concluiu por halt do hook -> nenhum desfecho de fracasso narrado.
    refute_received {:event_appended, _, _, %{type: "psychologist.analysis_failed"}}
  end

  test "modelo nunca emite hipóteses: narra analysis_failed, sem análise gravada", %{
    project_id: project_id,
    session_id: session_id
  } do
    Process.put(:fake_psychologist_context, context())
    # Fila vazia -> FakeEngineApiClient devolve final_response (sem tool
    # call) -> loop encerra em {:ok, ctx}, sem halt do hook.
    Process.put(:fake_llm_turns, [])

    assert :ok = PsychologistWorker.perform(job(session_id, project_id))

    refute_received {:hypotheses_proposed, _, _, _, _, _}

    assert_received {:event_appended, ^project_id, ^session_id,
                     %{type: "psychologist.analysis_failed"}}
  end

  test "falha de provider é narrada como falha de provider, não como desistência do modelo", %{
    project_id: project_id,
    session_id: session_id
  } do
    Process.put(:fake_psychologist_context, context())
    Process.put(:fake_llm_turn_error, :timeout)

    assert :ok = PsychologistWorker.perform(job(session_id, project_id))

    assert_received {:event_appended, ^project_id, ^session_id,
                     %{type: "psychologist.analysis_failed", payload: %{reason: reason}}}

    assert reason =~ "provider"
  end

  test "evidência rejeitada pela api: loop não termina por halt, desfecho vira analysis_failed",
       %{project_id: project_id, session_id: session_id} do
    Process.put(:fake_psychologist_context, context())

    Process.put(
      :fake_propose_hypotheses_error,
      {400, %{"message" => "evidência \"evt-x\" não corresponde a um evento real desta sessão"}}
    )

    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("emit_hypotheses", %{
        "hypotheses" => [Map.put(hypothesis(), "evidenceEventIds", ["evt-x"])]
      })
    ])

    assert :ok = PsychologistWorker.perform(job(session_id, project_id))

    # A tool foi chamada (e rejeitada) -> o hook NÃO terminou o loop ->
    # a fila de turnos esgota -> desfecho não-halt -> analysis_failed.
    assert_received {:hypotheses_proposed, _, _, _, _, _}

    assert_received {:event_appended, ^project_id, ^session_id,
                     %{type: "psychologist.analysis_failed"}}
  end

  describe "corte do log no prompt" do
    setup do
      Application.put_env(:engine, :psychologist_triage_threshold, 3)
      Application.put_env(:engine, :psychologist_max_prompt_events_pesada, 2)
      Application.put_env(:engine, :psychologist_max_payload_chars, 20)

      on_exit(fn ->
        Application.delete_env(:engine, :psychologist_triage_threshold)
        Application.delete_env(:engine, :psychologist_max_prompt_events_pesada)
        Application.delete_env(:engine, :psychologist_max_payload_chars)
      end)

      :ok
    end

    test "só a cauda do log entra, com nota de omissão e payload truncado", %{
      project_id: project_id,
      session_id: session_id
    } do
      seed_events!(session_id, 5, %{"texto" => String.duplicate("x", 200)})

      Process.put(:fake_psychologist_context, context())

      Process.put(:fake_llm_turns, [
        FakeEngineApiClient.tool_call_response("emit_hypotheses", %{
          "hypotheses" => [hypothesis()]
        })
      ])

      assert :ok = PsychologistWorker.perform(job(session_id, project_id))

      content = prompt_content()

      # A contagem reportada é a REAL (5), não a do recorte (2).
      assert_received {:hypotheses_proposed, "pesada", "auto", 5, _cause, [_h]}

      # O corte é visível pro modelo: ele só pode citar ids que vê.
      assert content =~ "3 evento(s) mais antigo(s) omitido(s)"
      assert content =~ "seq=5"
      assert content =~ "seq=4"
      refute content =~ "seq=1 "
      assert content =~ "payload truncado"
      refute content =~ String.duplicate("x", 200)
    end
  end
end
