defmodule SessionEngine.SessionSupervisor do
  @moduledoc """
  DynamicSupervisor que cria um SessionServer por sessão.
  """

  use DynamicSupervisor

  def start_link(_opts) do
    DynamicSupervisor.start_link(__MODULE__, :ok, name: __MODULE__)
  end

  @impl true
  def init(:ok) do
    DynamicSupervisor.init(strategy: :one_for_one)
  end

  @doc """
  Cria uma nova sessão sob supervisão e a registra no
  PsychologistMonitor (que passa a monitorá-la via Process.monitor).
  """
  def start_session(session_id) do
    spec = {SessionEngine.SessionServer, session_id}
    {:ok, pid} = DynamicSupervisor.start_child(__MODULE__, spec)
    :ok = SessionEngine.PsychologistMonitor.watch(pid, session_id)
    {:ok, pid}
  end
end
