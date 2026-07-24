defmodule Engine.Workers.PsychologistWorkerTest do
  # DataCase — o ContextBuilder lê o event log direto do Postgres e o
  # ToolLoop real roda síncrono no processo de teste (mesmo padrão de
  # Engine.Gates.QaAgentServerTest).
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

  test "idempotência: sessão já analisada no caminho automático não chama o LLM", %{
    project_id: project_id,
    session_id: session_id
  } do
    Process.put(:fake_psychologist_context, context(%{"alreadyAnalyzed" => true}))

    assert :ok = PsychologistWorker.perform(job(session_id, project_id))

    assert_received {:psychologist_context_fetched, ^session_id}
    refute_received {:llm_turn, _agent, _messages, _tools}
    refute_received {:hypotheses_proposed, _, _, _, _}
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

    assert_received {:hypotheses_proposed, _tier, "manual", _count, [_h]}
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
    assert_received {:hypotheses_proposed, "leve", "auto", 0, [_h]}
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
        "hypotheses" => [
          Map.put(hypothesis(), "terminationAnalysis", %{
            "causa" => "kill",
            "estadoDaSessao" => "em andamento",
            "analise" => "processo morto externamente"
          })
        ]
      })
    ])

    assert :ok = PsychologistWorker.perform(job(session_id, project_id))

    assert_received {:llm_turn, _agent, messages, _tools}
    content = messages |> Enum.map_join("\n", &Map.get(&1, "content", ""))
    assert content =~ "morto externamente"
    assert content =~ "terminationAnalysis"
  end

  test "kill do engine -> análise pós-restart: run sem análise prévia conclui normalmente", %{
    project_id: project_id,
    session_id: session_id
  } do
    # Cenário: o engine morreu antes de concluir a análise, então NÃO há
    # linha em psychologist_analyses (alreadyAnalyzed: false). A nova
    # tentativa (retry do Oban ou reentrega do outbox após restart) roda a
    # análise inteira e conclui — é isso que o desenho "run falho não
    # grava linha" permite.
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
        "hypotheses" => [
          Map.put(hypothesis(), "terminationAnalysis", %{
            "causa" => "kill",
            "estadoDaSessao" => "em andamento",
            "analise" => "processo morto externamente"
          })
        ]
      })
    ])

    assert :ok = PsychologistWorker.perform(job(session_id, project_id))

    assert_received {:hypotheses_proposed, _tier, "auto", _count, [_h]}
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

    refute_received {:hypotheses_proposed, _, _, _, _}

    assert_received {:event_appended, ^project_id, ^session_id,
                     %{type: "psychologist.analysis_failed"}}
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
    assert_received {:hypotheses_proposed, _, _, _, _}

    assert_received {:event_appended, ^project_id, ^session_id,
                     %{type: "psychologist.analysis_failed"}}
  end
end
