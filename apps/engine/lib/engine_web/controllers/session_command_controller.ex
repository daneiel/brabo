defmodule EngineWeb.SessionCommandController do
  @moduledoc """
  Recebe o comando síncrono da api pra criar um processo de sessão
  supervisionado — substitui o antigo consumo de session.created via
  outbox (ver Engine.Sessions.SessionSupervisor.start_session/2).
  """

  use EngineWeb, :controller

  def create(conn, %{"sessionId" => session_id, "projectId" => project_id}) do
    {:ok, _pid} = Engine.Sessions.SessionSupervisor.start_session(session_id, project_id)
    send_resp(conn, 201, "")
  end
end
