defmodule Engine.Harness.Tools.CreateTask do
  @moduledoc """
  Ferramenta do PO: cria uma tarefa sob uma história via a api. A tarefa herda
  o vínculo a regra da história. `:direct`, fora do `@registry` global.
  """

  @behaviour Engine.Harness.Tool

  alias Engine.Sessions.EngineApiClient

  @impl true
  def spec do
    %{
      name: "create_task",
      description: "Cria uma tarefa sob uma história (story_id).",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "story_id" => %{"type" => "string"},
          "title" => %{"type" => "string"},
          "description" => %{"type" => "string"}
        },
        "required" => ["story_id", "title"]
      }
    }
  end

  @impl true
  def category, do: :direct

  @impl true
  def run(%{"story_id" => story_id, "title" => title} = args, ctx) do
    fields = %{storyId: story_id, title: title, description: Map.get(args, "description", "")}

    case EngineApiClient.create_task(ctx.project_id, ctx.session_id, fields) do
      {:ok, %{"id" => id}} -> {:ok, "tarefa criada: id=#{id}."}
      {:error, reason} -> {:error, "falha ao criar tarefa: #{inspect(reason)}"}
    end
  end

  def run(_args, _ctx), do: {:error, "create_task exige `story_id` e `title`"}
end
