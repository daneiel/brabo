defmodule Engine.Workers.SessionLifecycleWorkerTest do
  use Engine.DataCase, async: false

  alias Engine.Sessions.SessionSupervisor
  alias Engine.Workers.SessionLifecycleWorker

  setup do
    Engine.GlobalSessionTestLock.acquire()
    Application.put_env(:engine, :engine_api_client, Engine.Sessions.FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :test_pid)
      Engine.GlobalSessionTestLock.release()
    end)

    :ok
  end

  defp unique_id, do: "session-#{System.unique_integer([:positive])}"

  # session.created NÃO é mais tratado por este worker — a criação virou
  # um comando HTTP síncrono da api (ver EngineWeb.SessionCommandController).
  # Confirma o catch-all: um event_type desconhecido/não tratado não falha.
  test "session.created (não mais suportado aqui) cai no catch-all sem falhar e sem criar processo" do
    session_id = unique_id()

    :ok =
      perform_job(SessionLifecycleWorker, %{
        "event_type" => "session.created",
        "aggregate_id" => session_id,
        "payload" => %{"projectId" => "project-1"}
      })

    refute Engine.Sessions.SessionServer.whereis(session_id)
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
    refute_receive {:termination_reported, _, _, _, _}, 200
  end

  test "session.closed para session_id nunca iniciado e um no-op" do
    :ok =
      perform_job(SessionLifecycleWorker, %{
        "event_type" => "session.closed",
        "aggregate_id" => unique_id(),
        "payload" => %{}
      })
  end

  # ADR 0183 (RN-649): a sessão pode ser REABERTA. O job de um fechamento que
  # chega depois da reabertura não pode derrubar o processo da sessão viva.
  describe "fechamento que a reabertura já desfez" do
    test "session.closed de uma sessão que a api já diz `active` não para o processo" do
      session_id = sessao_na_api("active")
      {:ok, pid} = SessionSupervisor.start_session(session_id, "project-1")

      :ok =
        perform_job(SessionLifecycleWorker, %{
          "event_type" => "session.closed",
          "aggregate_id" => session_id,
          "payload" => %{}
        })

      assert Process.alive?(pid)
      :ok = Engine.Sessions.Monitor.expect_stop(session_id)
      Engine.Sessions.SessionServer.stop(pid)
    end

    test "session.closed de uma sessão que a api diz `closed` para o processo, como sempre" do
      session_id = sessao_na_api("closed")
      {:ok, pid} = SessionSupervisor.start_session(session_id, "project-1")

      :ok =
        perform_job(SessionLifecycleWorker, %{
          "event_type" => "session.closed",
          "aggregate_id" => session_id,
          "payload" => %{}
        })

      refute Process.alive?(pid)
    end
  end

  defp sessao_na_api(status) do
    id = Ecto.UUID.generate()

    Engine.Repo.query!(
      "INSERT INTO public.sessions (id, project_id, status) VALUES ($1, $2, $3)",
      [Ecto.UUID.dump!(id), Ecto.UUID.dump!(Ecto.UUID.generate()), status]
    )

    id
  end

  defp perform_job(worker, args) do
    worker.perform(%Oban.Job{args: args})
  end
end
