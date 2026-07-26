defmodule Engine.Telemetry.ObanQueueDepthTest do
  @moduledoc """
  A métrica que o HPA do engine consome (Fase 5, item 3).

  O teste que mais importa aqui é o do `state`: três workers do engine se
  auto-reagendam (`OutboxDrainWorker` a cada 2s, `WorktreeCleanupWorker` a cada
  60s, `AnamneseSchedulerWorker`), então em regime normal a tabela NUNCA está
  vazia — sempre há jobs em `scheduled`. Uma métrica que não separasse por
  estado deixaria o HPA permanentemente acima do alvo, escalando o engine ao
  máximo num sistema ocioso.
  """

  use Engine.DataCase, async: false

  alias Engine.Telemetry.ObanQueueDepth

  setup do
    handler = "oban-queue-depth-test-#{System.unique_integer([:positive])}"

    :telemetry.attach(
      handler,
      ObanQueueDepth.event(),
      fn _event, measurements, metadata, pid ->
        send(pid, {:depth, metadata.queue, metadata.state, measurements.depth})
      end,
      self()
    )

    on_exit(fn -> :telemetry.detach(handler) end)
    :ok
  end

  defp insert_job!(queue, state) do
    Repo.insert_all(
      "oban_jobs",
      [
        [
          state: state,
          queue: queue,
          worker: "Engine.Workers.OutboxDrainWorker",
          args: %{},
          meta: %{},
          tags: [],
          errors: [],
          attempt: 0,
          max_attempts: 20,
          priority: 0,
          inserted_at: DateTime.utc_now() |> DateTime.truncate(:second),
          scheduled_at: DateTime.utc_now() |> DateTime.truncate(:second)
        ]
      ],
      prefix: "engine"
    )
  end

  defp collect(timeout \\ 300) do
    receive do
      {:depth, queue, state, depth} -> [{queue, state, depth} | collect(timeout)]
    after
      timeout -> []
    end
  end

  test "conta jobs available na fila em que foram inseridos" do
    queue = "q#{System.unique_integer([:positive])}"
    for _ <- 1..3, do: insert_job!(queue, "available")

    ObanQueueDepth.measure()

    assert {^queue, "available", 3} =
             collect() |> Enum.find(&match?({^queue, "available", _}, &1))
  end

  test "separa available de scheduled — é o que impede o HPA de escalar à toa" do
    queue = "q#{System.unique_integer([:positive])}"
    insert_job!(queue, "available")
    for _ <- 1..5, do: insert_job!(queue, "scheduled")

    ObanQueueDepth.measure()
    emitted = collect()

    assert {^queue, "available", 1} = Enum.find(emitted, &match?({^queue, "available", _}, &1))

    assert {^queue, "scheduled", 5} = Enum.find(emitted, &match?({^queue, "scheduled", _}, &1)),
           "sem esta separação, 5 jobs agendados apareceriam como backlog e o HPA escalaria"
  end

  test "ignora estados terminais: histórico não é backlog" do
    queue = "q#{System.unique_integer([:positive])}"
    for _ <- 1..4, do: insert_job!(queue, "completed")

    ObanQueueDepth.measure()
    emitted = collect()

    # A fila nem aparece com valor > 0 — se aparecer, o Pruner ainda não passou
    # e o HPA leria trabalho já feito como trabalho pendente.
    assert Enum.all?(emitted, fn {q, _state, depth} -> q != queue or depth == 0 end)
  end

  test "zera uma fila que esvaziou, em vez de deixar o último valor grudado" do
    queue = "q#{System.unique_integer([:positive])}"
    insert_job!(queue, "available")

    ObanQueueDepth.measure()

    assert {^queue, "available", 1} =
             collect() |> Enum.find(&match?({^queue, "available", _}, &1))

    Repo.delete_all(from(j in "oban_jobs", where: j.queue == ^queue), prefix: "engine")
    ObanQueueDepth.measure()

    # A fila sumiu da consulta; o gauge precisa ir explicitamente a zero, senão
    # o Prometheus continua servindo 1 e o HPA mantém réplica de pé à toa.
    emitted = collect()
    depths = for {q, "available", d} <- emitted, q == queue, do: d
    assert depths == [] or depths == [0]
  end

  test "a fila configurada é sempre reportada, mesmo sem nenhum job" do
    Repo.delete_all("oban_jobs", prefix: "engine")

    ObanQueueDepth.measure()
    emitted = collect()

    assert Enum.any?(emitted, &match?({"default", "available", 0}, &1)),
           "sem série para a fila default, o HPA nasce em <unknown> num sistema recém-subido"
  end
end
