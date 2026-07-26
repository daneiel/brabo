defmodule Engine.Psychologist.Triage do
  @moduledoc """
  Triagem de custo da análise do Psicólogo (Fase 4b): sessões triviais
  (menos de `threshold/0` eventos) recebem análise LEVE por modelo barato;
  as demais, análise PESADA por modelo forte.

  **Racional do limiar (default X = 20)**: abaixo disso a sessão
  tipicamente é alguém abrindo e trocando duas mensagens ou abandonando um
  handoff — não há sinal comportamental suficiente pra justificar o custo
  de um modelo forte. A passada leve ainda entrega alguma hipótese (ou
  conclui corretamente que faltam dados), mantendo o critério de aceite
  "toda sessão encerrada gera hipóteses" sem queimar orçamento à toa.

  O tier escolhido vira (a) o `agent` do ctx do ToolLoop — `"psicologo"`
  vs `"psicologo-leve"`, cada um com seu próprio model binding
  agent-scoped, o que faz o custo divergir de verdade no metering — e
  (b) tetos distintos de `max_iterations`/`token_budget_micros`.

  Limiar e tetos vêm de `config :engine` (ver `config/runtime.exs`) com os
  valores do ADR 0015 como default: controle de custo é knob de operador,
  não constante de código.
  """

  @type tier :: :leve | :pesada

  @doc "Limiar de eventos abaixo do qual a análise é leve."
  def threshold, do: Application.get_env(:engine, :psychologist_triage_threshold, 20)

  @spec decide(non_neg_integer()) :: tier()
  def decide(event_count) when is_integer(event_count) do
    if event_count < threshold(), do: :leve, else: :pesada
  end

  @doc "Slug do agente (e portanto o model binding) usado por cada tier."
  @spec agent_for(tier()) :: String.t()
  def agent_for(:leve), do: "psicologo-leve"
  def agent_for(:pesada), do: "psicologo"

  @doc """
  Teto de iterações do ToolLoop por tier — é ISSO que materializa o
  "até M tentativas" da CLAUDE.md (uma rejeição de evidência inválida
  volta pro modelo como tool-result e consome uma iteração). O tier leve
  tem menos tentativas de propósito: faz parte do controle de custo.
  """
  @spec max_iterations(tier()) :: pos_integer()
  def max_iterations(:leve),
    do: Application.get_env(:engine, :psychologist_max_iterations_leve, 4)

  def max_iterations(:pesada),
    do: Application.get_env(:engine, :psychologist_max_iterations_pesada, 8)

  @doc """
  Orçamento de tokens por análise, em micro-USD (mesmo padrão de
  DEFAULT_TASK_BUDGET_MICROS do dev). Enforced pelo mecanismo que já
  existe no ToolLoop (`{:budget_exceeded, ctx}`) — sem código novo.
  """
  @spec token_budget_micros(tier()) :: pos_integer()
  def token_budget_micros(:leve),
    do: Application.get_env(:engine, :psychologist_budget_micros_leve, 50_000)

  def token_budget_micros(:pesada),
    do: Application.get_env(:engine, :psychologist_budget_micros_pesada, 300_000)

  @doc """
  Quantos eventos entram no prompt, no máximo.

  O log vai numa mensagem `:pinned`, e o `ContextManager` NUNCA compacta
  pinned (de propósito: o modelo só pode citar ids que ele vê, e um resumo
  não preserva ids). Então o corte tem que acontecer ANTES: sem teto, uma
  sessão longa estourava a janela e a análise morria em erro de provider.
  O tier leve mora abaixo do limiar de triagem, então o teto dele é só
  folga; o teto que age de verdade é o da pesada.
  """
  @spec max_prompt_events(tier()) :: pos_integer()
  def max_prompt_events(:leve),
    do: Application.get_env(:engine, :psychologist_max_prompt_events_leve, 50)

  def max_prompt_events(:pesada),
    do: Application.get_env(:engine, :psychologist_max_prompt_events_pesada, 400)

  @doc """
  Teto de caracteres do payload de UM evento no prompt. Payload de
  `agent.response`/`tool.result` carrega turno de LLM inteiro; sem corte,
  meia dúzia deles come a janela sozinha.
  """
  @spec max_payload_chars() :: pos_integer()
  def max_payload_chars,
    do: Application.get_env(:engine, :psychologist_max_payload_chars, 600)
end
