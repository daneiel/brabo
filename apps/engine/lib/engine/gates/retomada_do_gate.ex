defmodule Engine.Gates.RetomadaDoGate do
  @moduledoc """
  `ctx[:retomada]` dos subagentes de gate (AT-582, L4): o último `agent.plan`
  do subagente na sessão vira a mensagem `RetomadaDoTurno`. Subagente de gate
  não abre `agent.status: working`, então o `Diario` não tem escopo para ele;
  a leitura aqui é só o plano.

  shortcut: sem marca de "esta é uma retomada" — vale o plano mais novo que o
  teto de estacionamento (2 h); um ciclo novo logo depois de outro da mesma
  sessão pode herdar o plano velho. Trocar por marca do `GateRescuer` se isso
  aparecer em medição.
  """

  alias Engine.Harness.RetomadaDoTurno
  alias Engine.Sessions.EngineApiClient

  @spec texto(String.t() | nil, String.t() | nil, String.t()) :: String.t() | nil
  def texto(project_id, session_id, agente) when is_binary(session_id) do
    with {:ok, eventos} <-
           EngineApiClient.list_events(project_id, session_id, latest: true, limit: 200),
         %{} = plano <- ultimo_plano(eventos, agente) do
      RetomadaDoTurno.texto(%{plano: plano})
    else
      _ -> nil
    end
  end

  def texto(_, _, _), do: nil

  defp ultimo_plano(eventos, agente) do
    limite = Application.get_env(:engine, :gate_rescue_park_after_seconds, 7_200)

    eventos
    |> Enum.filter(&(&1["type"] == "agent.plan" and ator(&1) == agente and recente?(&1, limite)))
    |> Enum.max_by(&(&1["seq"] || 0), fn -> nil end)
    |> case do
      %{"payload" => %{} = p} -> p
      _ -> nil
    end
  end

  defp ator(e), do: get_in(e, ["actor", "id"]) || e["actorId"]

  defp recente?(%{"createdAt" => s}, limite) when is_binary(s) do
    case DateTime.from_iso8601(s) do
      {:ok, dt, _} -> DateTime.diff(DateTime.utc_now(), dt, :second) <= limite
      _ -> false
    end
  end

  defp recente?(_, _), do: false
end
