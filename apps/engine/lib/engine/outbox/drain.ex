defmodule Engine.Outbox.Drain do
  @moduledoc """
  Drena outbox_events (aggregate_type = "session", processed_at IS NULL)
  com FOR UPDATE SKIP LOCKED — permite múltiplos consumidores concorrentes
  sem processar a mesma linha duas vezes. Pra cada linha, roteia pros
  handlers apropriados (ver handlers_for/1) e marca processed_at, tudo na
  mesma transação.
  """

  import Ecto.Query

  alias Engine.Repo
  alias Engine.Outbox.Event

  def run_once do
    Repo.transaction(fn ->
      query =
        from e in Event,
          where: e.aggregate_type == "session" and is_nil(e.processed_at),
          order_by: e.created_at,
          limit: 50,
          lock: "FOR UPDATE SKIP LOCKED"

      query |> Repo.all() |> Enum.each(&enqueue_and_mark/1)
    end)
  end

  defp enqueue_and_mark(row) do
    for worker <- handlers_for(row.event_type) do
      {:ok, _job} =
        %{
          event_type: row.event_type,
          aggregate_id: row.aggregate_id,
          payload: row.payload,
          # Propaga o `traceparent` que a api gravou no metadado do evento
          # (Fase 5). Sem isto o trabalho assíncrono disparado por um evento
          # nasceria numa trace própria, e a sessão apareceria no Tempo
          # partida em pedaços sem relação entre si — que é exatamente o que
          # "uma sessão = uma trace" existe para evitar.
          traceparent: traceparent(row)
        }
        |> worker.new()
        |> Oban.insert()
    end

    Repo.update_all(
      from(e in Event, where: e.id == ^row.id),
      set: [processed_at: DateTime.utc_now()]
    )
  end

  # `metadata` pode vir vazio: eventos gravados antes da Fase 5, ou por um
  # caminho que rodou fora de um contexto de trace ativo.
  defp traceparent(%{metadata: %{"traceparent" => tp}}) when is_binary(tp), do: tp
  defp traceparent(_), do: nil

  # Ponto de roteamento explícito — extensível pra futuros handlers.
  defp handlers_for(event_type)
       when event_type in ["session.closed", "session.closed_abnormally"],
       do: [Engine.Workers.SessionLifecycleWorker, Engine.Workers.PsychologistWorker]

  defp handlers_for(_), do: [Engine.Workers.SessionLifecycleWorker]
end
