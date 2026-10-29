defmodule Engine.Gates.RetomadaDoGate do
  @moduledoc """
  `ctx[:retomada]` dos subagentes de gate (AT-582): só existe quando o
  `GateRescuer` gravou o marco `agent.turn_resumed` do subagente (`marcar/3`);
  o texto sai do `Engine.Agents.Diario` escopado por esse marco (plano, efeitos
  e chamadas sem desfecho). Ciclo novo, sem marco, não herda nada.
  """

  alias Engine.Agents.Diario
  alias Engine.Harness.RetomadaDoTurno
  alias Engine.Sessions.EngineApiClient

  @subagentes %{
    "qa" => ["qa-estrategia", "qa-performance-seguranca"],
    "secops" => ["appsec"]
  }

  @spec texto(String.t() | nil, String.t() | nil, String.t()) :: String.t() | nil
  def texto(project_id, session_id, agente) when is_binary(session_id) do
    with {:ok, eventos} <-
           EngineApiClient.list_events(project_id, session_id, latest: true, limit: 200),
         diario = Diario.de_eventos(eventos, agente, marco: :turn_resumed),
         true <- Diario.retomada_pendente?(diario, DateTime.utc_now()) do
      RetomadaDoTurno.texto(diario)
    else
      _ -> nil
    end
  end

  def texto(_, _, _), do: nil

  @doc "Grava `agent.turn_resumed` de cada subagente do `gate` ao retomar o ciclo."
  @spec marcar(String.t(), String.t() | nil, String.t()) :: :ok
  def marcar(project_id, session_id, gate) when is_binary(session_id) do
    for agente <- Map.get(@subagentes, gate, []) do
      EngineApiClient.append_event(project_id, session_id, %{
        type: Diario.tipo_retomada(),
        actorKind: "agent",
        actorId: agente,
        payload: %{gate: gate, automatica: true}
      })
    end

    :ok
  end

  def marcar(_, _, _), do: :ok
end
