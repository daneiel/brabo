defmodule Engine.Workers.PsychologistWorkerTest do
  use Engine.DataCase, async: false

  alias Engine.Workers.PsychologistWorker

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

  test "lê o event log e grava o placeholder via append_event" do
    session_id = Ecto.UUID.generate()

    :ok =
      PsychologistWorker.perform(%Oban.Job{
        args: %{
          "aggregate_id" => session_id,
          "payload" => %{"projectId" => "project-1"}
        }
      })

    assert_receive {:event_appended, "project-1", ^session_id, event}
    assert event.type == "psychologist.hypothesis"
    assert event.actorKind == "agent"
    assert event.actorId == "psychologist-stub"
    assert %{summary: summary, event_count: 0} = event.payload
    assert summary =~ "fase 3+"
  end
end
