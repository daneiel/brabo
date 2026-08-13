defmodule Engine.Gates.SecOpsAgentServerTest do
  # DataCase — o SecOpsAgent acha o worktree via DevAgentState (lê o banco).
  # Sem LLM/ToolLoop (determinístico) — só os detectors (.Fake) scriptados.
  use Engine.DataCase, async: false

  alias Engine.Dev.DevAgentState
  alias Engine.Gates.{GateState, SecOpsAgentServer}
  alias Engine.Sessions.FakeEngineApiClient

  setup do
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :semgrep_detector, Engine.Actions.SemgrepDetector.Fake)
    Application.put_env(:engine, :gitleaks_detector, Engine.Actions.GitleaksDetector.Fake)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
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
end
