defmodule Engine.Workers.GateRescueSchedulerWorkerTest do
  @moduledoc """
  RN-868 (AT-529): o tick do resgate de gates é UMA corrente. Medido no uso
  real: 11 jobs agendados ao mesmo tempo e a mesma linha do `GateRescuer` 11
  vezes por tick, porque o reagendamento não era único.
  """

  use Engine.DataCase, async: false
  use Oban.Testing, repo: Engine.Repo, prefix: "engine"

  alias Engine.Workers.GateRescueSchedulerWorker

  test "o tick se reagenda e mantém a corrente viva" do
    assert :ok = perform_job(GateRescueSchedulerWorker, %{})

    assert [_] = all_enqueued(worker: GateRescueSchedulerWorker)
  end

  test "com um sucessor já agendado, o tick não abre uma segunda corrente" do
    {:ok, _} = GateRescueSchedulerWorker.kickoff()

    assert :ok = perform_job(GateRescueSchedulerWorker, %{})
    assert :ok = perform_job(GateRescueSchedulerWorker, %{})

    assert [_] = all_enqueued(worker: GateRescueSchedulerWorker)
  end
end
