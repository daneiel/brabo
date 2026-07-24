defmodule Engine.Agents.PoSupervisor do
  @moduledoc """
  DynamicSupervisor que cria um PoServer por sessão (espelha
  Engine.Agents.CriativoSupervisor). Idempotente. `start_agent/2` sinaliza se o
  processo foi criado AGORA (`:started`) ou já existia (`:existing`) — o
  controller só dispara o `:kickoff` num start fresco, pra não regerar o
  backlog em restart/reativação.
  """

  use DynamicSupervisor

  alias Engine.Agents.PoServer

  def start_link(_opts), do: DynamicSupervisor.start_link(__MODULE__, :ok, name: __MODULE__)

  @impl true
  def init(:ok), do: DynamicSupervisor.init(strategy: :one_for_one)

  def start_agent(session_id, project_id) do
    case Registry.lookup(Engine.Sessions.Registry, "po:" <> session_id) do
      [{pid, _}] ->
        {:ok, pid, :existing}

      [] ->
        spec = {PoServer, {session_id, project_id}}

        case DynamicSupervisor.start_child(__MODULE__, spec) do
          {:ok, pid} -> {:ok, pid, :started}
          {:error, {:already_started, pid}} -> {:ok, pid, :existing}
        end
    end
  end
end
