defmodule EngineWeb.PsychologistCommandController do
  @moduledoc """
  Reprocessamento explícito da análise do Psicólogo (Fase 4b) — a api
  dispara, o engine enfileira o job com `triggeredBy: "manual"` (que
  sempre roda, independente de já haver análise current pra sessão; a
  anterior vira `superseded`, sem ser apagada). Guardado pelo plug
  VerifyApiToken, igual aos demais command controllers.

  Sem outbox: é um gatilho direto e síncrono, mesmo padrão de
  `ExecutionCommandController`/`AgentCommandController`.
  """

  use EngineWeb, :controller

  def reanalyze(conn, %{"sessionId" => session_id, "projectId" => project_id}) do
    {:ok, _job} =
      %{
        event_type: "session.closed",
        aggregate_id: session_id,
        payload: %{"projectId" => project_id, "triggeredBy" => "manual"}
      }
      |> Engine.Workers.PsychologistWorker.new()
      |> Oban.insert()

    send_resp(conn, 202, "")
  end
end
