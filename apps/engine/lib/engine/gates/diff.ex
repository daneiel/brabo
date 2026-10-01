defmodule Engine.Gates.Diff do
  @moduledoc """
  `git diff` entre a branch de TRABALHO do projeto e o HEAD do worktree
  (Fase 4a — QA/SecOps olham o que o DevAgent mudou). Não existia nenhum
  cálculo de diff no engine antes disso.

  Desde a RN-664 (AT-250) o lado esquerdo é `dev`
  (`ProjectRepository.branch_de_trabalho/1`), não mais a `default_branch` do
  provider: é para `dev` que a PR do dev agent vai, e o worktree nasce de
  `dev`. Julgar contra `main` seria julgar um diff que não é o da PR.
  """

  alias Engine.Actions.GitCmd
  alias Engine.Projects.ProjectRepository

  @doc """
  `{:ok, diff_text}` — diff unificado de `dev...HEAD` rodado
  dentro de `worktree_path`. `{:error, reason}` se o projeto não tiver
  repositório local resolvível ou o comando falhar.
  """
  def compute(project_id, worktree_path) do
    # Só o NOME da branch, nunca `get_local_repo_path/1`: pedir o caminho do
    # bare repo fazia este gate parar em provider remoto sem nunca ter
    # precisado do caminho (ADR 0056). Sem a branch `dev` no repositório, o
    # `git diff` falha NOMEANDO a revisão — nunca cai para a default (RN-664).
    case ProjectRepository.branch_de_trabalho(project_id) do
      {:ok, base} ->
        GitCmd.run(worktree_path, ["diff", "#{base}...HEAD"])

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
