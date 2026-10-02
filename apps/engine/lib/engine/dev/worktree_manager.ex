defmodule Engine.Dev.WorktreeManager do
  @moduledoc """
  Gerencia git worktrees por dev agent (Fase 4a). Cada agente trabalha isolado
  num worktree próprio (`<workspace>/.worktrees/<agent_id>`) numa branch
  `feature/<task-slug>`, derivado do working tree local do projeto
  (`Engine.Actions.Workspace`). 1 worktree por agente (o dir por agent_id já
  garante), com limpeza de órfãos (worktree sem agente vivo).

  Desde a RN-507 (ADR 0145), as QUATRO operações públicas (`add_worktree/3`
  vira `create/3`, `remove/2`, `list/1`, `cleanup_orphans/2`) bifurcam por
  `execution_mode`: LOCAL (`GitCmd`, tudo abaixo) para `container`/`mounted`
  — comportamento de sempre —, via `Engine.Actions.Workspace.RunnerGit` para
  `runner`, pelo MESMO canal Phoenix que já executa terminal aprovado. As
  aridades `_at`/`add_worktree/3` PURAMENTE locais continuam existindo,
  inalteradas — são o que a suíte já exercita direto contra um bare repo de
  verdade, e o que `runner?/1` usa para decidir pra qual das duas rotear.
  """

  alias Engine.Actions.GitCmd
  alias Engine.Actions.Workspace
  alias Engine.Actions.Workspace.RunnerGit
  alias Engine.Projects.{Project, ProjectRepository}

  @doc """
  Cria (ou recria) o worktree do agente numa branch nova `feature/<slug>`.
  Idempotente por agente: remove um worktree anterior do mesmo agente antes.
  Retorna `{:ok, %{path, branch}}` ou `{:error, reason}`.

  A branch nasce da de TRABALHO (`dev`, RN-664) — a mesma que a PR do agente
  mira e que o gate usa no diff. A base é EXPLÍCITA, e não o HEAD do working
  tree, por causa dos workspaces inicializados antes da RN-664: eles estão
  parados na `default_branch` (a marca de pronto impede re-inicializar), e
  nascer do HEAD deles faria o agente trabalhar sobre `main` com a PR indo
  para `dev`.
  """
  def create(project_id, agent_id, task_slug) do
    criar(project_id, agent_id, task_slug, ProjectRepository.branch_de_trabalho())
  end

  @doc """
  Readota a branch JÁ existente `feature/<slug>` de uma task (RN-715): o merge
  da PR dela foi recusado por conflito com a `dev`, e o dono volta a trabalhar
  NELA, com os commits que a PR já tem. É o `create/3` com a própria branch
  como ponto de partida — a mesma `garantir_base` (local ou `origin/`), e o
  `-B` redefine a branch para ela mesma, sem perder nada.
  """
  def adopt(project_id, agent_id, task_slug) do
    criar(project_id, agent_id, task_slug, "feature/#{task_slug}")
  end

  defp criar(project_id, agent_id, task_slug, base) do
    with {:ok, remoto} <- ProjectRepository.remoto_de_trabalho(project_id),
         {:ok, work_dir} <- Workspace.ensure_remoto(project_id, remoto) do
      if runner?(project_id) do
        RunnerGit.add_worktree(project_id, work_dir, agent_id, task_slug, base)
      else
        add_worktree(work_dir, agent_id, task_slug, base)
      end
    end
  end

  defp runner?(project_id) do
    match?(%{execution_mode: "runner"}, Project.get(project_id))
  rescue
    _ -> false
  catch
    :exit, _ -> false
  end

  @doc """
  Cria o worktree do agente num `work_dir` já pronto (git repo). Separado de
  `create/3` pra ser exercitável sem a resolução via banco. Idempotente por
  agente (remove um anterior antes).
  """
  def add_worktree(work_dir, agent_id, task_slug) do
    criar_worktree(work_dir, agent_id, task_slug, [])
  end

  @doc """
  Como `add_worktree/3`, mas a branch nasce de `base` (RN-664) e não do HEAD
  do `work_dir`. A `base` local é garantida antes: workspace de antes da
  RN-664 tem só `origin/<base>` (buscada no `fetch` da inicialização), e ganha
  a local a partir dela — sem `fetch` novo, a mesma política de "sem
  auto-pull" do workspace.

  Sem `base` local nem `origin/<base>`, recusa NOMEADA
  (`ProjectRepository.mensagem_sem_branch_de_trabalho/1`), nunca o HEAD de
  plano B. A única exceção é o repositório sem commit nenhum com o HEAD já
  apontando para `base` (o bare vazio que `Engine.Actions.Workspace` inicializa
  com a branch local vazia): ali a base É o HEAD, e o caminho é o de sempre.
  """
  def add_worktree(work_dir, agent_id, task_slug, base) do
    case garantir_base(work_dir, base) do
      {:ok, ponto_de_partida} -> criar_worktree(work_dir, agent_id, task_slug, ponto_de_partida)
      {:error, _} = erro -> erro
    end
  end

  defp garantir_base(work_dir, base) do
    cond do
      ref?(work_dir, "refs/heads/#{base}") ->
        {:ok, [base]}

      ref?(work_dir, "refs/remotes/origin/#{base}") ->
        case git(work_dir, ["branch", base, "origin/#{base}"]) do
          {:ok, _} -> {:ok, [base]}
          {:error, _} = erro -> erro
        end

      head_vazio_em?(work_dir, base) ->
        {:ok, []}

      true ->
        {:error,
         ProjectRepository.mensagem_sem_branch_de_trabalho(
           "nem #{base} nem origin/#{base} no working tree"
         )}
    end
  end

  defp ref?(work_dir, ref),
    do: match?({:ok, _}, git(work_dir, ["rev-parse", "--verify", "--quiet", ref]))

  # HEAD aponta para `base` e ainda não tem commit (branch "unborn").
  defp head_vazio_em?(work_dir, base) do
    case git(work_dir, ["symbolic-ref", "HEAD"]) do
      {:ok, out} -> String.trim(out) == "refs/heads/#{base}" and not ref?(work_dir, "HEAD")
      {:error, _} -> false
    end
  end

  defp criar_worktree(work_dir, agent_id, task_slug, ponto_de_partida) do
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
    case git(work_dir, ["worktree", "add", path, "-B", branch] ++ ponto_de_partida) do
      {:ok, _} -> {:ok, %{path: path, branch: branch}}
      {:error, out} -> {:error, out}
    end
  end

  @doc "Remove o worktree do agente (best-effort) — opera no working tree do projeto."
  def remove(project_id, agent_id) do
    work_dir = Workspace.workspace_dir(project_id)

    if runner?(project_id) do
      RunnerGit.remove_worktree(project_id, work_dir, agent_id)
    else
      remove_at(work_dir, agent_id)
    end
  end

  @doc "Mesmo que `remove/2`, com o `work_dir` já resolvido — sem consulta ao banco."
  def remove_at(work_dir, agent_id) do
    if File.dir?(work_dir), do: remove_worktree(work_dir, worktree_path(work_dir, agent_id))
    :ok
  end

  @doc "Lista os agent_ids que têm worktree no projeto."
  def list(project_id) do
    work_dir = Workspace.workspace_dir(project_id)

    if runner?(project_id) do
      RunnerGit.list_worktrees(project_id, work_dir)
    else
      list_at(work_dir)
    end
  end

  @doc "Mesmo que `list/1`, com o `work_dir` já resolvido — sem consulta ao banco."
  def list_at(work_dir) do
    dir = worktrees_dir(work_dir)

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
    work_dir = Workspace.workspace_dir(project_id)

    if runner?(project_id) do
      RunnerGit.cleanup_orphans(project_id, work_dir, live_agent_ids)
    else
      cleanup_orphans_at(work_dir, live_agent_ids)
    end
  end

  @doc """
  Mesmo que `cleanup_orphans/2`, com o `work_dir` já resolvido — sem consulta
  ao banco. Usado por `Engine.Dev.WorktreeCleanup`, que já resolveu o
  `work_dir` de TODOS os projetos numa consulta só (RN-109) e chamar
  `cleanup_orphans/2` de novo aqui dentro re-consultaria por projeto.
  """
  def cleanup_orphans_at(work_dir, live_agent_ids) do
    live = MapSet.new(live_agent_ids)

    list_at(work_dir)
    |> Enum.reject(&MapSet.member?(live, &1))
    |> Enum.map(fn agent_id ->
      remove_at(work_dir, agent_id)
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
