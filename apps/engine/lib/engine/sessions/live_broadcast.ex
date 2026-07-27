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

  alias Engine.Sessions.EngineApiClient

  def event_appended(session_id, type, actor_id, payload) do
    EngineWeb.Endpoint.broadcast("session:" <> session_id, "event.appended", %{
      type: type,
      actorId: actor_id,
      payload: payload
    })
  end

  @doc """
  Status de um agente nos limites de turno: broadcasta E PERSISTE.

  A persistência é o ponto (ADR 0021). O `agent.status` existia só como
  broadcast, e o painel deriva o roster do event log buscado por HTTP
  (`deriveAgentRoster` lê `type == "agent.status"` da lista de eventos) — ou
  seja, Criativo, PO, Arquiteto e Infra apareciam PERMANENTEMENTE como
  "ocioso", inclusive no meio de um turno. Pior: o handler `onAgentStatus` da
  web invalidava uma query que, por construção, nunca conteria o dado que o
  push acabara de carregar.

  Broadcast primeiro: ele é o caminho "ao vivo" e não deve esperar o round-trip
  HTTP do append. Falha no append não derruba o turno do agente — o status é
  narrativa, não decisão.
  """
  def agent_status(project_id, session_id, agent_id, status)
      when status in ["working", "idle"] do
    payload = %{status: status}

    EngineWeb.Endpoint.broadcast("session:" <> session_id, "agent.status", payload)

    _ =
      EngineApiClient.append_event(project_id, session_id, %{
        type: "agent.status",
        actorKind: "agent",
        actorId: agent_id,
        payload: payload
      })

    :ok
  end
end
