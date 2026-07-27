defmodule Engine.Gates.SecOpsAgentSupervisor do
  @moduledoc """
  DynamicSupervisor do SecOpsAgent (Fase 4a), um por `project_id`.
  Idempotente — `start_agent/1` sinaliza `:started`/`:existing` (mesmo
  desenho do `Engine.Gates.QaAgentSupervisor`).
  """

  use DynamicSupervisor

  alias Engine.Gates.SecOpsAgentServer

  def start_link(_opts), do: DynamicSupervisor.start_link(__MODULE__, :ok, name: __MODULE__)

  @impl true
  def init(:ok), do: DynamicSupervisor.init(strategy: :one_for_one)

  def start_agent(project_id) do
    case Registry.lookup(Engine.Gates.Registry, {project_id, "secops"}) do
      [{pid, _}] ->
        {:ok, pid, :existing}

      [] ->
        case DynamicSupervisor.start_child(__MODULE__, {SecOpsAgentServer, project_id}) do
          {:ok, pid} -> {:ok, pid, :started}
          {:error, {:already_started, pid}} -> {:ok, pid, :existing}
        end
    end
  end
end
