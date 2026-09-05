defmodule Engine.Dev.ClaimComContainerTest do
  @moduledoc """
  A guarda de container antes do claim (RN-502, ADR 0143).

  Fica em arquivo próprio, e não dentro de `dev_agent_server_test.exs`, por
  uma diferença de PRÉ-CONDIÇÃO: todas as outras specs de dev agent agora
  registram um container `running` no setup, porque elas são sobre o ciclo do
  agente COM ambiente de execução. Aqui a ausência do container É o assunto,
  então o setup deliberadamente não registra nada — misturar os dois no mesmo
  arquivo obrigaria metade dos testes a desfazer o setup do outro.

  Os quatro caminhos que chegam em `AgentIo.try_claim/2` estão cobertos:
  o `:work` inicial, a reidratação (`init/1` -> `finish_restart_recovery/1`,
  que NÃO passa por rota nenhuma da api — é por isso que a guarda mora no
  engine e não só no `activate-execution`), o wake que solta o agente quando
  o container sobe, e o Noop (mesmo `AgentIo`, mesma guarda).
  """

  use Engine.DataCase, async: false

  alias Engine.Dev.{DevAgentServer, DevAgentState, FakeWorktreeManager, NoopDevAgentServer}
  alias Engine.Gates.FakeGateDispatcher
  alias Engine.Outbox.{Drain, Event}
  alias Engine.Sessions.FakeEngineApiClient

  setup do
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :worktree_manager, FakeWorktreeManager)
    Application.put_env(:engine, :gate_dispatcher, FakeGateDispatcher)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :worktree_manager)
      Application.delete_env(:engine, :gate_dispatcher)
      Application.delete_env(:engine, :test_pid)
    end)

    project_id = Ecto.UUID.generate()
    session_id = Ecto.UUID.generate()

    # SEM `container_running!/1` de propósito — a ausência é o assunto.
    Process.put(:fake_tasks, [%{"id" => "task-abc12345", "title" => "Cadastro"}])

    %{project_id: project_id, session_id: session_id}
  end

  defp sobe(project_id, session_id) do
    {:ok, state} =
      DevAgentServer.init({project_id, "dev-api", "api", session_id, nil, nil, nil, nil})

    state
  end

  describe "sem container `running` registrado" do
    test "o `:work` inicial cai em :idle, persiste, emite dev.blocked_by_container e NÃO chama a api",
         ctx do
      state = sobe(ctx.project_id, ctx.session_id)

      assert {:noreply, parado} = DevAgentServer.handle_cast(:work, state)

      assert parado.status == :idle
      assert parado.task_id == nil

      # Durável — é o que a reidratação e o painel leem.
      assert DevAgentState.get(ctx.project_id, "dev-api").status == "idle"

      assert_received {:event_appended, _, _,
                       %{type: "dev.blocked_by_container", payload: payload}}

      assert payload.agentId == "dev-api"
      assert payload.module == "api"
      assert payload.reason =~ "container"

      # A afirmação que importa: a guarda vem ANTES de `claim_task/1`.
      # Reivindicar para devolver logo depois deixaria a task marcada e sem
      # dono vivo — exatamente o que `block_task/4` existe para nunca produzir.
      refute_received {:task_claimed, _, _}

      # E não se disfarça de "fila vazia": os dois desfechos param no mesmo
      # `:idle`, e só o evento os distingue.
      refute_received {:event_appended, _, _, %{type: "dev.idle"}}
    end

    test "o Noop passa pela MESMA guarda (é o mesmo AgentIo)", ctx do
      {:ok, state} =
        NoopDevAgentServer.init(
          {ctx.project_id, "dev-api", "api", ctx.session_id, 500_000, 2, nil, nil}
        )

      assert {:noreply, parado} = NoopDevAgentServer.handle_cast(:work, state)

      assert parado.status == :idle
      assert_received {:event_appended, _, _, %{type: "dev.blocked_by_container"}}
      refute_received {:task_claimed, _, _}
    end

    test "agente REIDRATADO de um `working` interrompido também para em :idle, sem claimar",
         ctx do
      resume = %{
        task_id: "task-antiga",
        worktree_path: "/tmp/worktree-antigo",
        status: "working",
        consecutive_blocked: 0
      }

      {:ok, state, {:continue, continuacao}} =
        DevAgentServer.init(
          {ctx.project_id, "dev-api", "api", ctx.session_id, nil, nil, nil, resume}
        )

      assert {:noreply, reidratado} = DevAgentServer.handle_continue(continuacao, state)

      # A task retida é devolvida (isso é do restart, não da guarda)...
      assert_received {:event_appended, _, _, %{type: "dev.blocked"}}

      # ...e o claim seguinte é o que a guarda barra. Este é o caminho que um
      # gate só no `activate-execution` da api perderia inteiro: a reidratação
      # não faz cast `:work` nem passa por rota nenhuma.
      assert reidratado.status == :idle
      assert reidratado.task_id == nil
      assert_received {:event_appended, _, _, %{type: "dev.blocked_by_container"}}
      refute_received {:task_claimed, _, _}
    end
  end

  describe "com container `running` registrado" do
    test "o comportamento de sempre segue intacto: claima e trabalha", ctx do
      container_running!(ctx.project_id)
      state = sobe(ctx.project_id, ctx.session_id)

      Process.put(:fake_llm_turns, [
        FakeEngineApiClient.tool_call_response("report_done", %{"summary" => "feito"})
      ])

      assert {:noreply, _depois} = DevAgentServer.handle_cast(:work, state)

      assert_received {:task_claimed, "api", "dev-api"}
      refute_received {:event_appended, _, _, %{type: "dev.blocked_by_container"}}
    end
  end

  describe "o wake que solta o agente quando o container sobe" do
    # A corrente inteira, como em `wake_do_outbox_ao_agente_test.exs`: linha na
    # outbox da api -> `Drain` -> job do Oban -> `DevAgentWakeWorker` ->
    # `Engine.Dev.Wake` -> mailbox do processo (que é onde `init/1` assinou).
    test "container.running na outbox chega ao agente :idle, e ele re-claima", ctx do
      state = sobe(ctx.project_id, ctx.session_id)

      assert {:noreply, parado} = DevAgentServer.handle_cast(:work, state)
      assert parado.status == :idle
      refute_received {:task_claimed, _, _}

      # O container sobe DE VERDADE (a api gravaria a linha e publicaria o
      # evento na MESMA transação).
      container_running!(ctx.project_id)
      evento_container_running!(ctx.project_id)

      Drain.run_once()
      Oban.drain_queue(queue: :default)

      # A mensagem chegou — e é a mesma `{:wake, :became_claimable}` que os
      # dois servers já sabiam tratar, sem cláusula nova de `handle_info/2`.
      assert_receive {:wake, :became_claimable}

      Process.put(:fake_llm_turns, [
        FakeEngineApiClient.tool_call_response("report_done", %{"summary" => "feito"})
      ])

      assert {:noreply, _} = DevAgentServer.handle_info({:wake, :became_claimable}, parado)
      assert_received {:task_claimed, "api", "dev-api"}
    end
  end

  # A linha exatamente como `RegistrarTransicaoDeContainerUseCase` a grava:
  # agregado `container` (o terceiro que o dreno passou a ler), id do PROJETO.
  defp evento_container_running!(project_id) do
    %Event{}
    |> Ecto.Changeset.change(%{
      id: Ecto.UUID.generate(),
      aggregate_type: "container",
      aggregate_id: project_id,
      event_type: "container.running",
      payload: %{"projectId" => project_id},
      created_at: DateTime.utc_now(),
      processed_at: nil
    })
    |> Repo.insert!()
  end
end
