defmodule Engine.Dev.DevAgentSupervisor do
  @moduledoc """
  DynamicSupervisor dos dev agents (Fase 4a), um por {project_id, agent_id}.
  Idempotente; `start_agent/4` sinaliza `:started` (start fresco → o chamador
  dispara `:work`) vs `:existing`.
  """

  use DynamicSupervisor

  alias Engine.Dev.DevAgentServer

  def start_link(_opts), do: DynamicSupervisor.start_link(__MODULE__, :ok, name: __MODULE__)

  @impl true
  def init(:ok), do: DynamicSupervisor.init(strategy: :one_for_one)

  def start_agent(project_id, agent_id, module, session_id) do
    case Registry.lookup(Engine.Dev.Registry, {project_id, agent_id}) do
      [{pid, _}] ->
        {:ok, pid, :existing}

      [] ->
        spec = {DevAgentServer, {project_id, agent_id, module, session_id}}

        case DynamicSupervisor.start_child(__MODULE__, spec) do
          {:ok, pid} -> {:ok, pid, :started}
          {:error, {:already_started, pid}} -> {:ok, pid, :existing}
        end
    end
  end
end
