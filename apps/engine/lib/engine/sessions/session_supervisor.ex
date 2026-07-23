defmodule Engine.Sessions.SessionSupervisor do
  @moduledoc """
  DynamicSupervisor que cria um SessionServer por sessão ativa.
  """

  use DynamicSupervisor

  def start_link(_opts), do: DynamicSupervisor.start_link(__MODULE__, :ok, name: __MODULE__)

  @impl true
  def init(:ok), do: DynamicSupervisor.init(strategy: :one_for_one)

  @doc """
  Idempotente: se `session_id` já está registrado (ex.: um job Oban
  reprocessado), não sobe outro processo.
  """
  def start_session(session_id, project_id) do
    case Registry.lookup(Engine.Sessions.Registry, session_id) do
      [{pid, _}] ->
        {:ok, pid}

      [] ->
        spec = {Engine.Sessions.SessionServer, {session_id, project_id}}

        case DynamicSupervisor.start_child(__MODULE__, spec) do
          {:ok, pid} ->
            :ok = Engine.Sessions.Monitor.watch(pid, session_id, project_id)
            {:ok, pid}

          {:error, {:already_started, pid}} ->
            {:ok, pid}
        end
    end
  end
end
