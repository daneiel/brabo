defmodule Engine.Harness.Tools.EmitArtifact do
  @moduledoc """
  Emite um artefato TIPADO no event log — um `session_event`
  `"artifact.<tipo>"` com payload validado por `ArtifactSchemas` (não há
  tabela de artefatos; validação por tipo é feita aqui). Grava via
  `EngineApiClient.append_event/3` (o engine nunca escreve session_events
  direto).
  """

  @behaviour Engine.Harness.Tool

  alias Engine.Harness.ArtifactSchemas
  alias Engine.Sessions.EngineApiClient

  @impl true
  def spec do
    %{
      name: "emit_artifact",
      description:
        "Emite um artefato tipado no event log. Tipos: #{Enum.join(ArtifactSchemas.known(), ", ")}.",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "type" => %{"type" => "string"},
          "payload" => %{"type" => "object"}
        },
        "required" => ["type", "payload"]
      }
    }
  end

  @impl true
  def category, do: :direct

  @impl true
  def run(%{"type" => type, "payload" => payload}, ctx) when is_map(payload) do
    cond do
      # Guardrail: tipos system-emitted (ex.: product_brief) NUNCA saem por
      # tool call do modelo — só pelo servidor do agente no momento certo.
      type not in ArtifactSchemas.known() ->
        {:error, "artefato #{type} não pode ser emitido por ferramenta (system-emitted)"}

      true ->
        emit(type, payload, ctx)
    end
  end

  def run(_args, _ctx), do: {:error, "emit_artifact exige `type` e `payload` (objeto)"}

  defp emit(type, payload, ctx) do
    case ArtifactSchemas.validate(type, payload) do
      :ok ->
        event = %{
          type: "artifact.#{type}",
          actorKind: "agent",
          actorId: ctx.agent,
          payload: payload
        }

        case EngineApiClient.append_event(ctx.project_id, ctx.session_id, event) do
          :ok -> {:ok, "artefato #{type} emitido"}
          {:error, reason} -> {:error, "falha ao emitir artefato: #{inspect(reason)}"}
        end

      {:error, reason} ->
        {:error, "artefato inválido: #{inspect(reason)}"}
    end
  end
end
