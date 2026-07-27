defmodule Engine.Agents.CriativoSupervisor do
  @moduledoc """
  DynamicSupervisor que cria um CriativoServer por sessão em ideação
  (espelha Engine.Sessions.SessionSupervisor). Idempotente: se já existe um
  Criativo pra a sessão (ex.: usuário clicou "Iniciar ideação" de novo), não
  sobe outro.
  """

  use DynamicSupervisor

  alias Engine.Agents.CriativoServer

  def start_link(_opts), do: DynamicSupervisor.start_link(__MODULE__, :ok, name: __MODULE__)

  @impl true
  def init(:ok), do: DynamicSupervisor.init(strategy: :one_for_one)

  def start_agent(session_id, project_id) do
    case Registry.lookup(Engine.Sessions.Registry, "criativo:" <> session_id) do
      [{pid, _}] ->
        {:ok, pid}

      [] ->
        spec = {CriativoServer, {session_id, project_id}}

        case DynamicSupervisor.start_child(__MODULE__, spec) do
          {:ok, pid} -> {:ok, pid}
          {:error, {:already_started, pid}} -> {:ok, pid}
        end
    end
  end
end
