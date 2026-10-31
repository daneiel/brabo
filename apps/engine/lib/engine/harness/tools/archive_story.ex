defmodule Engine.Harness.Tools.ArchiveStory do
  @moduledoc """
  Ferramenta do PO (RN-727): ARQUIVA uma história `draft` sem tarefa em
  execução — a duplicada, a criada por engano. Ela e as tarefas dela saem do
  backlog (e de `listar_backlog`), da cobertura, do plano do Dev Lead e do
  claim; nada é apagado (a api grava `backlog.story_archived`). A recusa da api
  (409 nomeado) volta ao modelo como erro de ferramenta. `:direct`.
  """

  @behaviour Engine.Harness.Tool

  alias Engine.Harness.Tools.RecusaDeHistoria
  alias Engine.Sessions.EngineApiClient

  @impl true
  def spec do
    %{
      name: "archive_story",
      description:
        "Arquiva uma história existente (só draft e sem tarefa em execução) — use para " <>
          "tirar do backlog uma história DUPLICADA ou criada por engano. Ela e as tarefas " <>
          "dela saem do backlog, da cobertura e do plano; nada é apagado. Diga o motivo.",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "story_id" => %{"type" => "string"},
          "reason" => %{"type" => "string"}
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
      case Map.get(args, "reason") do
        r when is_binary(r) and r != "" -> %{reason: r}
        _ -> %{}
      end

    case EngineApiClient.archive_story(ctx.project_id, ctx.session_id, story_id, fields) do
      {:ok, %{"id" => id} = story} ->
        {:ok,
         "história arquivada: id=#{id} (\"#{Map.get(story, "title")}\"). Ela e as tarefas " <>
           "dela saíram do backlog, da cobertura e do plano."}

      {:error, reason} ->
        {:error, "falha ao arquivar história: #{RecusaDeHistoria.texto(reason)}"}
    end
  end

  def run(_args, _ctx), do: {:error, "archive_story exige `story_id`"}
end
