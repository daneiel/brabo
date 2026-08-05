defmodule Engine.Dev.WorktreeManager do
  @moduledoc """
  Gerencia git worktrees por dev agent (Fase 4a). Cada agente trabalha isolado
  num worktree próprio (`<workspace>/.worktrees/<agent_id>`) numa branch
  `feature/<task-slug>`, derivado do working tree local do projeto
  (`Engine.Actions.Workspace`). 1 worktree por agente (o dir por agent_id já
  garante), com limpeza de órfãos (worktree sem agente vivo).
  """

  alias Engine.Actions.GitCmd
  alias Engine.Actions.Workspace
  alias Engine.Projects.ProjectRepository

  @doc """
  Cria (ou recria) o worktree do agente numa branch nova `feature/<slug>`.
  Idempotente por agente: remove um worktree anterior do mesmo agente antes.
  Retorna `{:ok, %{path, branch}}` ou `{:error, reason}`.
  """
  def create(project_id, agent_id, task_slug) do
    with {:ok, bare, default_branch} <- ProjectRepository.get_local_repo_path(project_id),
         {:ok, work_dir} <- Workspace.ensure(project_id, bare, default_branch) do
      add_worktree(work_dir, agent_id, task_slug)
    end
  end

  @doc """
  Cria o worktree do agente num `work_dir` já pronto (git repo). Separado de
  `create/3` pra ser exercitável sem a resolução via banco. Idempotente por
  agente (remove um anterior antes).
  """
  def add_worktree(work_dir, agent_id, task_slug) do
    path = worktree_path(work_dir, agent_id)
    branch = "feature/#{task_slug}"
    _ = remove_worktree(work_dir, path)

    # `-B` e não `-b`: cria a branch OU redefine a existente.
    #
    # `remove_worktree/2` limpava o diretório e deixava a branch para trás. Como
    # o nome vem do slug da task, retentar a MESMA task caía sempre em
    # `fatal: a branch named 'feature/<slug>' already exists` — a task ficava
    # presa para sempre, e o circuit breaker desarmava sem que destravar
    # adiantasse. Numa execução real foi o que aconteceu depois do primeiro
    # bloqueio, e só saiu com cirurgia manual no git.
    #
    # Redefinir é o certo aqui: o worktree anterior já foi removido, o trabalho
    # daquela tentativa não vale (a task voltou para a fila) e a branch tem que
    # renascer do ponto atual do work_dir.
    case git(work_dir, ["worktree", "add", path, "-B", branch]) do
      {:ok, _} -> {:ok, %{path: path, branch: branch}}
      {:error, out} -> {:error, out}
    end
  end

  @doc "Remove o worktree do agente (best-effort) — opera no working tree do projeto."
  def remove(project_id, agent_id) do
    work_dir = Workspace.workspace_dir(project_id)
    if File.dir?(work_dir), do: remove_worktree(work_dir, worktree_path(work_dir, agent_id))
    :ok
  end

  @doc "Lista os agent_ids que têm worktree no projeto."
  def list(project_id) do
    dir = worktrees_dir(Workspace.workspace_dir(project_id))

    case File.ls(dir) do
      {:ok, entries} -> Enum.filter(entries, &File.dir?(Path.join(dir, &1)))
      _ -> []
    end
  end

  @doc """
  Poda worktrees órfãos: remove os cujo agent_id NÃO está em `live_agent_ids`.
  Chamado pelo job periódico (que calcula os vivos a partir do Registry).
  Retorna a lista de agent_ids removidos.
  """
  def cleanup_orphans(project_id, live_agent_ids) do
    live = MapSet.new(live_agent_ids)

    list(project_id)
    |> Enum.reject(&MapSet.member?(live, &1))
    |> Enum.map(fn agent_id ->
      remove(project_id, agent_id)
      agent_id
    end)
  end

  # --- helpers ---

  defp worktrees_dir(work_dir), do: Path.join(work_dir, ".worktrees")
  defp worktree_path(work_dir, agent_id), do: Path.join(worktrees_dir(work_dir), agent_id)

  defp remove_worktree(work_dir, path) do
    if File.dir?(path) do
      _ = git(work_dir, ["worktree", "remove", "--force", path])
      _ = git(work_dir, ["worktree", "prune"])
      File.rm_rf(path)
    end

    :ok
  end

  defp git(cd, args), do: GitCmd.run(cd, args)
end
