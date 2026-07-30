defmodule Engine.Gates.QaLeadSupervisor do
  @moduledoc """
  DynamicSupervisor do `QaLeadServer` (Fase 8b), um por `project_id` —
  absorve o papel do antigo `QaAgentSupervisor` (Fase 4a). Idempotente —
  `start_agent/1` sinaliza `:started`/`:existing` (mesmo desenho do
  `Engine.Dev.DevAgentSupervisor`).
  """

  use DynamicSupervisor

  alias Engine.Gates.QaLeadServer

  def start_link(_opts), do: DynamicSupervisor.start_link(__MODULE__, :ok, name: __MODULE__)

  @impl true
  def init(:ok), do: DynamicSupervisor.init(strategy: :one_for_one)

  def start_agent(project_id) do
    case Registry.lookup(Engine.Gates.Registry, {project_id, "qa"}) do
      [{pid, _}] ->
        {:ok, pid, :existing}

      [] ->
        case DynamicSupervisor.start_child(__MODULE__, {QaLeadServer, project_id}) do
          {:ok, pid} -> {:ok, pid, :started}
          {:error, {:already_started, pid}} -> {:ok, pid, :existing}
        end
    end
  end
end
