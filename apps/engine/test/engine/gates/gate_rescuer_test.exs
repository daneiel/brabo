defmodule Engine.Gates.GateRescuerTest do
  # DataCase, async: false — Registry/DynamicSupervisor são processos globais,
  # e o objetivo destes testes é matar processos REAIS e observar a
  # recuperação de ponta a ponta (ADR 0067), não só a função de persistência
  # isolada.
  #
  # Por que o resgate NÃO é dirigido por `Process.put(:fake_llm_turns, ...)`
  # como o resto da suite de gates: aquela técnica só funciona porque
  # `qa_lead_server_test.exs` chama `handle_cast/2` DIRETO no processo de
  # teste (dicionário de processo é local). Aqui os processos que o
  # `GateRescuer` religa são processos supervisionados DE VERDADE, em
  # processo próprio — o dicionário do teste não alcança. O que ISSO alcança
  # (via `Application.get_env(:engine, :test_pid)`, que `FakeEngineApiClient`
  # usa pra notificar, e que NÃO é por processo) é observar o desfecho real:
  # sem turno de LLM scriptado, o ToolLoop do processo religado para
  # imediatamente sem chamar ferramenta — desfecho `origem: "modelo"`,
  # determinístico e sem sorte envolvida. É o MESMO idioma que
  # `dev_rehydrator_test.exs` usa (`force_status!`/`desliga`): a linha
  # durável representa o ponto do crash, e o processo real morto é o que
  # prova que a recuperação não depende de estado em memória.
  use Engine.DataCase, async: false

  alias Engine.Dev.{DevAgentState, DevAgentSupervisor}
  alias Engine.Gates.{FakeGateDispatcher, GateRescuer, GateState, QaLeadSupervisor}
  alias Engine.Sessions.FakeEngineApiClient

  setup do
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :gate_dispatcher)
      Application.delete_env(:engine, :test_pid)
      Application.delete_env(:engine, :gate_rescue_stale_after_seconds)
      Application.delete_env(:engine, :semgrep_detector)
      Application.delete_env(:engine, :gitleaks_detector)
      Application.delete_env(:engine, :semgrep_fake_available)
      Application.delete_env(:engine, :gitleaks_fake_available)
    end)

    %{project_id: Ecto.UUID.generate(), session_id: Ecto.UUID.generate()}
  end

  defp wait_unregister(registry, key, tentativas \\ 100) do
    if Registry.lookup(registry, key) != [] and tentativas > 0 do
      Process.sleep(10)
      wait_unregister(registry, key, tentativas - 1)
    end
  end

  defp wait_gate_state_gone(project_id, task_id, gate, tentativas \\ 200) do
    cond do
      GateState.get(project_id, task_id, gate) == nil ->
        :ok

      tentativas > 0 ->
        Process.sleep(10)
        wait_gate_state_gone(project_id, task_id, gate, tentativas - 1)

      true ->
        flunk("gate_states(#{project_id}, #{task_id}, #{gate}) não foi apagada")
    end
  end

  # ---------------------------------------------------------------------
  # step "in_progress": o processo caiu ANTES de gravar qualquer veredito.
  # ---------------------------------------------------------------------
  describe "resgate de ciclo \"in_progress\"" do
    test "mata o QaLeadServer real com o ciclo em voo, e o resgate reinicia a área sem intervenção manual",
         %{project_id: project_id, session_id: session_id} do
      task_id = "task-#{Ecto.UUID.generate()}"

      DevAgentState.upsert!(%{
        project_id: project_id,
        agent_id: "dev-api",
        module: "api",
        session_id: session_id,
        task_id: task_id,
        worktree_path: System.tmp_dir!(),
        status: "awaiting_gate"
      })

      # O processo REAL sobe (supervisionado, registrado no Engine.Gates.Registry).
      {:ok, pid, :started} = QaLeadSupervisor.start_agent(project_id)

      # A linha durável representa o ponto exato do crash: um ciclo em voo,
      # com o subagente de Automação suspenso (mesmo formato que
      # `qa_lead_server.ex` grava em `continuar_area/4`).
      GateState.upsert!(%{
        project_id: project_id,
        task_id: task_id,
        gate: "qa",
        session_id: session_id,
        step: "in_progress",
        subagent: "qa-automacao"
      })

      # MATA o processo de verdade — a linha durável sobrevive (Postgres),
      # o processo não.
      :ok = DynamicSupervisor.terminate_child(QaLeadSupervisor, pid)
      wait_unregister(Engine.Gates.Registry, {project_id, "qa"})

      assert GateState.get(project_id, task_id, "qa") != nil,
             "a linha durável tem que sobreviver ao processo morto"

      # Limiar de staleness zerado — sem esperar 15 minutos no teste.
      Application.put_env(:engine, :gate_rescue_stale_after_seconds, -1)

      # SEM FakeGateDispatcher aqui: o resgate precisa religar um QaLeadServer
      # DE VERDADE, não só notificar que "religaria".
      assert :ok = GateRescuer.run()

      # Ninguém chamou QaLeadServer.run/2 de novo — só o GateRescuer. O novo
      # processo roda a área do zero (sem turno de LLM scriptado neste
      # processo novo, o ToolLoop para na primeira iteração sem ferramenta) e
      # chega a um desfecho real, sozinho.
      assert_receive {:task_blocked, ^task_id, reason, diagnosis, "qa-lead"}, 2_000
      assert reason =~ "QA de Automação"
      assert diagnosis =~ "emit_qa_verdict"
      assert_receive {:task_blocked_origin, ^task_id, "modelo"}, 2_000

      wait_gate_state_gone(project_id, task_id, "qa")
    end

    test "processo local vivo: o resgate NÃO duplica trabalho", %{
      project_id: project_id,
      session_id: session_id
    } do
      Application.put_env(:engine, :gate_dispatcher, FakeGateDispatcher)
      task_id = "task-#{Ecto.UUID.generate()}"

      DevAgentState.upsert!(%{
        project_id: project_id,
        agent_id: "dev-api",
        module: "api",
        session_id: session_id,
        task_id: task_id,
        worktree_path: System.tmp_dir!(),
        status: "awaiting_gate"
      })

      {:ok, _pid, :started} = QaLeadSupervisor.start_agent(project_id)

      GateState.upsert!(%{
        project_id: project_id,
        task_id: task_id,
        gate: "qa",
        session_id: session_id,
        step: "in_progress"
      })

      # Staleness zerada, mas o processo continua VIVO neste nó — o
      # `Registry.lookup` local é a guarda que impede o resgate de perturbar
      # um ciclo que só está lento.
      Application.put_env(:engine, :gate_rescue_stale_after_seconds, -1)

      assert :ok = GateRescuer.run()

      refute_received {:gate_dispatch, :qa, _, _}
      assert GateState.get(project_id, task_id, "qa") != nil
    end

    test "linha recente (não parada): o resgate não toca", %{
      project_id: project_id,
      session_id: session_id
    } do
      Application.put_env(:engine, :gate_dispatcher, FakeGateDispatcher)
      task_id = "task-#{Ecto.UUID.generate()}"

      GateState.upsert!(%{
        project_id: project_id,
        task_id: task_id,
        gate: "qa",
        session_id: session_id,
        step: "in_progress"
      })

      # Limiar default (900s) — a linha acabou de ser gravada, nem perto de
      # estar parada.
      assert :ok = GateRescuer.run()

      refute_received {:gate_dispatch, :qa, _, _}
      assert GateState.get(project_id, task_id, "qa") != nil
    end
  end

  # ---------------------------------------------------------------------
  # step "dispatch_pending": o veredito JÁ foi gravado — só a chamada em
  # processo que aplica o próximo passo se perdeu.
  # ---------------------------------------------------------------------
  describe "resgate de \"dispatch_pending\"" do
    test "run_secops perdido: mata o QaLeadServer logo depois de gravar o veredito, e o resgate religa o SecOps DE VERDADE — o cenário do enunciado",
         %{project_id: project_id, session_id: session_id} do
      task_id = "task-#{Ecto.UUID.generate()}"

      DevAgentState.upsert!(%{
        project_id: project_id,
        agent_id: "dev-api",
        module: "api",
        session_id: session_id,
        task_id: task_id,
        worktree_path: System.tmp_dir!(),
        status: "awaiting_gate"
      })

      {:ok, pid, :started} = QaLeadSupervisor.start_agent(project_id)

      # A linha representa o instante EXATO que o ADR 0067 endereça: QA já
      # aprovou e `record_gate_verdict` já voltou "run_secops" (durável na
      # api) — o `QaLeadServer` morreu antes de chamar
      # `Dispatcher.run_secops/2`.
      GateState.upsert!(%{
        project_id: project_id,
        task_id: task_id,
        gate: "qa",
        session_id: session_id,
        step: "dispatch_pending",
        next_action: "run_secops"
      })

      :ok = DynamicSupervisor.terminate_child(QaLeadSupervisor, pid)
      wait_unregister(Engine.Gates.Registry, {project_id, "qa"})

      # Scanners indisponíveis — SecOps aprova rápido, sem achado (mesmo
      # idioma do secops_agent_server_test.exs). Application env, não
      # dicionário de processo: quem varre é o processo NOVO.
      Application.put_env(:engine, :semgrep_detector, Engine.Actions.SemgrepDetector.Fake)
      Application.put_env(:engine, :gitleaks_detector, Engine.Actions.GitleaksDetector.Fake)
      Application.put_env(:engine, :semgrep_fake_available, false)
      Application.put_env(:engine, :gitleaks_fake_available, false)

      Application.put_env(:engine, :gate_rescue_stale_after_seconds, -1)

      # Dispatcher REAL — o ponto é provar que um SecOpsAgentServer de
      # verdade sobe e conclui, não que uma mensagem de fake foi mandada.
      assert :ok = GateRescuer.run()

      assert_receive {:gate_verdict_recorded, ^task_id, "secops", "approved", _resumo, [], _},
                     2_000

      wait_gate_state_gone(project_id, task_id, "qa")
    end

    test "correct perdido: religa o DevAgentServer real em awaiting_gate, sem intervenção manual",
         %{project_id: project_id, session_id: session_id} do
      task_id = "task-#{Ecto.UUID.generate()}"

      {:ok, _pid, :started} =
        DevAgentSupervisor.start_agent(
          project_id,
          "dev-api",
          "api",
          session_id,
          nil,
          nil,
          :real,
          3,
          %{
            status: "awaiting_gate",
            task_id: task_id,
            worktree_path: System.tmp_dir!(),
            consecutive_blocked: 0
          }
        )

      GateState.upsert!(%{
        project_id: project_id,
        task_id: task_id,
        gate: "secops",
        session_id: session_id,
        step: "dispatch_pending",
        next_action: "correct",
        correction_reason: "gitleaks achou segredo",
        correction_diagnosis: "[gitleaks] config.ex:3 — AWS key hardcoded"
      })

      Application.put_env(:engine, :gate_rescue_stale_after_seconds, -1)

      assert :ok = GateRescuer.run()

      # DevAgentServer.correct/3 é um cast REAL pro processo REAL — sem turno
      # de LLM scriptado neste processo, o ToolLoop para na primeira
      # iteração e a task é bloqueada com a origem "modelo" (mesmo desfecho
      # do teste "working reidratado" em dev_rehydrator_test.exs).
      assert_receive {:task_blocked, ^task_id, reason, _diagnosis, "dev-api"}, 2_000
      assert reason =~ "correção"

      # E o agente segue sozinho — tenta a PRÓXIMA task, sem restart, sem
      # clique.
      assert_receive {:task_claimed, "api", "dev-api"}, 2_000

      wait_gate_state_gone(project_id, task_id, "secops")
    end
  end
end
