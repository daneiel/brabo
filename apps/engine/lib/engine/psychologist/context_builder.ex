defmodule Engine.Psychologist.ContextBuilder do
  @moduledoc """
  Monta o contexto da análise do Psicólogo (Fase 4b): o contexto da api
  (`get_psychologist_context` — idempotência, status/motivo de término,
  regras de negócio do projeto, hipóteses anteriores não descartadas)
  mais o log COMPLETO de eventos da sessão, lido direto do Postgres
  (`Engine.SessionEvents.Event.list/1`, read-only) — mais barato que uma
  ida HTTP e é o que o worker stub já fazia.
  """

  alias Engine.Sessions.EngineApiClient

  @type t :: %{
          already_analyzed: boolean(),
          session_status: String.t(),
          termination_reason: String.t() | nil,
          business_rules: [map()],
          prior_hypotheses: [map()],
          events: [map()]
        }

  @spec fetch(String.t(), String.t()) :: {:ok, t()} | {:error, term()}
  def fetch(project_id, session_id) do
    case EngineApiClient.get_psychologist_context(project_id, session_id) do
      {:ok, ctx} -> {:ok, build(ctx, session_id)}
      {:error, reason} -> {:error, reason}
    end
  end

  defp build(ctx, session_id) do
    %{
      already_analyzed: Map.get(ctx, "alreadyAnalyzed", false),
      session_status: Map.get(ctx, "sessionStatus", "closed"),
      termination_reason: Map.get(ctx, "terminationReason"),
      business_rules: Map.get(ctx, "businessRules", []),
      prior_hypotheses: Map.get(ctx, "priorHypotheses", []),
      events: list_events(session_id)
    }
  end

  defp list_events(session_id) do
    session_id
    |> Engine.SessionEvents.Event.list()
    |> Enum.map(fn event ->
      %{
        id: event.id,
        seq: event.seq,
        type: event.type,
        actor_id: event.actor_id,
        payload: event.payload
      }
    end)
  end
end
