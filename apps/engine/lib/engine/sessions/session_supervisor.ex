defmodule Engine.Sessions.SessionSupervisor do
  @moduledoc """
  DynamicSupervisor que cria um SessionServer por sessão ativa.
  """

  use DynamicSupervisor

  def start_link(_opts), do: DynamicSupervisor.start_link(__MODULE__, :ok, name: __MODULE__)

  @impl true
  def init(:ok), do: DynamicSupervisor.init(strategy: :one_for_one)

  alias Engine.Sessions.SessionServer

  @doc """
  Idempotente **no cluster inteiro**, não só neste nó.

  A checagem otimista por `whereis/1` evita o trabalho de montar a child spec
  no caso comum, mas quem garante a unicidade é o registro `:global` do próprio
  SessionServer: duas réplicas reidratando ao mesmo tempo entram as duas no
  `start_child`, e a perdedora recebe `{:error, {:already_started, pid}}` — que
  aqui é sucesso, porque significa que outro nó já é dono da sessão.

  `pid` devolvido pode ser remoto. Quem precisa saber se a sessão é LOCAL (o
  drain de shutdown) compara `node(pid)`.
  """
  def start_session(session_id, project_id, trace_parent \\ nil) do
    case SessionServer.whereis(session_id) do
      pid when is_pid(pid) ->
        {:ok, pid}

      nil ->
        spec = {SessionServer, {session_id, project_id, trace_parent}}

        case DynamicSupervisor.start_child(__MODULE__, spec) do
          {:ok, pid} ->
            :ok = Engine.Sessions.Monitor.watch(pid, session_id, project_id)
            {:ok, pid}

          # Corrida perdida para outro nó (ou para outro processo deste nó):
          # o dono já existe e é ele quem vale.
          {:error, {:already_started, pid}} ->
            {:ok, pid}
        end
    end
  end
end
