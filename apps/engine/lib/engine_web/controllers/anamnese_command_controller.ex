defmodule EngineWeb.AnamneseCommandController do
  @moduledoc """
  Rodada da Anamnese SOB DEMANDA (Fase 4b) — a api dispara, o engine
  enfileira a rodada daquele projeto na hora.

  Sem isto, a única forma de uma rodada acontecer era o tick de 15 minutos
  do `AnamneseSchedulerWorker`: o critério de aceite ("aceito uma hipótese e
  vejo o patch seguinte referenciá-la") ficava impraticável de exercitar, e o
  Psicólogo já tinha o equivalente (`psychologist/reanalyze`).

  A sessão onde a rodada narra é a MESMA que o scheduler escolheria (a mais
  recente do projeto): projeto sem sessão não tem log pra analisar, e a
  rodada é um no-op silencioso — igual ao caminho periódico.

  Guardado pelo plug VerifyApiToken, como os demais command controllers.
  """

  use EngineWeb, :controller

  def run(conn, %{"projectId" => project_id}) do
    case Engine.Sessions.ProjectSession.latest_id(project_id) do
      nil ->
        send_resp(conn, 409, "")

      session_id ->
        {:ok, _job} =
          %{project_id: project_id, session_id: session_id}
          |> Engine.Workers.AnamneseWorker.new()
          |> Oban.insert()

        send_resp(conn, 202, "")
    end
  end
end
