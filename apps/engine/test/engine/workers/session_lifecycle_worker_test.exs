defmodule Engine.Workers.SessionLifecycleWorkerTest do
  use Engine.DataCase, async: false

  alias Engine.Sessions.SessionSupervisor
  alias Engine.Workers.SessionLifecycleWorker

  setup do
    Application.put_env(:engine, :engine_api_client, Engine.Sessions.FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :test_pid)
    end)

    :ok
  end

  defp unique_id, do: "session-#{System.unique_integer([:positive])}"

  test "session.created sobe e registra um processo vivo" do
    session_id = unique_id()

    :ok =
      perform_job(SessionLifecycleWorker, %{
        "event_type" => "session.created",
        "aggregate_id" => session_id,
        "payload" => %{"projectId" => "project-1"}
      })

    assert [{pid, _}] = Registry.lookup(Engine.Sessions.Registry, session_id)
    assert Process.alive?(pid)
  end

  test "session.closed para uma sessao rodando sem disparar callback" do
    session_id = unique_id()
    {:ok, pid} = SessionSupervisor.start_session(session_id, "project-1")

    :ok =
      perform_job(SessionLifecycleWorker, %{
        "event_type" => "session.closed",
        "aggregate_id" => session_id,
        "payload" => %{}
      })

    refute Process.alive?(pid)
    refute_receive {:termination_reported, _, _, _}, 200
  end

  test "session.closed para session_id nunca iniciado e um no-op" do
    :ok =
      perform_job(SessionLifecycleWorker, %{
        "event_type" => "session.closed",
        "aggregate_id" => unique_id(),
        "payload" => %{}
      })
  end

  defp perform_job(worker, args) do
    worker.perform(%Oban.Job{args: args})
  end
end
