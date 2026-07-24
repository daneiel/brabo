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

    on_exit(fn ->
      File.rm_rf!(root)
      Application.delete_env(:engine, :project_workspaces_root)
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :test_pid)
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
    assert payload.consumedQueueIds == ["queue-1"]
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

  test "sem sessão no projeto: não roda (não há onde narrar)", %{
    project_id: project_id
  } do
    Process.put(:fake_anamnese_context, context())

    assert :ok = AnamneseWorker.perform(job(project_id, nil))

    refute_received {:llm_turn, _agent, _messages, _tools}
  end
end
