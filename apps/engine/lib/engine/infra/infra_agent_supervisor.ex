defmodule Engine.Infra.InfraAgentSupervisor do
  @moduledoc """
  DynamicSupervisor do InfraAgentServer (Fase 4a) — mirror exato de
  `Engine.Agents.ArquitetoSupervisor`: o InfraAgent é ativado por handoff
  (mesma família dos agentes conversacionais session-scoped), não o padrão
  project-scoped do Dev/QA/SecOps.
  """

  use DynamicSupervisor

  alias Engine.Infra.InfraAgentServer

  def start_link(_opts), do: DynamicSupervisor.start_link(__MODULE__, :ok, name: __MODULE__)

  @impl true
  def init(:ok), do: DynamicSupervisor.init(strategy: :one_for_one)

  def start_agent(session_id, project_id) do
    case Registry.lookup(Engine.Sessions.Registry, "infra:" <> session_id) do
      [{pid, _}] ->
        {:ok, pid, :existing}

      [] ->
        spec = {InfraAgentServer, {session_id, project_id}}

        case DynamicSupervisor.start_child(__MODULE__, spec) do
          {:ok, pid} -> {:ok, pid, :started}
          {:error, {:already_started, pid}} -> {:ok, pid, :existing}
        end
    end
  end
end
