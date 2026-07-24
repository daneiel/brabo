defmodule EngineWeb.ExecutionCommandController do
  @moduledoc """
  Comandos síncronos da api pra fase de execução (Fase 4a): subir os
  DevAgentServers (um por módulo) e aceitar a paralelização (subagente extra).
  Guardado por VerifyApiToken.
  """

  use EngineWeb, :controller

  alias Engine.Dev.{DevAgentSupervisor, DevAgentServer, Naming}

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
    agent_id = Naming.extra_agent_id(module)
    {:ok, _pid, origin} = DevAgentSupervisor.start_agent(project_id, agent_id, module, session_id)
    if origin == :started, do: DevAgentServer.work(project_id, agent_id)
    send_resp(conn, 202, "")
  end
end
