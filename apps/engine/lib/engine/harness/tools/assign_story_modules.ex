defmodule Engine.Harness.Tools.AssignStoryModules do
  @moduledoc """
  Ferramenta do Arquiteto: vincula módulos (do module_map vigente) a uma
  história — é assim que uma story passa a "referenciar módulos válidos". A api
  recusa módulos inexistentes. `:direct`.
  """

  @behaviour Engine.Harness.Tool

  alias Engine.Sessions.EngineApiClient

  @impl true
  def spec do
    %{
      name: "assign_story_modules",
      description:
        "Vincula os módulos (nomes do module_map) que uma história realiza. " <>
          "Necessário pra a história passar na validação cruzada de arquitetura.",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "story_id" => %{"type" => "string"},
          "module_ids" => %{"type" => "array", "items" => %{"type" => "string"}}
        },
        "required" => ["story_id", "module_ids"]
      }
    }
  end

  @impl true
  def category, do: :direct

  @impl true
  def run(%{"story_id" => story_id, "module_ids" => module_ids}, ctx)
      when is_list(module_ids) do
    fields = %{storyId: story_id, moduleIds: module_ids}

    case EngineApiClient.assign_story_modules(ctx.project_id, ctx.session_id, fields) do
      {:ok, _story} -> {:ok, "módulos vinculados à história #{story_id}."}
      {:error, reason} -> {:error, "falha ao vincular módulos: #{inspect(reason)}"}
    end
  end

  def run(_args, _ctx), do: {:error, "assign_story_modules exige `story_id` e `module_ids`"}
end
