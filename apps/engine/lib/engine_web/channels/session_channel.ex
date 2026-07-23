defmodule EngineWeb.SessionChannel do
  @moduledoc """
  Canal de heartbeat por sessão — join só é permitido se a sessão já
  existe (registrada no Registry); "ping" reseta o timer de heartbeat
  do SessionServer correspondente (ver Engine.Sessions.SessionServer).
  """

  use EngineWeb, :channel

  alias Engine.Sessions.SessionServer

  @impl true
  def join("session:" <> session_id, _params, socket) do
    case Registry.lookup(Engine.Sessions.Registry, session_id) do
      [{_pid, _}] -> {:ok, assign(socket, :session_id, session_id)}
      [] -> {:error, %{reason: "sessão não encontrada ou já encerrada"}}
    end
  end

  @impl true
  def handle_in("ping", _payload, socket) do
    :ok = SessionServer.heartbeat(socket.assigns.session_id)
    {:reply, :ok, socket}
  end
end
