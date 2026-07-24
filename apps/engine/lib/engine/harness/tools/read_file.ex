defmodule Engine.Harness.Tools.ReadFile do
  @moduledoc "Lê um arquivo dentro do workspace do projeto (traversal bloqueado)."

  @behaviour Engine.Harness.Tool

  alias Engine.Harness.WorkspaceFiles
  alias Engine.Actions.Workspace

  @impl true
  def spec do
    %{
      name: "read_file",
      description: "Lê o conteúdo de um arquivo do workspace do projeto.",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "path" => %{"type" => "string", "description" => "caminho relativo ao workspace"}
        },
        "required" => ["path"]
      }
    }
  end

  @impl true
  def category, do: :direct

  @impl true
  def run(%{"path" => path}, ctx) do
    case WorkspaceFiles.read_file(root(ctx), path) do
      {:ok, content} -> {:ok, content}
      {:error, :traversal} -> {:error, "caminho fora do workspace: #{path}"}
      {:error, reason} -> {:error, "falha ao ler #{path}: #{inspect(reason)}"}
    end
  end

  def run(_args, _ctx), do: {:error, "read_file exige o argumento `path`"}

  defp root(ctx), do: ctx[:workspace_root] || Workspace.workspace_dir(ctx.project_id)
end
