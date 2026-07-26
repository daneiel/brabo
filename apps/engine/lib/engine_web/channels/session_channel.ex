defmodule EngineWeb.SessionChannel do
  @moduledoc """
  Canal de heartbeat por sessão — join só é permitido se a sessão já existe;
  "ping" reseta o timer de heartbeat do SessionServer correspondente (ver
  `Engine.Sessions.SessionServer`).

  A busca é em `:global`, não num Registry local: com mais de uma réplica, o
  Service balanceia o websocket para qualquer pod, e uma busca local recusaria
  o join sempre que o browser caísse num pod que não é o dono da sessão. Como o
  nome é global, tanto o join quanto o `ping` alcançam o dono em qualquer nó.
  """

  use EngineWeb, :channel

  alias Engine.Sessions.SessionServer

  @impl true
  def join("session:" <> session_id, _params, socket) do
    case SessionServer.whereis(session_id) do
      pid when is_pid(pid) -> {:ok, assign(socket, :session_id, session_id)}
      nil -> {:error, %{reason: "sessão não encontrada ou já encerrada"}}
    end
  end

  @impl true
  def handle_in("ping", _payload, socket) do
    :ok = SessionServer.heartbeat(socket.assigns.session_id)
    {:reply, :ok, socket}
  end
end
