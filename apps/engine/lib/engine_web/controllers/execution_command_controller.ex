defmodule EngineWeb.ExecutionCommandController do
  @moduledoc """
  Comandos síncronos da api pra fase de execução (Fase 4a): subir os
  DevAgentServers (um por módulo), aceitar a paralelização (subagente extra),
  e rearmar um agente travado pelo circuit breaker (Fase 12b — RN-047).
  Guardado por VerifyServiceToken.
  """

  use EngineWeb, :controller

  alias Engine.Dev.{DevAgentState, DevAgentSupervisor, Naming, Wake}

  def start(
        conn,
        %{"sessionId" => session_id, "projectId" => project_id, "modules" => modules} = params
      ) do
    task_budget_micros = Map.get(params, "taskBudgetMicros")
    max_gate_corrections = Map.get(params, "maxGateCorrections")
    max_consecutive_blocked = Map.get(params, "maxConsecutiveBlocked")
    # "real" (default) | "noop" — ver Engine.Dev.NoopDevAgentServer.
    impl = Map.get(params, "impl", "real")

    Enum.each(modules, fn module ->
      agent_id = Naming.dev_agent_id(module)

      {:ok, _pid, origin} =
        DevAgentSupervisor.start_agent(
          project_id,
          agent_id,
          module,
          session_id,
          task_budget_micros,
          max_gate_corrections,
          impl,
          max_consecutive_blocked
        )

      if origin == :started, do: DevAgentSupervisor.server_for(impl).work(project_id, agent_id)
    end)

    send_resp(conn, 201, "")
  end

  def parallelize(conn, %{
        "sessionId" => session_id,
        "projectId" => project_id,
        "module" => module
      }) do
    # O subagente extra HERDA os tetos E O MODO do agente base do módulo.
    # Passar os defaults (nil) daria a ele gasto ILIMITADO — a guarda de
    # orçamento do ToolLoop é `when is_integer(budget)` —, e o aceite de um
    # clique não pode criar um agente sem teto. A api não serve de fonte
    # aqui: ela não persiste o orçamento escolhido na ativação, então o
    # estado durável do engine é o único lugar que conhece um valor
    # customizado. O modo segue a mesma regra: aceitar a paralelização de uma
    # execução Noop não pode subir um agente real (com LLM e custo). O teto
    # do circuit breaker (Fase 12b) segue a mesma herança.
    case DevAgentState.get(project_id, Naming.dev_agent_id(module)) do
      nil ->
        conn
        |> put_status(409)
        |> json(%{error: "sem agente base pro módulo #{module}: nada de que herdar o teto"})

      base ->
        agent_id = Naming.extra_agent_id(module)

        {:ok, _pid, origin} =
          DevAgentSupervisor.start_agent(
            project_id,
            agent_id,
            module,
            session_id,
            base.task_budget_micros,
            base.max_gate_corrections,
            base.impl,
            base.max_consecutive_blocked
          )

        if origin == :started,
          do: DevAgentSupervisor.server_for(base.impl).work(project_id, agent_id)

        send_resp(conn, 202, "")
    end
  end

  def rearm(conn, %{
        "sessionId" => _session_id,
        "agentId" => agent_id,
        "projectId" => project_id
      }) do
    case DevAgentState.get(project_id, agent_id) do
      nil ->
        conn
        |> put_status(404)
        |> json(%{error: "agente #{agent_id} não encontrado"})

      # 409 fora de `idle_tripped` (correção D8): o `handle_info(:rearm, …)`
      # é no-op em qualquer outro estado, então devolver 202 fazia a api
      # gravar um `dev.rearmed` — evento IMUTÁVEL — para um rearm que
      # comprovadamente não aconteceu. Rearmar quem não está travado não é
      # sucesso silencioso, é pedido sem sentido.
      %{status: status} when status != "idle_tripped" ->
        conn
        |> put_status(409)
        |> json(%{
          error: "agente #{agent_id} não está travado (status: #{status}) — nada a rearmar"
        })

      _state ->
        :ok = Wake.deliver(project_id, agent_id, :rearm)
        send_resp(conn, 202, "")
    end
  end
end
