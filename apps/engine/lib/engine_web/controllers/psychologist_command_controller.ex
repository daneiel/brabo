defmodule EngineWeb.PsychologistCommandController do
  @moduledoc """
  Reprocessamento explícito da análise do Psicólogo (Fase 4b) — a api
  dispara, o engine enfileira o job com `triggeredBy: "manual"` (que
  sempre roda, independente de já haver análise current pra sessão; a
  anterior vira `superseded`, sem ser apagada). Guardado pelo plug
  VerifyServiceToken, igual aos demais command controllers.

  Sem outbox: é um gatilho direto e síncrono, mesmo padrão de
  `ExecutionCommandController`/`AgentCommandController`.

  Desligável globalmente (`PsychologistWorker.enabled?/0` — decisão do
  usuário em 2026-08-10, mesmo padrão da Anamnese, ver
  docs/explanation/backlog.md): 503 com um corpo JSON, sem sequer criar o
  job — de propósito, mesmo padrão do `AnamneseCommandController`.

  `status/2` (RN-454) existe para a aba Insights conseguir saber que a
  pausa é DECISÃO antes de o usuário clicar em "Reanalisar" — sem ela, o
  único jeito de descobrir era esbarrar no 503 acima, e uma tela sem
  hipótese nenhuma nunca chega perto do botão que dispara isso.
  """

  use EngineWeb, :controller

  def reanalyze(conn, %{"sessionId" => session_id, "projectId" => project_id}) do
    if Engine.Workers.PsychologistWorker.enabled?() do
      {:ok, _job} =
        %{
          event_type: "session.closed",
          aggregate_id: session_id,
          payload: %{"projectId" => project_id, "triggeredBy" => "manual"}
        }
        |> Engine.Workers.PsychologistWorker.new()
        |> Oban.insert()

      send_resp(conn, 202, "")
    else
      conn
      |> put_status(503)
      |> json(%{error: "psicologo_desativado"})
    end
  end

  def status(conn, _params) do
    json(conn, %{enabled: Engine.Workers.PsychologistWorker.enabled?()})
  end
end
