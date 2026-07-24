defmodule Engine.Harness.Tools.SearchWorkspace do
  @moduledoc "Busca por substring nos nomes e conteúdos dos arquivos do workspace."

  @behaviour Engine.Harness.Tool

  alias Engine.Harness.WorkspaceFiles

  @impl true
  def spec do
    %{
      name: "search_workspace",
      description: "Busca uma substring nos arquivos do workspace do projeto.",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "query" => %{"type" => "string", "description" => "texto a procurar"}
        },
        "required" => ["query"]
      }
    }
  end

  @impl true
  def category, do: :direct

  @impl true
  def run(%{"query" => query}, ctx) do
    hits = WorkspaceFiles.search(ctx.project_id, query)

    if hits == [] do
      {:ok, "nenhum resultado para \"#{query}\""}
    else
      body = Enum.map_join(hits, "\n", fn h -> "- #{h.path}" end)
      {:ok, "#{length(hits)} resultado(s):\n#{body}"}
    end
  end

  def run(_args, _ctx), do: {:error, "search_workspace exige o argumento `query`"}
end
