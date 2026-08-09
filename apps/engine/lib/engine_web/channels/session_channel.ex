defmodule EngineWeb.SessionChannel do
  @moduledoc """
  Canal de heartbeat por sessão — join só é permitido se a sessão já existe;
  "ping" reseta o timer de heartbeat do SessionServer correspondente (ver
  `Engine.Sessions.SessionServer`).

  A busca é em `:global`, não num Registry local: com mais de uma réplica, o
  Service balanceia o websocket para qualquer pod, e uma busca local recusaria
  o join sempre que o browser caísse num pod que não é o dono da sessão. Como o
  nome é global, tanto o join quanto o `ping` alcançam o dono em qualquer nó.

  RN-108: além de a sessão existir, o join agora CONSOME o ticket que
  `EngineWeb.SessionSocket.connect/3` validou (sem marcar consumido) — o
  `UPDATE` condicional de `Engine.Sessions.SocketTicket.consumir/2` exige que
  o `session_id` do tópico pedido bata com o da linha, e a checagem de
  `project_id` aqui é a segunda barreira: sem ela, um ticket emitido pro
  projeto A que por acaso batesse o `session_id` de uma sessão do projeto B
  (não deveria acontecer, mas a checagem não custa e é o que o ticket original
  deste trabalho pediu) abriria canal fora do projeto para o qual foi emitido.
  """

  use EngineWeb, :channel

  alias Engine.Sessions.{SessionServer, SocketTicket}

  @impl true
  def join("session:" <> session_id, _params, socket) do
    case SessionServer.whereis(session_id) do
      nil ->
        {:error, %{reason: "sessão não encontrada ou já encerrada"}}

      pid when is_pid(pid) ->
        autorizar_e_consumir(session_id, socket)
    end
  end

  @impl true
  def handle_in("ping", _payload, socket) do
    :ok = SessionServer.heartbeat(socket.assigns.session_id)
    {:reply, :ok, socket}
  end

  defp autorizar_e_consumir(session_id, socket) do
    project_id_da_sessao = SessionServer.project_id(session_id)

    if project_id_da_sessao != socket.assigns.project_id do
      {:error, %{reason: "unauthorized"}}
    else
      case SocketTicket.consumir(socket.assigns.ticket, session_id) do
        {:ok, _linha} -> {:ok, assign(socket, :session_id, session_id)}
        {:error, :invalid} -> {:error, %{reason: "unauthorized"}}
      end
    end
  end
end
