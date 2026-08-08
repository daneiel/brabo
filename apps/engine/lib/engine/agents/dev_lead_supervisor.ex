defmodule Engine.Agents.DevLeadSupervisor do
  @moduledoc """
  DynamicSupervisor que cria um DevLeadServer por sessão (espelha
  `Engine.Agents.ArquitetoSupervisor`). Idempotente; sinaliza `:started`
  (start fresco, o controller dispara o kickoff) vs `:existing`.
  """

  use DynamicSupervisor

  alias Engine.Agents.DevLeadServer

  def start_link(_opts), do: DynamicSupervisor.start_link(__MODULE__, :ok, name: __MODULE__)

  @impl true
  def init(:ok), do: DynamicSupervisor.init(strategy: :one_for_one)

  def start_agent(session_id, project_id) do
    case Registry.lookup(Engine.Sessions.Registry, "dev-lead:" <> session_id) do
      [{pid, _}] ->
        {:ok, pid, :existing}

      [] ->
        spec = {DevLeadServer, {session_id, project_id}}

        case DynamicSupervisor.start_child(__MODULE__, spec) do
          {:ok, pid} -> {:ok, pid, :started}
          {:error, {:already_started, pid}} -> {:ok, pid, :existing}
        end
    end
  end
end
