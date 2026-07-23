defmodule Engine.Outbox.Poller do
  @moduledoc """
  A cada `@interval_ms`, varre outbox_events (aggregate_type = "session",
  processed_at IS NULL) e, para cada linha, em UMA transação: insere o job
  Oban + marca processed_at — detectar e marcar-processado não podem ser
  separados (perderia ou duplicaria evento num crash no meio). O Oban
  garante ao menos uma execução do job já inserido, mesmo entre restarts.

  2s de intervalo: eventos de ciclo de vida de sessão não são
  latência-crítica; mantém carga desprezível no Postgres (a única query
  usa o índice parcial outbox_events_unprocessed_idx).

  Sem FOR UPDATE SKIP LOCKED: só há um container engine hoje. Revisitar
  se isso escalar horizontalmente.
  """

  use GenServer
  import Ecto.Query

  @interval_ms 2_000

  def start_link(opts), do: GenServer.start_link(__MODULE__, opts, name: __MODULE__)

  @impl true
  def init(_opts) do
    schedule_tick()
    {:ok, %{}}
  end

  @impl true
  def handle_info(:tick, state) do
    run_once()
    schedule_tick()
    {:noreply, state}
  end

  defp schedule_tick, do: Process.send_after(self(), :tick, @interval_ms)

  @doc "Lógica de polling extraída pra ser chamada direto (síncrona) nos testes, sem depender do timer."
  def run_once do
    query =
      from e in Engine.Outbox.Event,
        where: e.aggregate_type == "session" and is_nil(e.processed_at),
        order_by: e.created_at,
        limit: 50

    Engine.Repo.transaction(fn ->
      query
      |> Engine.Repo.all()
      |> Enum.each(&enqueue_and_mark/1)
    end)
  end

  defp enqueue_and_mark(row) do
    {:ok, _job} =
      %{event_type: row.event_type, aggregate_id: row.aggregate_id, payload: row.payload}
      |> Engine.Workers.SessionLifecycleWorker.new()
      |> Oban.insert()

    Engine.Repo.update_all(
      from(e in Engine.Outbox.Event, where: e.id == ^row.id),
      set: [processed_at: DateTime.utc_now()]
    )
  end
end
