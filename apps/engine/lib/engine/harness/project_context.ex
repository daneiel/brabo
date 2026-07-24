defmodule Engine.Harness.ProjectContext do
  @moduledoc """
  Monta o blob de "contexto do projeto" do prompt a partir do que o engine já
  lê do banco (nome/slug do projeto + provider/branch do repositório). Sem
  segredo, sem estado da tarefa (isso é outra camada). Degrada com graça
  quando o projeto ou o repositório ainda não existem.
  """

  alias Engine.Projects.Project
  alias Engine.Projects.ProjectRepository

  @doc """
  Texto de contexto do projeto (pode ser `""` se nada for encontrado — a
  camada `:contexto_projeto` lida com blob vazio sem problema).
  """
  def build(project_id) do
    [project_line(project_id), repo_line(project_id)]
    |> Enum.reject(&(&1 == nil))
    |> Enum.join("\n")
  end

  defp project_line(project_id) do
    case Project.get(project_id) do
      %{name: name, slug: slug} -> "Projeto: #{name} (#{slug})"
      nil -> nil
    end
  end

  defp repo_line(project_id) do
    case ProjectRepository.get_local_repo_path(project_id) do
      {:ok, _path, branch} -> "Repositório local · branch #{branch}"
      _ -> nil
    end
  end
end
