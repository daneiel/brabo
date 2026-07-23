defmodule Engine.Workers.SessionLifecycleWorker do
  @moduledoc """
  Processa eventos de ciclo de vida de sessão consumidos da outbox da api
  (aggregate_type = "session") pelo Engine.Outbox.Poller.
  """

  use Oban.Worker, queue: :default, max_attempts: 5

  alias Engine.Sessions.{Monitor, SessionServer, SessionSupervisor}

  @impl true
  def perform(%Oban.Job{
        args: %{
          "event_type" => "session.created",
          "aggregate_id" => session_id,
          "payload" => %{"projectId" => project_id}
        }
      }) do
    {:ok, _pid} = SessionSupervisor.start_session(session_id, project_id)
    :ok
  end

  def perform(%Oban.Job{args: %{"event_type" => event_type, "aggregate_id" => session_id}})
      when event_type in ["session.closed", "session.closed_abnormally"] do
    case Registry.lookup(Engine.Sessions.Registry, session_id) do
      [{pid, _}] ->
        :ok = Monitor.expect_stop(session_id)
        SessionServer.stop(pid)
        :ok

      [] ->
        :ok
    end
  end

  # Catch-all: outros event_type futuros de aggregate_type "session" não
  # falham/retry infinito num desconhecido.
  def perform(%Oban.Job{}), do: :ok
end
