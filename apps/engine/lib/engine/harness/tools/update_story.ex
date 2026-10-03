defmodule Engine.Harness.Tools.UpdateStory do
  @moduledoc """
  Ferramenta do PO (RN-727): CORRIGE o título e/ou a descrição de uma história
  `draft` sem tarefa em execução — a mesma régua da aba Backlog
  (`CorrigirHistoriaUseCase` na api). RF/DoD/DoR e regras continuam sendo da
  `complete_story` (RN-720). A recusa da api (409 nomeado) volta ao modelo como
  erro de ferramenta, com o motivo. `:direct`.
  """

  @behaviour Engine.Harness.Tool

  alias Engine.Harness.Tools.RecusaDeHistoria
  alias Engine.Sessions.EngineApiClient

  @impl true
  def spec do
    %{
      name: "update_story",
      description:
        "Corrige o TÍTULO e/ou a DESCRIÇÃO de uma história existente (só draft e sem tarefa " <>
          "em execução). Use para consertar um título errado em vez de recriar a história. " <>
          "Campo omitido fica como está.",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "story_id" => %{"type" => "string"},
          "title" => %{"type" => "string"},
          "description" => %{"type" => "string"}
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
      %{title: Map.get(args, "title"), description: Map.get(args, "description")}
      |> Enum.reject(fn {_k, v} -> is_nil(v) end)
      |> Map.new()

    if fields == %{} do
      {:error, "update_story exige `title` ou `description`"}
    else
      case EngineApiClient.update_story(ctx.project_id, ctx.session_id, story_id, fields) do
        {:ok, %{"id" => id} = story} ->
          {:ok, "história corrigida: id=#{id}, título=\"#{Map.get(story, "title")}\"."}

        {:error, reason} ->
          {:error, "falha ao corrigir história: #{RecusaDeHistoria.texto(reason)}"}
      end
    end
  end

  def run(_args, _ctx), do: {:error, "update_story exige `story_id`"}
end
