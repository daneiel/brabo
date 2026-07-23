defmodule EngineWeb.HealthController do
  use EngineWeb, :controller

  def check(conn, _params) do
    case Ecto.Adapters.SQL.query(Engine.Repo, "SELECT 1", []) do
      {:ok, _result} ->
        json(conn, %{
          service: "engine",
          status: "ok",
          timestamp: DateTime.to_iso8601(DateTime.utc_now())
        })

      {:error, reason} ->
        conn
        |> put_status(:service_unavailable)
        |> json(%{
          service: "engine",
          status: "error",
          timestamp: DateTime.to_iso8601(DateTime.utc_now()),
          details: %{message: inspect(reason)}
        })
    end
  end
end
