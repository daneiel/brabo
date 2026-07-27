defmodule Engine.Anamnese.ContextBuilder do
  @moduledoc """
  Monta o contexto de uma rodada da Anamnese (Fase 4b): o contexto da api
  (catálogo permitido, membros elegíveis, fila de hipóteses aceitas,
  perfis atuais, instruções vigentes) mais a JANELA de eventos lida
  direto do Postgres — mesma divisão do Psicólogo (mais barato que
  trafegar o log por HTTP).

  A janela vai do fim da última rodada até agora; sem rodada anterior,
  usa uma janela inicial fixa pra não varrer o projeto inteiro na
  primeira execução.
  """

  alias Engine.Anamnese.Triage
  alias Engine.Sessions.EngineApiClient

  @type t :: %{
          competency_catalog: [String.t()],
          members: [map()],
          queued_hypotheses: [map()],
          current_profiles: [map()],
          instructions: [map()],
          decisions: [map()],
          window_from: DateTime.t(),
          window_to: DateTime.t(),
          events: [map()],
          total_event_count: non_neg_integer()
        }

  @spec fetch(String.t()) :: {:ok, t()} | {:error, term()}
  def fetch(project_id) do
    case EngineApiClient.get_anamnese_context(project_id) do
      {:ok, ctx} -> {:ok, build(project_id, ctx)}
      {:error, reason} -> {:error, reason}
    end
  end

  defp build(project_id, ctx) do
    window_to = DateTime.utc_now()
    window_from = parse_window_from(Map.get(ctx, "windowFrom"), window_to)

    total =
      Engine.SessionEvents.Event.count_for_project_window(project_id, window_from, window_to)

    events = list_events(project_id, window_from, window_to)

    %{
      competency_catalog: Map.get(ctx, "competencyCatalog", []),
      members: Map.get(ctx, "members", []),
      queued_hypotheses: Map.get(ctx, "queuedHypotheses", []),
      current_profiles: Map.get(ctx, "currentProfiles", []),
      instructions: Map.get(ctx, "instructions", []),
      # Aprovações/negações do usuário na janela — o quarto sinal do
      # enunciado, que não existe no event log (mora em proposed_actions).
      decisions: Map.get(ctx, "decisions", []),
      window_from: window_from,
      window_to: window_to,
      events: events,
      total_event_count: total
    }
  end

  defp parse_window_from(nil, window_to),
    do: DateTime.add(window_to, -Triage.initial_window_days() * 24 * 3600, :second)

  defp parse_window_from(iso, window_to) when is_binary(iso) do
    case DateTime.from_iso8601(iso) do
      {:ok, dt, _offset} -> dt
      _ -> parse_window_from(nil, window_to)
    end
  end

  # O teto vem do Triage: a janela vai numa mensagem pinned, que o
  # ContextManager não pode compactar, então quem protege o contexto é o corte.
  defp list_events(project_id, window_from, window_to) do
    project_id
    |> Engine.SessionEvents.Event.list_for_project_window(
      window_from,
      window_to,
      Triage.max_prompt_events()
    )
    |> Enum.map(fn event ->
      %{
        id: event.id,
        seq: event.seq,
        type: event.type,
        actor_kind: event.actor_kind,
        actor_id: event.actor_id,
        payload: event.payload,
        created_at: event.created_at
      }
    end)
  end
end
