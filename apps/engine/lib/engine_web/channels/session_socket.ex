defmodule EngineWeb.SessionSocket do
  @moduledoc """
  Socket de heartbeat de sessão.

  RN-108: `connect/3` exige `params["ticket"]` — um ticket opaco de uso único
  emitido por `POST /projects/:projectId/sessions/:sessionId/socket-ticket`
  do lado api, TTL de 30s. Sem ticket, ou com um inexistente/expirado/já
  consumido, a conexão inteira é recusada — não só o join do canal, que já
  tinha barreira própria (session_id precisar existir no Registry, mantida
  intacta). O ticket NÃO é o JWT reaproveitado: ver
  `Engine.Sessions.SocketTicket` para o porquê.

  Isto fecha o gap que este moduledoc documentava até aqui como "LIMITAÇÃO
  DELIBERADA": antes desta mudança, qualquer um que descobrisse um
  `session_id` (UUID) entrava no canal e recebia os broadcasts ao vivo da
  sessão.

  `project_id`/`user_id`/`scope` do ticket vão pra `socket.assigns` — o
  CONSUMO atômico (que exige o `session_id` do tópico pedido bater com o da
  linha) acontece no join do canal, não aqui: ver
  `EngineWeb.SessionChannel.join/3` e o moduledoc de `SocketTicket` para o
  motivo de a validação ser em duas etapas.
  """

  use Phoenix.Socket

  alias Engine.Sessions.SocketTicket

  channel "session:*", EngineWeb.SessionChannel

  @impl true
  def connect(%{"ticket" => ticket}, socket, _connect_info)
      when is_binary(ticket) and ticket != "" do
    case SocketTicket.validar(ticket) do
      {:ok, %{project_id: project_id, user_id: user_id, scope: scope}} ->
        socket =
          socket
          |> assign(:ticket, ticket)
          |> assign(:project_id, project_id)
          |> assign(:user_id, user_id)
          |> assign(:scope, scope)

        {:ok, socket}

      {:error, :invalid} ->
        {:error, %{reason: "unauthorized"}}
    end
  end

  def connect(_params, _socket, _connect_info), do: {:error, %{reason: "unauthorized"}}

  @impl true
  def id(_socket), do: nil
end
