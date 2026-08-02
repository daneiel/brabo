defmodule Engine.Dev.Wake do
  @moduledoc """
  Entrega um wake a um dev agent específico (Fase 12b).

  Via `Phoenix.PubSub` (já supervisionado como `Engine.PubSub`, sem uso em
  `lib/` até aqui), não via `Engine.Dev.Registry` diretamente: o job do Oban
  que dispara o wake (`Engine.Workers.DevAgentWakeWorker`) pode rodar em
  QUALQUER réplica do engine (`prod/patches.yaml` roda 2), e o Registry é
  local ao nó — um `Registry.lookup` erraria a entrega em ~metade dos casos
  em produção. PubSub é cluster-wide de graça.

  Entrega é AT-MOST-ONCE: se o processo do agente estiver momentaneamente
  fora do ar quando o broadcast acontece, o wake se perde e o agente fica no
  estado atual até o PRÓXIMO evento (outro gate resolvendo, outra task
  ficando pegável). Fechar essa lacuna de vez exigiria registro `:global`
  pros dev agents (como `Engine.Sessions.SessionServer` já faz) — fora do
  escopo desta fase, registrado como follow-up no ADR 0045.
  """

  @doc "Tópico de UM agente — é pra ele, e só pra ele, que o wake é entregue."
  def topic(project_id, agent_id), do: "dev_agent:#{project_id}:#{agent_id}"

  def subscribe(project_id, agent_id) do
    Phoenix.PubSub.subscribe(Engine.PubSub, topic(project_id, agent_id))
  end

  def deliver(project_id, agent_id, msg) do
    Phoenix.PubSub.broadcast(Engine.PubSub, topic(project_id, agent_id), msg)
  end
end
