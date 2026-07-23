defmodule Engine.Workers.OutboxDrainWorkerTest do
  use Engine.DataCase, async: true
  use Oban.Testing, repo: Engine.Repo, prefix: "engine"

  alias Engine.Workers.OutboxDrainWorker

  test "perform/1 reagenda a si mesmo" do
    :ok = OutboxDrainWorker.perform(%Oban.Job{args: %{}})

    assert_enqueued(worker: OutboxDrainWorker, args: %{})
  end

  test "kickoff/0 é idempotente sob dois chamadas seguidas (não duplica a cadeia)" do
    {:ok, job1} = OutboxDrainWorker.kickoff()
    {:ok, job2} = OutboxDrainWorker.kickoff()

    assert job1.id == job2.id
  end
end
