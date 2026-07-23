defmodule Engine.Outbox.DrainTest do
  use Engine.DataCase, async: true
  use Oban.Testing, repo: Engine.Repo, prefix: "engine"

  alias Engine.Outbox.{Event, Drain}

  defp insert_outbox_event!(attrs) do
    defaults = %{
      id: Ecto.UUID.generate(),
      aggregate_id: Ecto.UUID.generate(),
      payload: %{},
      created_at: DateTime.utc_now(),
      processed_at: nil
    }

    %Event{}
    |> Ecto.Changeset.change(Map.merge(defaults, attrs))
    |> Repo.insert!()
  end

  test "session.created não é mais roteado (só SessionLifecycleWorker por herança do catch-all, sem PsychologistWorker)" do
    row =
      insert_outbox_event!(%{
        aggregate_type: "session",
        event_type: "session.created",
        payload: %{"projectId" => "project-1"}
      })

    Drain.run_once()

    reloaded = Repo.get!(Event, row.id)
    assert reloaded.processed_at != nil

    assert_enqueued(
      worker: Engine.Workers.SessionLifecycleWorker,
      args: %{
        "event_type" => "session.created",
        "aggregate_id" => row.aggregate_id,
        "payload" => %{"projectId" => "project-1"}
      }
    )

    refute_enqueued(worker: Engine.Workers.PsychologistWorker)
  end

  test "session.closed enfileira SessionLifecycleWorker E PsychologistWorker (fan-out)" do
    row =
      insert_outbox_event!(%{
        aggregate_type: "session",
        event_type: "session.closed",
        payload: %{"projectId" => "project-1"}
      })

    Drain.run_once()

    reloaded = Repo.get!(Event, row.id)
    assert reloaded.processed_at != nil

    assert_enqueued(
      worker: Engine.Workers.SessionLifecycleWorker,
      args: %{"aggregate_id" => row.aggregate_id}
    )

    assert_enqueued(
      worker: Engine.Workers.PsychologistWorker,
      args: %{"aggregate_id" => row.aggregate_id}
    )
  end

  test "linha de outro aggregate_type e ignorada (nao processa, nao enfileira)" do
    row =
      insert_outbox_event!(%{
        aggregate_type: "proposed_action",
        event_type: "proposed_action.created",
        payload: %{}
      })

    Drain.run_once()

    reloaded = Repo.get!(Event, row.id)
    assert reloaded.processed_at == nil
    refute_enqueued(worker: Engine.Workers.SessionLifecycleWorker)
    refute_enqueued(worker: Engine.Workers.PsychologistWorker)
  end
end
