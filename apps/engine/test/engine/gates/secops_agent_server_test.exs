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
      worktree_path: pasta_temporaria_propria!(),
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

    Application.put_env(:engine, :semgrep_fake_available, true)
    Application.put_env(:engine, :semgrep_fake_result, {:ok, []})
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

  test "gitleaks ausente: pula, registra no resumo, NUNCA quebra o gate", %{
    state: state,
    project_id: project_id
  } do
    Application.put_env(:engine, :gitleaks_fake_available, false)
    Application.put_env(:engine, :semgrep_fake_available, true)
    Application.put_env(:engine, :semgrep_fake_result, {:ok, []})
    Process.put(:fake_gate_verdict_response, %{"nextAction" => "done"})

    assert {:noreply, _} = SecOpsAgentServer.handle_cast({:run, "task-abc12345"}, state)

    assert_received {:gate_verdict_recorded, "task-abc12345", "secops", "approved", resumo, [], _}
    assert resumo =~ "indisponível"
    assert GateState.get(project_id, "task-abc12345", "secops") == nil
  end

  # RN-714 (AT-380): SAST que não rodou não aprova — sem veredito, a PR segue
  # em awaiting_secops, o motivo vai ao fio com origem infra e o ciclo fica
  # em voo para o GateRescuer reexecutar.
  for {nome, disponivel, resultado, trecho} <- [
        {"saída inválida", true, {:error, :invalid_output}, ":invalid_output"},
        {"binário ausente", false, nil, "indisponível"}
      ] do
    test "semgrep com #{nome}: gate pendente, sem veredito, motivo nomeado", %{
      state: state,
      project_id: project_id
    } do
      Application.put_env(:engine, :gitleaks_fake_available, true)
      Application.put_env(:engine, :gitleaks_fake_result, {:ok, []})
      Application.put_env(:engine, :semgrep_fake_available, unquote(disponivel))
      Application.put_env(:engine, :semgrep_fake_result, unquote(Macro.escape(resultado)))

      assert {:noreply, _} = SecOpsAgentServer.handle_cast({:run, "task-abc12345"}, state)

      refute_received {:gate_verdict_recorded, _, _, _, _, _, _}
      refute_received {:event_appended, _, _, %{type: "artifact.secops_verdict"}}

      assert_received {:event_appended, _, _,
                       %{
                         type: "agent.error",
                         actorId: "secops",
                         payload: %{origem: "infra", mensagem: mensagem}
                       }}

      assert mensagem =~ "SAST não rodou"
      assert mensagem =~ unquote(trecho)
      assert mensagem =~ "reexecute o gate"

      assert %{step: "in_progress"} = GateState.get(project_id, "task-abc12345", "secops")
    end
  end

  # AT-386: o resgate não repete o mesmo erro no fio.
  describe "resgate com o SAST ainda fora" do
    setup do
      Application.put_env(:engine, :gitleaks_fake_available, true)
      Application.put_env(:engine, :gitleaks_fake_result, {:ok, []})
      Application.put_env(:engine, :semgrep_fake_available, true)
      Application.put_env(:engine, :semgrep_fake_result, {:error, :invalid_output})
      :ok
    end

    defp erro_do_fio(task_id, reason),
      do: %{
        "type" => "agent.error",
        "actorId" => "secops",
        "payload" => %{"taskId" => task_id, "reason" => reason}
      }

    defp motivo_gravado(state) do
      SecOpsAgentServer.handle_cast({:run, "task-abc12345"}, state)
      assert_received {:event_appended, _, _, %{type: "agent.error", payload: %{reason: r}}}
      r
    end

    test "primeiro resgate grava; o segundo, com o mesmo motivo, não", %{state: state} do
      motivo = motivo_gravado(state)
      Process.put(:fake_events, [erro_do_fio("task-abc12345", motivo)])

      assert {:noreply, _} = SecOpsAgentServer.handle_cast({:run, "task-abc12345"}, state)
      refute_received {:event_appended, _, _, %{type: "agent.error"}}

      opts = List.last(Process.get(:fake_list_events_calls))
      assert opts[:types] == ["agent.error", "artifact.secops_verdict"]
      assert opts[:latest]
    end

    test "motivo diferente, ou veredito depois do erro, grava de novo", %{state: state} do
      Process.put(:fake_events, [erro_do_fio("task-abc12345", "semgrep indisponível")])
      SecOpsAgentServer.handle_cast({:run, "task-abc12345"}, state)
      assert_received {:event_appended, _, _, %{type: "agent.error"}}

      motivo = motivo_gravado(state)

      Process.put(:fake_events, [
        erro_do_fio("task-abc12345", motivo),
        %{"type" => "artifact.secops_verdict", "payload" => %{"taskId" => "task-abc12345"}}
      ])

      SecOpsAgentServer.handle_cast({:run, "task-abc12345"}, state)
      assert_received {:event_appended, _, _, %{type: "agent.error"}}
    end

    test "o SAST que volta a rodar aprova como sempre", %{state: state} do
      motivo = motivo_gravado(state)
      Process.put(:fake_events, [erro_do_fio("task-abc12345", motivo)])
      Application.put_env(:engine, :semgrep_fake_result, {:ok, []})

      SecOpsAgentServer.handle_cast({:run, "task-abc12345"}, state)

      assert_received {:event_appended, _, _,
                       %{type: "artifact.secops_verdict", payload: %{veredito: "approved"}}}
    end
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

    assert_received {:handoff_if_absent, ^project_id, ^session_id, "appsec", "arquiteto",
                     artifact_id}

    assert_received {:handoff_if_absent, ^project_id, ^session_id, "appsec", "dev-lead",
                     ^artifact_id}

    assert_received {:handoff_if_absent, ^project_id, ^session_id, "appsec", "infra",
                     ^artifact_id}
  end

  # RN-636 (ADR 0182): o AppSec só oferece a quem ainda não recebeu oferta
  # pendente nem está ativo. A api decide sob o lock do destino; o que se prova
  # aqui é que o AppSec PEDE nesse modo e que "já atendido" não vira falha.
  defp threat_model_concluido(state) do
    session_id = Ecto.UUID.generate()
    Process.put(:fake_backlog, backlog_com_story(%{"sessionId" => session_id}))
    Process.put(:fake_infra_context, %{"moduleMap" => nil, "adrs" => []})

    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("emit_threat_model", %{
        "threatModel" => "checklist STRIDE completo",
        "requisitosSeguranca" => [],
        "riscos" => []
      })
    ])

    assert {:noreply, _} = SecOpsAgentServer.handle_cast({:run_design, "st-appsec-1"}, state)
    session_id
  end

  test "run_design (RN-636): destino com oferta pendente ou já ativo não recebe outra, e isso não é erro",
       %{state: state, project_id: project_id} do
    Process.put(:fake_handoff_if_absent, %{
      "dev-lead" => {:ok, %{"id" => "ho-velho", "desfecho" => "ja_oferecido"}},
      "infra" =>
        {:error,
         {409, %{"reason" => "agente_ja_ativo", "message" => "o agente \"infra\" já está ativo"}}}
    })

    session_id = threat_model_concluido(state)

    # Os três são PERGUNTADOS no modo "só se ausente" — nunca no modo que
    # substitui a oferta pendente de outra história.
    for alvo <- ["arquiteto", "dev-lead", "infra"] do
      assert_received {:handoff_if_absent, ^project_id, ^session_id, "appsec", ^alvo, _}
    end

    refute_received {:handoff_created, _, _, _, _, _}

    refute_received {:event_appended, ^project_id, ^session_id,
                     %{type: "agent.error", actorId: "appsec"}}
  end

  test "run_design (RN-636): falha de verdade ao oferecer segue narrada, só para aquele destino",
       %{state: state, project_id: project_id} do
    Process.put(:fake_handoff_if_absent, %{"infra" => {:error, {500, %{"message" => "boom"}}}})

    session_id = threat_model_concluido(state)

    assert_received {:event_appended, ^project_id, ^session_id,
                     %{
                       type: "agent.error",
                       actorId: "appsec",
                       payload: %{origem: "infra", mensagem: mensagem}
                     }}

    assert mensagem =~ "ao infra"

    refute_received {:event_appended, ^project_id, ^session_id,
                     %{type: "agent.error", actorId: "appsec"}}
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

    refute_received {:handoff_if_absent, _, _, _, _, _}
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
    refute_received {:handoff_if_absent, _, _, _, _, _}
  end
end
