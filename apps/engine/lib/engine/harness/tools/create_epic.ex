defmodule Engine.Harness.Tools.CreateEpic do
  @moduledoc """
  Ferramenta do PO: cria um épico via a api (nunca SQL direto). `:direct` —
  não entra no `@registry` global (só o PoServer a advertise). Retorna o id no
  texto do resultado pro modelo encadear as stories.
  """

  @behaviour Engine.Harness.Tool

  alias Engine.Sessions.EngineApiClient

  @impl true
  def spec do
    %{
      name: "create_epic",
      description: "Cria um épico do backlog. Retorna o id para usar como epic_id nas histórias.",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "title" => %{"type" => "string"},
          "description" => %{"type" => "string"}
        },
        "required" => ["title"]
      }
    }
  end

  @impl true
  def category, do: :direct

  @impl true
  def run(%{"title" => title} = args, ctx) do
    fields = %{title: title, description: Map.get(args, "description", "")}

    case EngineApiClient.create_epic(ctx.project_id, ctx.session_id, fields) do
      {:ok, %{"id" => id}} ->
        {:ok, "épico criado: id=#{id} — use este id como epic_id nas histórias."}

      {:error, reason} ->
        {:error, "falha ao criar épico: #{inspect(reason)}"}
    end
  end

  def run(_args, _ctx), do: {:error, "create_epic exige `title`"}
end
