defmodule Engine.Harness.Tools.EmitInsight do
  @moduledoc """
  Ferramenta do Arquiteto: emite um artefato `insight` quando identifica tensão
  entre regras de negócio e arquitetura (ex.: RNF sem módulo que o atenda).
  `session_event` `artifact.insight`. `:direct`.
  """

  @behaviour Engine.Harness.Tool

  alias Engine.Sessions.EngineApiClient

  @impl true
  def spec do
    %{
      name: "emit_insight",
      description:
        "Registra um insight de arquitetura: uma tensão entre as regras de negócio e a " <>
          "arquitetura proposta (ex.: um RNF sem módulo que o atenda).",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "title" => %{"type" => "string"},
          "description" => %{"type" => "string"}
        },
        "required" => ["title", "description"]
      }
    }
  end

  @impl true
  def category, do: :direct

  @impl true
  def run(%{"title" => title, "description" => description}, ctx) do
    event = %{
      type: "artifact.insight",
      actorKind: "agent",
      actorId: ctx.agent,
      payload: %{title: title, description: description}
    }

    case EngineApiClient.append_event(ctx.project_id, ctx.session_id, event) do
      :ok -> {:ok, "insight registrado: #{title}"}
      {:error, reason} -> {:error, "falha ao registrar insight: #{inspect(reason)}"}
    end
  end

  def run(_args, _ctx), do: {:error, "emit_insight exige `title` e `description`"}
end
