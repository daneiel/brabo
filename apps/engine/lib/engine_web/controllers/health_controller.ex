defmodule EngineWeb.HealthController do
  @moduledoc """
  Três probes com perguntas diferentes (Fase 5).

  `/health` é o original e continua idêntico — o `HEALTHCHECK` da imagem e o
  `docker/smoke.sh` batem nele.

  A separação existe porque `/health` toca o banco, e isso é a resposta certa
  para readiness e a ERRADA para liveness: sob um Postgres lento, um liveness
  ligado ao banco reinicia todas as réplicas ao mesmo tempo, tirando de pé
  justamente quem sobreviveria à indisponibilidade. Liveness responde só "este
  BEAM ainda processa requisição"; quem decide parar de receber tráfego é o
  readiness.
  """

  use EngineWeb, :controller

  alias Engine.Readiness

  @doc "Liveness: não toca o banco de propósito. Ver o moduledoc."
  def live(conn, _params) do
    json(conn, %{service: "engine", status: "ok", timestamp: now()})
  end

  @doc """
  Readiness: banco alcançável E reidratação concluída.

  A ordem importa: reidratação primeiro, porque enquanto ela não terminou o pod
  não pode receber heartbeat de sessão nenhuma (`Engine.Readiness`).
  """
  def ready(conn, _params) do
    if Readiness.ready?() do
      case db_check() do
        :ok -> json(conn, %{service: "engine", status: "ok", timestamp: now()})
        {:error, reason} -> unavailable(conn, %{reason: "database", message: inspect(reason)})
      end
    else
      unavailable(conn, %{
        reason: "rehydrating",
        pending: Enum.map(Readiness.pending(), &to_string/1)
      })
    end
  end

  def check(conn, _params) do
    case db_check() do
      :ok ->
        json(conn, %{
          service: "engine",
          status: "ok",
          timestamp: now()
        })

      {:error, reason} ->
        conn
        |> put_status(:service_unavailable)
        |> json(%{
          service: "engine",
          status: "error",
          timestamp: now(),
          details: %{message: inspect(reason)}
        })
    end
  end

  defp db_check do
    case Ecto.Adapters.SQL.query(Engine.Repo, "SELECT 1", []) do
      {:ok, _result} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  defp unavailable(conn, details) do
    conn
    |> put_status(:service_unavailable)
    |> json(%{service: "engine", status: "error", timestamp: now(), details: details})
  end

  defp now, do: DateTime.to_iso8601(DateTime.utc_now())
end
