defmodule Engine.Gates.SecOpsAgentServerTest do
  # DataCase — o SecOpsAgent acha o worktree via DevAgentState (lê o banco).
  # Sem LLM/ToolLoop (determinístico) — só os detectors (.Fake) scriptados.
  # `run_design/2` (appsec, RN-360) já usa ToolLoop de verdade, daí precisar
  # do mesmo DataCase (ver o comentário gêmeo em AppSecAgentTest).
  use Engine.DataCase, async: false

  import ExUnit.CaptureLog

  alias Engine.Dev.DevAgentState
  alias Engine.Gates.{GateState, SecOpsAgentServer}
  alias Engine.Sessions.FakeEngineApiClient

  setup do
    root =
      Path.join(
        System.tmp_dir!(),
        "brabo-secops-test-#{System.os_time(:microsecond)}-#{System.unique_integer([:positive])}"
      )

    # `:project_workspaces_root` — só o `run_design/2` (appsec, RN-360)
    # precisa: é o único caminho deste arquivo que roda ToolLoop sem
    # `:workspace_root` explícito (ver o comentário gêmeo em
    # `AppSecAgentTest`). Setar sempre, mesmo pros testes de `run/2`
    # determinístico, é mais simples que condicionar por teste.
    Application.put_env(:engine, :project_workspaces_root, root)
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :semgrep_detector, Engine.Actions.SemgrepDetector.Fake)
    Application.put_env(:engine, :gitleaks_detector, Engine.Actions.GitleaksDetector.Fake)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      File.rm_rf!(root)
      Application.delete_env(:engine, :project_workspaces_root)
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :semgrep_detector)
      Application.delete_env(:engine, :gitleaks_detector)
      Application.delete_env(:engine, :semgrep_fake_available)
      Application.delete_env(:engine, :semgrep_fake_result)
      Application.delete_env(:engine, :gitleaks_fake_available)
      Application.delete_env(:engine, :gitleaks_fake_result)
      Application.delete_env(:engine, :test_pid)
    end)

    project_id = Ecto.UUID.generate()
    session_id = Ecto.UUID.generate()

    DevAgentState.upsert!(%{
      project_id: project_id,
      agent_id: "dev-api",
      module: "api",
      session_id: session_id,
      task_id: "task-abc12345",
      worktree_path: System.tmp_dir!(),
      status: "working"
    })

    Process.put(:fake_dev_context, %{
      "task" => %{"id" => "task-abc12345", "title" => "Cadastro", "description" => ""},
      "story" => %{
        "id" => "st-1",
        "title" => "Cadastro",
        "description" => "",
        "rf" => [],
        "rnf" => [],
        "dod" => [],
        "dor" => []
      },
      "businessRules" => [],
      "adrs" => []
    })

    {:ok, state} = SecOpsAgentServer.init(project_id)
    %{project_id: project_id, state: state}
  end

  test "segredo plantado no worktree (gitleaks): changes_requested, pede correção ao dev", %{
    state: state,
    project_id: project_id
  } do
    Application.put_env(:engine, :gitleaks_fake_available, true)

    Application.put_env(
      :engine,
      :gitleaks_fake_result,
      {:ok, [%{tool: "gitleaks", path: "config.ex", line: 3, message: "AWS key hardcoded"}]}
    )

    Application.put_env(:engine, :semgrep_fake_available, false)
    Process.put(:fake_gate_verdict_response, %{"nextAction" => "correct"})

    assert {:noreply, _} = SecOpsAgentServer.handle_cast({:run, "task-abc12345"}, state)

    assert_received {:event_appended, _, _,
                     %{type: "artifact.secops_verdict", payload: %{veredito: "changes_requested"}}}

    assert_received {:gate_verdict_recorded, "task-abc12345", "secops", "changes_requested",
                     _resumo, itens, _}

    assert Enum.any?(itens, &(&1 =~ "AWS key hardcoded"))

    # ADR 0067: dispatch (correct) aplicado — nada fica em voo.
    assert GateState.get(project_id, "task-abc12345", "secops") == nil
  end

  test "sem achados (gitleaks e semgrep limpos): approved", %{
    state: state,
    project_id: project_id
  } do
    Application.put_env(:engine, :gitleaks_fake_available, true)
    Application.put_env(:engine, :gitleaks_fake_result, {:ok, []})
    Application.put_env(:engine, :semgrep_fake_available, true)
    Application.put_env(:engine, :semgrep_fake_result, {:ok, []})
    Process.put(:fake_gate_verdict_response, %{"nextAction" => "done"})

    assert {:noreply, _} = SecOpsAgentServer.handle_cast({:run, "task-abc12345"}, state)

    assert_received {:gate_verdict_recorded, "task-abc12345", "secops", "approved", _, [], _}
    assert GateState.get(project_id, "task-abc12345", "secops") == nil
  end

  test "scanner ausente: pula, registra no resumo, NUNCA quebra o gate", %{
    state: state,
    project_id: project_id
  } do
    Application.put_env(:engine, :gitleaks_fake_available, false)
    Application.put_env(:engine, :semgrep_fake_available, false)
    Process.put(:fake_gate_verdict_response, %{"nextAction" => "done"})

    assert {:noreply, _} = SecOpsAgentServer.handle_cast({:run, "task-abc12345"}, state)

    assert_received {:gate_verdict_recorded, "task-abc12345", "secops", "approved", resumo, [], _}
    assert resumo =~ "indisponível"
    assert GateState.get(project_id, "task-abc12345", "secops") == nil
  end

  # --- run_design (appsec, RN-360) — segundo momento, sem worktree/task_id ---

  defp backlog_com_story(story_fields) do
    [
      %{
        "id" => "ep-1",
        "stories" => [
          Map.merge(
            %{
              "id" => "st-appsec-1",
              "title" => "Login social",
              "description" => "",
              "rf" => [],
              "rnf" => [],
              "moduleIds" => []
            },
            story_fields
          )
        ]
      }
    ]
  end

  test "run_design: threat model concluído emite artifact.threat_model e cria os TRÊS handoffs",
       %{state: state, project_id: project_id} do
    session_id = Ecto.UUID.generate()
    Process.put(:fake_backlog, backlog_com_story(%{"sessionId" => session_id}))
    Process.put(:fake_infra_context, %{"moduleMap" => nil, "adrs" => []})

    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("emit_threat_model", %{
        "threatModel" => "checklist STRIDE completo",
        "requisitosSeguranca" => ["Validar e-mail verificado pelo provider"],
        "riscos" => []
      })
    ])

    assert {:noreply, _} = SecOpsAgentServer.handle_cast({:run_design, "st-appsec-1"}, state)

    assert_received {:event_appended, ^project_id, ^session_id,
                     %{
                       type: "artifact.threat_model",
                       actorId: "appsec",
                       payload: %{
                         storyId: "st-appsec-1",
                         threatModel: "checklist STRIDE completo",
                         requisitosDeSeguranca: ["Validar e-mail verificado pelo provider"]
                       }
                     }}

    assert_received {:handoff_created, ^project_id, ^session_id, "appsec", "arquiteto",
                     artifact_id}

    assert_received {:handoff_created, ^project_id, ^session_id, "appsec", "dev-lead",
                     ^artifact_id}

    assert_received {:handoff_created, ^project_id, ^session_id, "appsec", "infra", ^artifact_id}
  end

  test "run_design: modelo não conclui — narra agent.error com origem, sem handoff nenhum", %{
    state: state,
    project_id: project_id
  } do
    session_id = Ecto.UUID.generate()
    Process.put(:fake_backlog, backlog_com_story(%{"sessionId" => session_id}))
    Process.put(:fake_infra_context, %{"moduleMap" => nil, "adrs" => []})
    Process.put(:fake_llm_turns, [])

    assert {:noreply, _} = SecOpsAgentServer.handle_cast({:run_design, "st-appsec-1"}, state)

    assert_received {:event_appended, ^project_id, ^session_id,
                     %{type: "agent.error", actorId: "appsec", payload: %{origem: "modelo"}}}

    refute_received {:handoff_created, _, _, _, _, _}
  end

  test "run_design: story inexistente no backlog não derruba o processo, sem evento nenhum", %{
    state: state
  } do
    Process.put(:fake_backlog, backlog_com_story(%{}))

    log =
      capture_log(fn ->
        assert {:noreply, _} =
                 SecOpsAgentServer.handle_cast({:run_design, "st-nunca-existiu"}, state)
      end)

    assert log =~ "contexto de design indisponível"
    refute_received {:event_appended, _, _, _}
    refute_received {:handoff_created, _, _, _, _, _}
  end
end
