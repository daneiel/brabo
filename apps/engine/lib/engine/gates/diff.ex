defmodule Engine.Gates.Diff do
  @moduledoc """
  `git diff` entre a branch default do projeto e o HEAD do worktree
  (Fase 4a — QA/SecOps olham o que o DevAgent mudou). Não existia nenhum
  cálculo de diff no engine antes disso.
  """

  alias Engine.Actions.GitCmd
  alias Engine.Projects.ProjectRepository

  @doc """
  `{:ok, diff_text}` — diff unificado de `<default_branch>...HEAD` rodado
  dentro de `worktree_path`. `{:error, reason}` se o projeto não tiver
  repositório local resolvível ou o comando falhar.
  """
  def compute(project_id, worktree_path) do
    case ProjectRepository.get_local_repo_path(project_id) do
      {:ok, _bare_repo_path, default_branch} ->
        GitCmd.run(worktree_path, ["diff", "#{default_branch}...HEAD"])

      {:error, reason} ->
        {:error, reason}
    end
  end

  @doc """
  Paths dos arquivos tocados num diff unificado (`diff --git a/X b/X`) — usado
  só pra contexto/resumo do parecer do SecOps (quantos arquivos mudaram),
  sem correlação linha-a-linha com achados de scanner.
  """
  def changed_paths(diff_text) do
    ~r/^diff --git a\/(.+) b\/(.+)$/m
    |> Regex.scan(diff_text, capture: :all_but_first)
    |> Enum.map(fn [_a, b] -> b end)
    |> Enum.uniq()
  end
end
