defmodule Engine.Psychologist.Triage do
  @moduledoc """
  Triagem de custo da análise do Psicólogo (Fase 4b): sessões triviais
  (menos de #{20} eventos) recebem análise LEVE por modelo barato;
  as demais, análise PESADA por modelo forte.

  **Racional do limiar (X = 20)**: abaixo disso a sessão tipicamente é
  alguém abrindo e trocando duas mensagens ou abandonando um handoff —
  não há sinal comportamental suficiente pra justificar o custo de um
  modelo forte. A passada leve ainda entrega alguma hipótese (ou conclui
  corretamente que faltam dados), mantendo o critério de aceite "toda
  sessão encerrada gera hipóteses" sem queimar orçamento à toa.

  O tier escolhido vira (a) o `agent` do ctx do ToolLoop — `"psicologo"`
  vs `"psicologo-leve"`, cada um com seu próprio model binding
  agent-scoped, o que faz o custo divergir de verdade no metering — e
  (b) tetos distintos de `max_iterations`/`token_budget_micros`.
  """

  @threshold 20

  @type tier :: :leve | :pesada

  @doc "Limiar de eventos abaixo do qual a análise é leve."
  def threshold, do: @threshold

  @spec decide(non_neg_integer()) :: tier()
  def decide(event_count) when is_integer(event_count) and event_count < @threshold,
    do: :leve

  def decide(_event_count), do: :pesada

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
  def max_iterations(:leve), do: 4
  def max_iterations(:pesada), do: 8

  @doc """
  Orçamento de tokens por análise, em micro-USD (mesmo padrão de
  DEFAULT_TASK_BUDGET_MICROS do dev). Enforced pelo mecanismo que já
  existe no ToolLoop (`{:budget_exceeded, ctx}`) — sem código novo.
  """
  @spec token_budget_micros(tier()) :: pos_integer()
  def token_budget_micros(:leve), do: 50_000
  def token_budget_micros(:pesada), do: 300_000
end
