defmodule Engine.Harness.Tools.CompleteStory do
  @moduledoc """
  Ferramenta do PO (RN-720): COMPLETA uma história `draft` que já existe — liga
  `business_rule_ids` e preenche RF/DoD/DoR — em vez de recriá-la. A api soma
  as regras às já ligadas, troca as listas informadas e promove a história pelo
  MESMO critério de `create_story`. `:direct`.
  """

  @behaviour Engine.Harness.Tool

  alias Engine.Sessions.EngineApiClient

  @impl true
  def spec do
    %{
      name: "complete_story",
      description:
        "Completa uma história EXISTENTE (draft) sem recriá-la: liga regras de negócio " <>
          "(somadas às já ligadas) e preenche RF, RNF, DoD e DoR (lista informada substitui a " <>
          "atual; omitida fica). Completa, ela é promovida como em create_story.",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "story_id" => %{"type" => "string"},
          "description" => %{"type" => "string"},
          "rf" => %{"type" => "array", "items" => %{"type" => "string"}},
          "rnf" => %{"type" => "array", "items" => %{"type" => "string"}},
          "dod" => %{"type" => "array", "items" => %{"type" => "string"}},
          "dor" => %{"type" => "array", "items" => %{"type" => "string"}},
          "business_rule_ids" => %{"type" => "array", "items" => %{"type" => "string"}}
        },
        "required" => ["story_id"]
      }
    }
  end

  @impl true
  def category, do: :direct

  @impl true
  def run(%{"story_id" => story_id} = args, ctx) when is_binary(story_id) do
    fields =
      %{
        description: Map.get(args, "description"),
        rf: Map.get(args, "rf"),
        rnf: Map.get(args, "rnf"),
        dod: Map.get(args, "dod"),
        dor: Map.get(args, "dor"),
        businessRuleIds: Map.get(args, "business_rule_ids")
      }
      |> Enum.reject(fn {_k, v} -> is_nil(v) end)
      |> Map.new()

    case EngineApiClient.complete_story(ctx.project_id, ctx.session_id, story_id, fields) do
      {:ok, %{"id" => id} = story} ->
        {:ok, "história completada: id=#{id}, #{desfecho(story)}"}

      {:error, reason} ->
        {:error, "falha ao completar história: #{inspect(reason)}"}
    end
  end

  def run(_args, _ctx), do: {:error, "complete_story exige `story_id`"}

  defp desfecho(%{"proposedReady" => true}),
    do: "está COMPLETA e aguardando a promoção do usuário (o projeto exige aprovação manual)."

  defp desfecho(%{"status" => "ready"}), do: "status=ready."

  defp desfecho(%{"status" => status}),
    do: "status=#{status} — ainda faltam RF, DoD, DoR ou business_rule_ids."
end
