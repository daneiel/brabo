defmodule Engine.Workers.DevAgentWakeWorkerTest do
  # DataCase — DevAgentState.upsert!/list_by_module tocam o banco.
  use Engine.DataCase, async: false

  alias Engine.Dev.{DevAgentState, Wake}
  alias Engine.Workers.DevAgentWakeWorker

  defp job(event_type, payload) do
    %Oban.Job{args: %{"event_type" => event_type, "payload" => payload}}
  end

  defp seed_agent(project_id, agent_id, module, status) do
    DevAgentState.upsert!(%{
      project_id: project_id,
      agent_id: agent_id,
      module: module,
      session_id: Ecto.UUID.generate(),
      status: status,
      impl: "real"
    })
  end

  describe "task.gate_resolved" do
    test "entrega {:gate_resolved, ...} só pro agente do payload" do
      project_id = Ecto.UUID.generate()
      :ok = Wake.subscribe(project_id, "dev-api")

      DevAgentWakeWorker.perform(
        job("task.gate_resolved", %{
          "projectId" => project_id,
          "taskId" => "t1",
          "agentId" => "dev-api",
          "nextAction" => "done"
        })
      )

      assert_receive {:gate_resolved, %{task_id: "t1", next_action: "done"}}
    end

    test "não entrega a outro agente do mesmo projeto" do
      project_id = Ecto.UUID.generate()
      :ok = Wake.subscribe(project_id, "dev-web")

      DevAgentWakeWorker.perform(
        job("task.gate_resolved", %{
          "projectId" => project_id,
          "taskId" => "t1",
          "agentId" => "dev-api",
          "nextAction" => "done"
        })
      )

      refute_receive {:gate_resolved, _}, 100
    end
  end

  describe "task.action_settled (ADR 0052)" do
    test "entrega {:action_settled, ...} só pro agente do payload, com o resultado REAL" do
      project_id = Ecto.UUID.generate()
      :ok = Wake.subscribe(project_id, "dev-api")

      DevAgentWakeWorker.perform(
        job("task.action_settled", %{
          "projectId" => project_id,
          "actionId" => "a1",
          "agentId" => "dev-api",
          "status" => "executed",
          "executionResult" => %{"exitCode" => 0, "stdout" => "ok"}
        })
      )

      assert_receive {:action_settled,
                      %{
                        action_id: "a1",
                        status: "executed",
                        execution_result: %{"exitCode" => 0, "stdout" => "ok"},
                        rejection_reason: nil
                      }}
    end

    test "recusa entrega o motivo — é resposta, não silêncio" do
      project_id = Ecto.UUID.generate()
      :ok = Wake.subscribe(project_id, "dev-api")

      DevAgentWakeWorker.perform(
        job("task.action_settled", %{
          "projectId" => project_id,
          "actionId" => "a1",
          "agentId" => "dev-api",
          "status" => "denied",
          "rejectionReason" => "esse comando não"
        })
      )

      assert_receive {:action_settled,
                      %{action_id: "a1", status: "denied", rejection_reason: "esse comando não"}}
    end

    test "não entrega a outro agente do mesmo projeto" do
      project_id = Ecto.UUID.generate()
      :ok = Wake.subscribe(project_id, "dev-web")

      DevAgentWakeWorker.perform(
        job("task.action_settled", %{
          "projectId" => project_id,
          "actionId" => "a1",
          "agentId" => "dev-api",
          "status" => "executed"
        })
      )

      refute_receive {:action_settled, _}, 100
    end
  end

  describe "task.became_claimable" do
    test "acorda todo agente IDLE do módulo, incluindo o extra de paralelização" do
      project_id = Ecto.UUID.generate()
      seed_agent(project_id, "dev-api", "api", "idle")
      seed_agent(project_id, "dev-api-2", "api", "idle")

      :ok = Wake.subscribe(project_id, "dev-api")
      :ok = Wake.subscribe(project_id, "dev-api-2")

      DevAgentWakeWorker.perform(
        job("task.became_claimable", %{
          "projectId" => project_id,
          "taskId" => "t1",
          "modules" => ["api"]
        })
      )

      assert_receive {:wake, :became_claimable}
      assert_receive {:wake, :became_claimable}
    end

    test "entrega mesmo a agente não-idle: quem filtra é o guard EM PROCESSO, não o banco (D6)" do
      # Antes o worker filtrava `status == "idle"` lendo o BANCO — e o agente
      # só persiste `:idle` DEPOIS de o claim voltar vazio. Na janela desse
      # round-trip a linha ainda dizia `working`, e um wake legítimo era
      # descartado, deixando a task esperando um evento não relacionado.
      # Agora entrega sempre; `handle_info({:wake, …}, %{status: :idle})`
      # decide com o estado REAL, sem corrida. Entregar a mais custa uma
      # mensagem ignorada; entregar a menos custa trabalho parado.
      project_id = Ecto.UUID.generate()
      seed_agent(project_id, "dev-api", "api", "working")

      :ok = Wake.subscribe(project_id, "dev-api")

      DevAgentWakeWorker.perform(
        job("task.became_claimable", %{
          "projectId" => project_id,
          "taskId" => "t1",
          "modules" => ["api"]
        })
      )

      assert_receive {:wake, :became_claimable}
    end

    test "resolve por módulo na tabela durável, não por Naming — extra sem base cadastrado ainda funciona" do
      project_id = Ecto.UUID.generate()
      # Só o extra existe (cenário hipotético de teste; prova que a busca é
      # por `list_by_module`, não por `Naming.dev_agent_id/1`, que só
      # conhece "dev-<módulo>" e nunca acharia "dev-api-2").
      seed_agent(project_id, "dev-api-2", "api", "idle")

      :ok = Wake.subscribe(project_id, "dev-api-2")

      DevAgentWakeWorker.perform(
        job("task.became_claimable", %{
          "projectId" => project_id,
          "taskId" => "t1",
          "modules" => ["api"]
        })
      )

      assert_receive {:wake, :became_claimable}
    end

    test "vários módulos no payload: acorda os agentes de cada um" do
      project_id = Ecto.UUID.generate()
      seed_agent(project_id, "dev-api", "api", "idle")
      seed_agent(project_id, "dev-web", "web", "idle")

      :ok = Wake.subscribe(project_id, "dev-api")
      :ok = Wake.subscribe(project_id, "dev-web")

      DevAgentWakeWorker.perform(
        job("task.became_claimable", %{
          "projectId" => project_id,
          "taskId" => "t1",
          "modules" => ["api", "web"]
        })
      )

      assert_receive {:wake, :became_claimable}
      assert_receive {:wake, :became_claimable}
    end

    test "sem agente nenhum no módulo: :ok, sem crash" do
      project_id = Ecto.UUID.generate()

      assert :ok =
               DevAgentWakeWorker.perform(
                 job("task.became_claimable", %{
                   "projectId" => project_id,
                   "taskId" => "t1",
                   "modules" => ["fantasma"]
                 })
               )
    end
  end

  test "payload incompleto ou event_type inesperado: :ok, sem falhar" do
    assert :ok = DevAgentWakeWorker.perform(%Oban.Job{args: %{"event_type" => "algo"}})
  end
end
