defmodule Engine.Anamnese.Triage do
  @moduledoc """
  Tetos de custo da rodada da Anamnese (Fase 4b) — mesma forma da
  `Engine.Psychologist.Triage`, mas com um tier só: diferente do
  Psicólogo (que roda por sessão encerrada, com volume muito variável),
  a Anamnese roda periodicamente sobre uma janela limitada, então o custo
  já é previsível por construção.

  Os dois tetos são enforçados pelo mecanismo que JÁ existe no
  `ToolLoop` (`{:limit_reached, ctx}` / `{:budget_exceeded, ctx}`) — sem
  código de enforcement novo.
  """

  @agent "anamnese"

  # Volume mínimo de material pra justificar uma rodada: abaixo disso a
  # janela não tem sinal suficiente e a rodada é PULADA sem gastar nada
  # (a menos que haja hipótese aceita na fila, que sempre força a rodada).
  @min_events 10

  @max_iterations 6
  @token_budget_micros 200_000

  def agent, do: @agent
  def min_events, do: @min_events
  def max_iterations, do: @max_iterations
  def token_budget_micros, do: @token_budget_micros

  @doc """
  Decide se a rodada vale a pena. Hipótese aceita na fila SEMPRE força
  (é input priorizado do usuário — ignorá-la quebraria o loop fechado);
  senão, exige um mínimo de eventos novos na janela.
  """
  @spec should_run?(non_neg_integer(), non_neg_integer()) :: boolean()
  def should_run?(event_count, queued_count)
      when is_integer(event_count) and is_integer(queued_count) do
    queued_count > 0 or event_count >= @min_events
  end
end
