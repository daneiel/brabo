defmodule Engine.Infra.InfraLeadSupervisor do
  @moduledoc """
  DynamicSupervisor do `InfraLeadServer` (Fase 4a; área — Fase 8c) — mirror
  exato de `Engine.Agents.ArquitetoSupervisor`: o Infra Lead é ativado por
  handoff (mesma família dos agentes conversacionais session-scoped), não o
  padrão project-scoped do Dev/QA/SecOps. MESMA chave de registro de antes
  do 8c — nada no `agent_command_controller.ex` que chama `start_agent/2`
  precisa saber que a área existe.
  """

  use DynamicSupervisor

  alias Engine.Infra.InfraLeadServer

  def start_link(_opts), do: DynamicSupervisor.start_link(__MODULE__, :ok, name: __MODULE__)

  @impl true
  def init(:ok), do: DynamicSupervisor.init(strategy: :one_for_one)

  def start_agent(session_id, project_id) do
    case Registry.lookup(Engine.Sessions.Registry, "infra:" <> session_id) do
      [{pid, _}] ->
        {:ok, pid, :existing}

      [] ->
        spec = {InfraLeadServer, {session_id, project_id}}

        case DynamicSupervisor.start_child(__MODULE__, spec) do
          {:ok, pid} -> {:ok, pid, :started}
          {:error, {:already_started, pid}} -> {:ok, pid, :existing}
        end
    end
  end
end
