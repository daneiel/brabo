defmodule EngineWeb.ExecutionCommandController do
  @moduledoc """
  Comandos síncronos da api pra fase de execução (Fase 4a): subir os
  DevAgentServers (um por módulo) e aceitar a paralelização (subagente extra).
  Guardado por VerifyApiToken.
  """

  use EngineWeb, :controller

  alias Engine.Dev.{DevAgentServer, DevAgentState, DevAgentSupervisor, Naming}

  def start(
        conn,
        %{"sessionId" => session_id, "projectId" => project_id, "modules" => modules} = params
      ) do
    task_budget_micros = Map.get(params, "taskBudgetMicros")
    max_gate_corrections = Map.get(params, "maxGateCorrections")

    Enum.each(modules, fn module ->
      agent_id = Naming.dev_agent_id(module)

      {:ok, _pid, origin} =
        DevAgentSupervisor.start_agent(
          project_id,
          agent_id,
          module,
          session_id,
          task_budget_micros,
          max_gate_corrections
        )

      if origin == :started, do: DevAgentServer.work(project_id, agent_id)
    end)

    send_resp(conn, 201, "")
  end

  def parallelize(conn, %{
        "sessionId" => session_id,
        "projectId" => project_id,
        "module" => module
      }) do
    # O subagente extra HERDA os tetos do agente base do módulo. Passar os
    # defaults (nil) daria a ele gasto ILIMITADO — a guarda de orçamento do
    # ToolLoop é `when is_integer(budget)` —, e o aceite de um clique não
    # pode criar um agente sem teto. A api não serve de fonte aqui: ela não
    # persiste o orçamento escolhido na ativação, então o estado durável do
    # engine é o único lugar que conhece um valor customizado.
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
            base.max_gate_corrections
          )

        if origin == :started, do: DevAgentServer.work(project_id, agent_id)
        send_resp(conn, 202, "")
    end
  end
end
