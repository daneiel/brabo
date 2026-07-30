defmodule EngineWeb.AgentCommandController do
  @moduledoc """
  Comandos síncronos da api pros agentes conversacionais (Fase 3b): iniciar o
  Criativo, rotear uma mensagem do usuário, e sinalizar a confirmação de
  prontidão. Guardado pelo plug VerifyServiceToken (segredo compartilhado), igual ao
  SessionCommandController.
  """

  use EngineWeb, :controller

  alias Engine.Agents.{
    CriativoSupervisor,
    CriativoServer,
    PoSupervisor,
    PoServer,
    ArquitetoSupervisor,
    ArquitetoServer
  }

  alias Engine.Infra.{InfraLeadSupervisor, InfraLeadServer}

  def start(conn, %{"sessionId" => session_id, "projectId" => project_id, "agent" => "criativo"}) do
    {:ok, _pid} = CriativoSupervisor.start_agent(session_id, project_id)
    send_resp(conn, 201, "")
  end

  def start(conn, %{"sessionId" => session_id, "projectId" => project_id, "agent" => "po"}) do
    # Ativado pelo handoff aceito; num start FRESCO dispara o kickoff (gera o
    # backlog a partir do brief) — restart/reativação não regeram.
    {:ok, _pid, origin} = PoSupervisor.start_agent(session_id, project_id)
    if origin == :started, do: PoServer.kickoff(session_id)
    send_resp(conn, 201, "")
  end

  def start(conn, %{"sessionId" => session_id, "projectId" => project_id, "agent" => "arquiteto"}) do
    {:ok, _pid, origin} = ArquitetoSupervisor.start_agent(session_id, project_id)
    if origin == :started, do: ArquitetoServer.kickoff(session_id)
    send_resp(conn, 201, "")
  end

  def start(conn, %{"sessionId" => session_id, "projectId" => project_id, "agent" => "infra"}) do
    # Ativado pelo handoff aceito do Arquiteto — kickoff só num start FRESCO.
    {:ok, _pid, origin} = InfraLeadSupervisor.start_agent(session_id, project_id)
    if origin == :started, do: InfraLeadServer.kickoff(session_id)
    send_resp(conn, 201, "")
  end

  def start(conn, %{"agent" => agent}) do
    conn
    |> put_status(422)
    |> json(%{error: "agente não suportado como conversacional: #{agent}"})
  end

  def message(conn, %{"sessionId" => session_id, "agent" => "po", "text" => text}) do
    :ok = PoServer.user_message(session_id, text)
    send_resp(conn, 202, "")
  end

  def message(conn, %{"sessionId" => session_id, "agent" => "arquiteto", "text" => text}) do
    :ok = ArquitetoServer.user_message(session_id, text)
    send_resp(conn, 202, "")
  end

  def message(conn, %{"sessionId" => session_id, "text" => text}) do
    :ok = CriativoServer.user_message(session_id, text)
    send_resp(conn, 202, "")
  end

  def readiness(conn, %{"sessionId" => session_id}) do
    :ok = CriativoServer.confirm_readiness(session_id)
    send_resp(conn, 202, "")
  end

  def offer_infra_handoff(conn, %{"sessionId" => session_id}) do
    :ok = ArquitetoServer.offer_infra_handoff(session_id)
    send_resp(conn, 202, "")
  end
end
