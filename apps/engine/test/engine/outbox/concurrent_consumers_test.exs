defmodule Engine.Outbox.ConcurrentConsumersTest do
  @moduledoc """
  Prova que FOR UPDATE SKIP LOCKED evita processar a mesma linha duas
  vezes sob dois consumidores concorrentes de verdade. O sandbox padrão
  do Ecto restringe a suite a UMA conexão por teste — pra ter duas
  transações Postgres genuinamente concorrentes, cada Task.async abaixo
  faz seu próprio checkout(sandbox: false) (mesma técnica de
  test_helper.exs), fora do sandbox transacional. Como não há rollback
  automático aqui, a limpeza das linhas inseridas é manual via on_exit.
  """

  use ExUnit.Case, async: false
  use Oban.Testing, repo: Engine.Repo, prefix: "engine"

  import Ecto.Query

  alias Engine.Outbox.{Event, Drain}
  alias Engine.Repo

  test "dois consumidores concorrentes não processam a mesma linha duas vezes" do
    ids = for _ <- 1..10, do: Ecto.UUID.generate()

    :ok = Ecto.Adapters.SQL.Sandbox.checkout(Repo, sandbox: false)

    for id <- ids do
      %Event{}
      |> Ecto.Changeset.change(%{
        id: id,
        aggregate_type: "session",
        # mesmo valor de id — o job enfileirado carrega aggregate_id no
        # payload, e é por esse campo que a asserção abaixo localiza os
        # jobs gerados por ESTE teste (não por aggregate_id != id).
        aggregate_id: id,
        event_type: "session.closed",
        payload: %{"projectId" => "project-1"},
        created_at: DateTime.utc_now(),
        processed_at: nil
      })
      |> Repo.insert!()
    end

    Ecto.Adapters.SQL.Sandbox.checkin(Repo)

    on_exit(fn ->
      :ok = Ecto.Adapters.SQL.Sandbox.checkout(Repo, sandbox: false)
      Repo.delete_all(from(e in Event, where: e.id in ^ids))

      Repo.delete_all(
        from(j in Oban.Job, where: fragment("?->>'aggregate_id'", j.args) in ^ids),
        prefix: "engine"
      )

      Ecto.Adapters.SQL.Sandbox.checkin(Repo)
    end)

    tasks =
      for _ <- 1..2 do
        Task.async(fn ->
          :ok = Ecto.Adapters.SQL.Sandbox.checkout(Repo, sandbox: false)
          result = Drain.run_once()
          Ecto.Adapters.SQL.Sandbox.checkin(Repo)
          result
        end)
      end

    Task.await_many(tasks, 5_000)

    :ok = Ecto.Adapters.SQL.Sandbox.checkout(Repo, sandbox: false)

    processed_count =
      Repo.aggregate(from(e in Event, where: e.id in ^ids and not is_nil(e.processed_at)), :count)

    # Cada linha só pode ter gerado UM job — não o dobro (o que
    # aconteceria se as duas transações concorrentes tivessem processado
    # a mesma linha sem o FOR UPDATE SKIP LOCKED).
    jobs_count =
      Repo.aggregate(
        from(j in Oban.Job,
          where:
            j.worker == "Engine.Workers.SessionLifecycleWorker" and
              fragment("?->>'aggregate_id'", j.args) in ^ids
        ),
        :count,
        prefix: "engine"
      )

    Ecto.Adapters.SQL.Sandbox.checkin(Repo)

    assert processed_count == length(ids)
    assert jobs_count == length(ids)
  end
end
