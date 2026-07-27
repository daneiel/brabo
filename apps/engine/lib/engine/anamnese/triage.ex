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

  Todos os valores vêm de `config :engine` (ver `config/runtime.exs`) com os
  defaults originais: controle de custo é knob de operador, não constante de
  código — mesma racional já escrita pro Psicólogo em `runtime.exs`.
  """

  @agent "anamnese"

  def agent, do: @agent

  @doc """
  Volume mínimo de material pra justificar uma rodada: abaixo disso a janela
  não tem sinal suficiente e a rodada é PULADA sem gastar nada (a menos que
  haja hipótese aceita na fila, que sempre força).
  """
  def min_events, do: Application.get_env(:engine, :anamnese_min_events, 10)

  def max_iterations,
    do: Application.get_env(:engine, :anamnese_max_iterations, 6)

  def token_budget_micros,
    do: Application.get_env(:engine, :anamnese_budget_micros, 200_000)

  @doc """
  Quantos eventos da janela entram no prompt, no máximo.

  A janela vai numa mensagem `:pinned`, e o `ContextManager` nunca compacta
  pinned (de propósito: o modelo só pode citar event ids que ele vê). Então o
  corte tem que acontecer ANTES — sem ele, uma janela cheia estourava a
  janela de contexto e a rodada morria em erro de provider.
  """
  def max_prompt_events,
    do: Application.get_env(:engine, :anamnese_max_prompt_events, 500)

  @doc """
  Teto de caracteres do payload de UM evento no prompt. `agent.response` e
  `tool.result` carregam turno de LLM inteiro; sem corte, meia dúzia deles
  come a janela sozinha.
  """
  def max_payload_chars,
    do: Application.get_env(:engine, :anamnese_max_payload_chars, 600)

  @doc "Janela da primeira rodada de um projeto (sem rodada anterior)."
  def initial_window_days,
    do: Application.get_env(:engine, :anamnese_initial_window_days, 30)

  @doc """
  Decide se a rodada vale a pena. Hipótese aceita na fila SEMPRE força
  (é input priorizado do usuário — ignorá-la quebraria o loop fechado);
  senão, exige um mínimo de material novo na janela.

  `decision_count` conta junto: uma janela em que o usuário só aprovou e
  negou ações (sem trocar mensagem) É material — era descartada como vazia
  antes de as decisões entrarem no contexto.
  """
  @spec should_run?(non_neg_integer(), non_neg_integer(), non_neg_integer()) :: boolean()
  def should_run?(event_count, queued_count, decision_count \\ 0)
      when is_integer(event_count) and is_integer(queued_count) and
             is_integer(decision_count) do
    queued_count > 0 or event_count + decision_count >= min_events()
  end
end
