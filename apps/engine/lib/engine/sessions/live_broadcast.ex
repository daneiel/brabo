defmodule Engine.Sessions.LiveBroadcast do
  @moduledoc """
  Broadcast no canal Phoenix da sessão pra todo evento recém-persistido no
  event log (Fase 4a — painel do time ao vivo). Chamado ao lado de
  `EngineApiClient.append_event` nos GenServers de execução/gates
  (Dev/QA/SecOps/Infra), que hoje só ESCREVEM eventos (a web deriva status
  via polling) — sem outbox-relay novo, é o caminho mínimo pra "tudo pelos
  canais Phoenix". Os agentes conversacionais (Criativo/PO/Arquiteto) já
  broadcastam `agent.delta`/`agent.done` pelo seu próprio `broadcast/3`
  local; ganham `agent.status` nos limites de turno à parte.
  """

  def event_appended(session_id, type, actor_id, payload) do
    EngineWeb.Endpoint.broadcast("session:" <> session_id, "event.appended", %{
      type: type,
      actorId: actor_id,
      payload: payload
    })
  end
end
