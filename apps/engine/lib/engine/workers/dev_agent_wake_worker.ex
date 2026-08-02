defmodule Engine.Workers.DevAgentWakeWorker do
  @moduledoc """
  Processa eventos de reagendamento de dev agent consumidos da outbox da api
  (aggregate_type = "task") por Engine.Outbox.Drain (Fase 12b).

  `task.gate_resolved` — um gate terminou (aprovado ou bloqueado) a task de
  UM agente específico (`payload["agentId"]`); entrega `{:gate_resolved,
  ...}` só pra ele.

  `task.became_claimable` — uma task virou pegável; entrega
  `{:wake, :became_claimable}` a TODOS os agentes dos módulos do payload
  (`DevAgentState.list_by_module/2`, não `Engine.Dev.Naming.dev_agent_id/1`,
  que só conhece o agente BASE — um extra de paralelização como `dev-api-2`
  ficaria de fora).

  **Não filtra por status aqui de propósito** (correção D6). Filtrar
  `status == "idle"` lendo o BANCO parecia uma economia, mas o agente só
  persiste `:idle` DEPOIS de o `claim_task` voltar vazio — na janela desse
  round-trip a linha ainda diz `working`/`awaiting_gate`, e um wake
  legítimo era descartado, deixando a task esperando um evento não
  relacionado. Quem decide é o guard EM PROCESSO
  (`handle_info({:wake, …}, %{status: :idle})`), que enxerga o estado real
  e sem corrida; o custo de entregar a mais é uma mensagem ignorada.

  Entrega sempre via `Engine.Dev.Wake` (PubSub) — nunca chama o GenServer
  direto. Agente inexistente ou já ocupado: `:ok`, sem retry — não é erro,
  é o estado normal na maioria das entregas (só um agente idle reage).
  """

  use Oban.Worker, queue: :default, max_attempts: 5

  alias Engine.Dev.{DevAgentState, Wake}
  alias Engine.Telemetry.Span

  @impl true
  def perform(%Oban.Job{
        args:
          %{
            "event_type" => "task.gate_resolved",
            "payload" => %{
              "projectId" => project_id,
              "taskId" => task_id,
              "agentId" => agent_id,
              "nextAction" => next_action
            }
          } = args
      }) do
    Span.with_session(
      args["traceparent"],
      "outbox.dev_agent_wake",
      %{
        "brabo.project_id" => project_id,
        "brabo.agent_id" => agent_id,
        "brabo.task_id" => task_id
      },
      fn ->
        Wake.deliver(
          project_id,
          agent_id,
          {:gate_resolved, %{task_id: task_id, next_action: next_action}}
        )

        :ok
      end
    )
  end

  def perform(%Oban.Job{
        args:
          %{
            "event_type" => "task.became_claimable",
            "payload" => %{"projectId" => project_id, "modules" => modules}
          } = args
      }) do
    Span.with_session(
      args["traceparent"],
      "outbox.dev_agent_wake",
      %{"brabo.project_id" => project_id, "brabo.modules" => Enum.join(modules, ",")},
      fn ->
        modules
        |> Enum.flat_map(&DevAgentState.list_by_module(project_id, &1))
        |> Enum.uniq_by(& &1.agent_id)
        |> Enum.each(&Wake.deliver(project_id, &1.agent_id, {:wake, :became_claimable}))

        :ok
      end
    )
  end

  # Catch-all: payload incompleto ou event_type que o roteamento do drain
  # não deveria ter mandado pra cá — nunca falha/retry infinito num caso
  # inesperado.
  def perform(%Oban.Job{}), do: :ok
end
