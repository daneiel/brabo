defmodule Engine.Gates.Diff do
  @moduledoc """
  `git diff` entre a branch de TRABALHO do projeto e o HEAD do worktree
  (Fase 4a — QA/SecOps olham o que o DevAgent mudou). Não existia nenhum
  cálculo de diff no engine antes disso.

  Desde a RN-664 (AT-250) o lado esquerdo é `dev`
  (`ProjectRepository.branch_de_trabalho/1`), não mais a `default_branch` do
  provider: é para `dev` que a PR do dev agent vai, e o worktree nasce de
  `dev`. Julgar contra `main` seria julgar um diff que não é o da PR.

  Desde a RN-787 (AT-464) o lado esquerdo é a `dev` MAIS NOVA que o working
  tree enxerga: a `dev` local do clone não anda quando a PR é mergeada no
  repositório de origem, e o `dev...HEAD` contra ela contava o acumulado das
  tarefas já mergeadas (17 arquivos numa PR de 3). Com origem LOCAL (caminho no
  disco, sem credencial) o gate faz antes um `git fetch origin dev`, melhor
  esforço; entre `origin/dev` e `dev`, vale a que contém a outra. Com origem
  remota não há fetch aqui (a credencial é do `Workspace`) — declarado.
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
        GitCmd.run(worktree_path, ["diff", "#{base_mais_nova(worktree_path, base)}...HEAD"])

      {:error, reason} ->
        {:error, reason}
    end
  end

  @doc false
  def base_mais_nova(worktree_path, base) do
    atualizar_origem_local(worktree_path, base)
    remota = "origin/#{base}"

    cond do
      not ref?(worktree_path, "refs/remotes/#{remota}") -> base
      not ref?(worktree_path, "refs/heads/#{base}") -> remota
      ancestral?(worktree_path, remota, base) -> base
      true -> remota
    end
  end

  # Só origem que é caminho no disco: o fetch não precisa de credencial nem de
  # rede. Falhar não muda nada — o diff segue com o que há.
  defp atualizar_origem_local(worktree_path, base) do
    with {:ok, url} <- GitCmd.run(worktree_path, ["remote", "get-url", "origin"]),
         true <- String.starts_with?(String.trim(url), "/") do
      _ = GitCmd.run(worktree_path, ["fetch", "-q", "origin", base])
    end

    :ok
  end

  defp ref?(dir, ref),
    do: match?({:ok, _}, GitCmd.run(dir, ["rev-parse", "--verify", "--quiet", ref]))

  defp ancestral?(dir, a, b),
    do: match?({:ok, _}, GitCmd.run(dir, ["merge-base", "--is-ancestor", a, b]))

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
