defmodule EngineWeb.GateCommandController do
  @moduledoc """
  O gesto humano que retoma um ciclo de gate ESTACIONADO (ADR 0207, RN-724).

  A api chama com o service token depois de autorizar o usuário; aqui só se
  delega a `Engine.Gates.GateRescuer.retomar_estacionado/3`. Ciclo que não
  existe ou não está estacionado é 409 nomeado (`gate_nao_estacionado`) e
  nada é despachado.
  """

  use EngineWeb, :controller

  alias Engine.Gates.GateRescuer

  def resume(conn, %{"projectId" => project_id, "taskId" => task_id, "gate" => gate})
      when gate in ["qa", "secops"] do
    case GateRescuer.retomar_estacionado(project_id, task_id, gate) do
      :ok -> send_resp(conn, 202, "")
      {:error, :nao_estacionado} -> recusar(conn)
    end
  end

  def resume(conn, _params), do: recusar(conn)

  defp recusar(conn) do
    conn |> put_status(409) |> json(%{error: "gate_nao_estacionado"})
  end
end
