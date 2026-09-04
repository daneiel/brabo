defmodule Engine.Workers.DevAgentWakeWorker do
  @moduledoc """
  Processa eventos de reagendamento de dev agent consumidos da outbox da api
  (aggregate_type = "task") por Engine.Outbox.Drain (Fase 12b).

  `task.gate_resolved` — um gate terminou (aprovado ou bloqueado) a task de
  UM agente específico (`payload["agentId"]`); entrega `{:gate_resolved,
  ...}` só pra ele.

  `container.running` — o container do PROJETO subiu (RN-501, ADR 0142);
  entrega `{:wake, :became_claimable}` a TODOS os agentes do projeto
  (`DevAgentState.list_by_project/1`), porque a guarda de container em
  `AgentIo.try_claim/2` é por PROJETO, não por módulo.

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

  # Uma ação que o agente propôs teve desfecho — aprovada e executada, ou
  # negada (ADR 0052). Diferente do `pr_settled`, que é sobre a task inteira:
  # aqui o agente está PARADO no meio de um turno, esperando o resultado de uma
  # ferramenta, e o que ele recebe de volta entra no lugar onde estaria a
  # palavra "pending".
  def perform(%Oban.Job{
        args:
          %{
            "event_type" => "task.action_settled",
            "payload" =>
              %{
                "projectId" => project_id,
                "actionId" => action_id,
                "agentId" => agent_id
              } = payload
          } = args
      }) do
    Span.with_session(
      args["traceparent"],
      "outbox.dev_agent_wake",
      %{
        "brabo.project_id" => project_id,
        "brabo.agent_id" => agent_id,
        "brabo.action_id" => action_id
      },
      fn ->
        Wake.deliver(
          project_id,
          agent_id,
          {:action_settled,
           %{
             action_id: action_id,
             status: Map.get(payload, "status"),
             execution_result: Map.get(payload, "executionResult"),
             rejection_reason: Map.get(payload, "rejectionReason")
           }}
        )

        :ok
      end
    )
  end

  def perform(%Oban.Job{
        args:
          %{
            "event_type" => "task.pr_settled",
            "payload" => %{
              "projectId" => project_id,
              "taskId" => task_id,
              "agentId" => agent_id,
              "opened" => opened
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
        Wake.deliver(project_id, agent_id, {:pr_settled, %{task_id: task_id, opened: opened}})
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

  # `container.running` — o container do PROJETO chegou em `running` na api
  # (`RegistrarTransicaoDeContainerUseCase`), e com ele a pré-condição que
  # `Engine.Dev.AgentIo.try_claim/2` passou a exigir (RN-501, ADR 0142).
  #
  # Entrega `{:wake, :became_claimable}` — a MESMA mensagem, e não uma nova —
  # porque a semântica dela já é "pode haver trabalho agora", como o
  # comentário de `EngineWeb.ExecutionCommandController.acordar/4` registra ao
  # usá-la para reativação de execução. Uma mensagem própria exigiria
  # cláusula nova de `handle_info/2` nos DOIS servers (real e Noop) com guard
  # idêntico ao que já existe, sem nenhuma decisão diferente para tomar.
  #
  # `list_by_project/1` e não `list_by_module/2`: o container é do projeto, e
  # a api não tem como saber quais módulos existem do lado do engine.
  def perform(%Oban.Job{
        args:
          %{
            "event_type" => "container.running",
            "payload" => %{"projectId" => project_id}
          } = args
      }) do
    Span.with_session(
      args["traceparent"],
      "outbox.dev_agent_wake",
      %{"brabo.project_id" => project_id},
      fn ->
        project_id
        |> DevAgentState.list_by_project()
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
