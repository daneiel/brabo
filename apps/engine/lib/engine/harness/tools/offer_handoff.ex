defmodule Engine.Harness.Tools.OfferHandoff do
  @moduledoc """
  Ferramenta pra um agente OFERECER um handoff ao próximo (Fase 3b). Usada pelo
  PO pra passar o bastão ao Arquiteto quando o backlog está pronto. Cria um
  handoff `offered` na api (o usuário aceita depois, ativando o agente destino).
  `:direct`.
  """

  @behaviour Engine.Harness.Tool

  alias Engine.Sessions.EngineApiClient

  @impl true
  def spec do
    %{
      name: "offer_handoff",
      description:
        "Oferece um handoff ao próximo agente (ex.: to_agent=\"arquiteto\"). O usuário aceita " <>
          "o handoff pra ativar o agente destino.",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "to_agent" => %{"type" => "string"},
          "artifact_id" => %{"type" => "string"}
        },
        "required" => ["to_agent"]
      }
    }
  end

  @impl true
  def category, do: :direct

  @impl true
  def run(%{"to_agent" => to_agent} = args, ctx) do
    artifact_id = Map.get(args, "artifact_id")

    case EngineApiClient.create_handoff(
           ctx.project_id,
           ctx.session_id,
           ctx.agent,
           to_agent,
           artifact_id
         ) do
      {:ok, _handoff} ->
        {:ok, "handoff oferecido a #{to_agent} — aguardando o usuário aceitar."}

      {:error, reason} ->
        {:error, "falha ao oferecer handoff: #{inspect(reason)}"}
    end
  end

  def run(_args, _ctx), do: {:error, "offer_handoff exige `to_agent`"}
end
