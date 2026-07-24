defmodule Engine.Workers.PsychologistWorker do
  @moduledoc """
  Ao ver session.closed/session.closed_abnormally, lê o event log da
  sessão (Postgres direto, read-only) e grava um evento
  psychologist.hypothesis placeholder via HTTP na api (contrato de seq
  atômico exige AppendSessionEventUseCase do lado de lá — ver
  Engine.Sessions.EngineApiClient.append_event/3).

  Sem chave de idempotência pro retry do Oban — uma retentativa rara
  duplicaria o evento; aceitável por ora, é um placeholder explícito.
  """

  use Oban.Worker, queue: :default, max_attempts: 5

  @impl true
  def perform(%Oban.Job{
        args: %{
          "aggregate_id" => session_id,
          "payload" => %{"projectId" => project_id}
        }
      }) do
    events = Engine.SessionEvents.Event.list(session_id)
    payload = Engine.Psychologist.Stub.summarize(events)

    # Chaves em camelCase de propósito — o DTO da api
    # (AppendSessionEventInternalDto) espera actorKind/actorId, não o
    # snake_case idiomático do Elixir.
    client().append_event(project_id, session_id, %{
      type: "psychologist.hypothesis",
      actorKind: "agent",
      actorId: "psychologist-stub",
      payload: payload
    })
  end

  defp client do
    Application.get_env(:engine, :engine_api_client, Engine.Sessions.EngineApiClient.Live)
  end
end
