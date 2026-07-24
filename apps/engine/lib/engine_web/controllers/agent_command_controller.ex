defmodule EngineWeb.AgentCommandController do
  @moduledoc """
  Comandos síncronos da api pros agentes conversacionais (Fase 3b): iniciar o
  Criativo, rotear uma mensagem do usuário, e sinalizar a confirmação de
  prontidão. Guardado pelo plug VerifyApiToken (client api-service), igual ao
  SessionCommandController.
  """

  use EngineWeb, :controller

  alias Engine.Agents.{CriativoSupervisor, CriativoServer}

  def start(conn, %{"sessionId" => session_id, "projectId" => project_id, "agent" => "criativo"}) do
    {:ok, _pid} = CriativoSupervisor.start_agent(session_id, project_id)
    send_resp(conn, 201, "")
  end

  def start(conn, %{"agent" => agent}) do
    # Só o Criativo é conversacional nesta fase; os demais agentes (PO,
    # Arquiteto…) chegam em sessões posteriores da 3b.
    conn
    |> put_status(422)
    |> json(%{error: "agente não suportado como conversacional: #{agent}"})
  end

  def message(conn, %{"sessionId" => session_id, "text" => text}) do
    :ok = CriativoServer.user_message(session_id, text)
    send_resp(conn, 202, "")
  end

  def readiness(conn, %{"sessionId" => session_id}) do
    :ok = CriativoServer.confirm_readiness(session_id)
    send_resp(conn, 202, "")
  end
end
