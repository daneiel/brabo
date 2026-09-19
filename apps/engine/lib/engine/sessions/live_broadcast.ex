defmodule Engine.Sessions.LiveBroadcast do
  @moduledoc """
  Broadcast no canal Phoenix da sessão pra todo evento recém-persistido no
  event log (Fase 4a — painel do time ao vivo). Desde a AT-093 (RN-579) quem
  chama `event_appended/3` é a fachada `EngineApiClient`, depois de a api
  CONFIRMAR a escrita — `append_event`, `append_event_returning` e as quatro
  escritas que a api registra como evento (`propose_action`,
  `create_handoff`, `create_epic/story/task`). Antes eram chamadas à mão ao
  lado de alguns appends, e o resto escrevia calado; a web só descobria pelo
  poll de 3s. Sem outbox-relay novo: as escritas que a api faz por conta
  própria (a decisão de um humano noutra aba, por exemplo) seguem sem aviso,
  e é para elas que o poll de fallback da web existe. Os agentes
  conversacionais (Criativo/PO/Arquiteto) já
  broadcastam `agent.delta`/`agent.done` pelo seu próprio `broadcast/3`
  local; ganham `agent.status` nos limites de turno à parte.
  """

  alias Engine.Sessions.EngineApiClient

  # AT-093 (RN-579): chamado SÓ pela fachada `EngineApiClient`, depois de a api
  # confirmar a escrita — antes eram três chamadores à mão (`ArtifactEmitter`
  # e o Infra Lead) e o resto das escritas não avisava ninguém. Sem `payload`:
  # a web usa o aviso só como gatilho de refetch (o conteúdo vem do GET), e
  # o cru de um `tool.result` não tem por que atravessar o socket.
  def event_appended(session_id, type, actor_id) do
    EngineWeb.Endpoint.broadcast("session:" <> session_id, "event.appended", %{
      type: type,
      actorId: actor_id || ""
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
      when status in ["working", "idle", "awaiting_approval"] do
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
