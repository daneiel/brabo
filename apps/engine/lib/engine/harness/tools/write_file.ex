defmodule Engine.Harness.Tools.WriteFile do
  @moduledoc """
  Escreve um arquivo no workspace. Dentro da whitelist do agente
  (`WriteFilePolicy`) escreve DIRETO — é isso que `run/2` faz. Fora da
  whitelist, o hook `:pre_tool_use` (ActionPipeline) intercepta ANTES e cria
  um `proposed_action` (aprovação humana), então `run/2` nem é chamado.
  """

  @behaviour Engine.Harness.Tool

  alias Engine.Harness.WorkspaceFiles
  alias Engine.Actions.Workspace

  @impl true
  def spec do
    %{
      name: "write_file",
      description:
        "Escreve conteúdo num arquivo do workspace. Fora da whitelist do agente, vira uma ação proposta pra aprovação.",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "path" => %{"type" => "string"},
          "content" => %{"type" => "string"}
        },
        "required" => ["path", "content"]
      }
    }
  end

  @impl true
  def category, do: :direct

  @impl true
  def run(%{"path" => path, "content" => content}, ctx) do
    case WorkspaceFiles.write_file(root(ctx), path, content) do
      {:ok, _abs} -> {:ok, "escrito: #{path}"}
      {:error, :traversal} -> {:error, "caminho fora do workspace: #{path}"}
      {:error, reason} -> {:error, "falha ao escrever #{path}: #{inspect(reason)}"}
    end
  end

  def run(_args, _ctx), do: {:error, "write_file exige `path` e `content`"}

  defp root(ctx), do: ctx[:workspace_root] || Workspace.workspace_dir(ctx.project_id)
end
