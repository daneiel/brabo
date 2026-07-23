defmodule Engine.Outbox.PollerTest do
  use Engine.DataCase, async: true
  use Oban.Testing, repo: Engine.Repo, prefix: "engine"

  alias Engine.Outbox.{Event, Poller}

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

  test "linha session nao-processada vira processada e enfileira o job" do
    row =
      insert_outbox_event!(%{
        aggregate_type: "session",
        event_type: "session.created",
        payload: %{"projectId" => "project-1"}
      })

    Poller.run_once()

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
  end

  test "linha de outro aggregate_type e ignorada (nao processa, nao enfileira)" do
    row =
      insert_outbox_event!(%{
        aggregate_type: "proposed_action",
        event_type: "proposed_action.created",
        payload: %{}
      })

    Poller.run_once()

    reloaded = Repo.get!(Event, row.id)
    assert reloaded.processed_at == nil
    refute_enqueued(worker: Engine.Workers.SessionLifecycleWorker)
  end
end
