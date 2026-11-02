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

  alias Engine.Actions.GitAuth
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

  @doc """
  Como `create/3`, mas a branch nasce de `base` (RN-743): a branch de uma task
  BLOQUEADA do mesmo agente, onde `preservar/4` deixou o trabalho em commit.
  """
  def create_from(project_id, agent_id, task_slug, base) do
    criar(project_id, agent_id, task_slug, base)
  end

  @doc """
  RN-743 (AT-429). Commita o que o agente deixou no worktree antes de a task
  ser bloqueada, na branch da própria task e com a identidade
  `<agente>[bot]`. Sem isso o próximo `create/3` removia o worktree com
  `--force` e o trabalho não commitado sumia. Devolve `{:ok, sha}`, `:nada`
  (worktree limpo) ou `{:error, motivo}`. No modo `runner` o worktree mora na
  máquina do usuário e o engine não roda git ali: `:nada`, declarado.
  """
  def preservar(project_id, path, agent_id, task_id) do
    if runner?(project_id), do: :nada, else: preservar_em(path, agent_id, task_id)
  end

  @doc false
  def preservar_em(path, agent_id, task_id) do
    identidade = "#{agent_id}[bot]"

    with true <- is_binary(path) and File.dir?(path),
         {:ok, status} <- git(path, ["status", "--porcelain"]),
         false <- String.trim(status) == "",
         {:ok, _} <- git(path, Engine.Actions.DiretoriosDeDependencia.argumentos_do_add()),
         {:ok, _} <-
           git(path, [
             "-c",
             "user.name=#{identidade}",
             "-c",
             "user.email=#{agent_id}@bot.brabo.local",
             "commit",
             "--no-verify",
             "-m",
             "wip(#{agent_id}): trabalho preservado ao bloquear a task #{task_id}"
           ]),
         {:ok, sha} <- git(path, ["rev-parse", "HEAD"]) do
      {:ok, String.trim(sha)}
    else
      true -> :nada
      false -> :nada
      {:error, _} = erro -> erro
    end
  end

  @teto_do_retrato 80

  @doc """
  RN-744 (AT-444). O retrato CONTIDO do worktree que o kickoff do dev entrega:
  a branch e os arquivos que já existem (rastreados + não rastreados não
  ignorados), com teto de #{@teto_do_retrato} linhas e o total real quando
  corta (ADR 0060). Sem parâmetro do modelo: quem chama é o servidor. Pasta
  que o engine não alcança (modo `runner`) devolve o texto que diz isso.
  """
  def retrato(path, branch) do
    with true <- is_binary(path) and File.dir?(path),
         {:ok, out} <-
           git(path, ["ls-files", "--cached", "--others", "--exclude-standard"]) do
      arquivos = out |> String.split("\n", trim: true) |> Enum.uniq()
      total = length(arquivos)

      corpo =
        case total do
          0 -> "(nenhum arquivo ainda — o worktree está vazio)"
          _ -> arquivos |> Enum.take(@teto_do_retrato) |> Enum.join("\n")
        end

      corte =
        if total > @teto_do_retrato,
          do: "\n(… mostrando #{@teto_do_retrato} de #{total} arquivos)",
          else: ""

      "Estado do seu worktree — branch `#{branch}`, #{total} arquivo(s):\n" <> corpo <> corte
    else
      _ ->
        "Estado do seu worktree — branch `#{branch}`: indisponível para leitura " <>
          "pelo engine; liste com `terminal` (`ls`, `git status`)."
    end
  end

  defp criar(project_id, agent_id, task_slug, base) do
    with {:ok, remoto} <- ProjectRepository.remoto_de_trabalho(project_id),
         {:ok, work_dir} <- Workspace.ensure_remoto(project_id, remoto) do
      if runner?(project_id) do
        RunnerGit.add_worktree(project_id, work_dir, agent_id, task_slug, base)
      else
        with :ok <- atualizar_remoto(project_id, work_dir, remoto) do
          add_worktree(work_dir, agent_id, task_slug, base)
        end
      end
    end
  end

  # RN-779 (AT-458): o merge das PRs acontece no REMOTO; sem este `fetch` o
  # working tree só conhecia a `dev` do dia da inicialização. Serializado por
  # projeto, como a inicialização (`fetch` paralelo no mesmo `.git` colide).
  defp atualizar_remoto(project_id, work_dir, remoto) do
    :global.trans({{__MODULE__, :fetch, project_id}, self()}, fn ->
      case GitAuth.run(work_dir, ["fetch", "origin"], remoto) do
        {:ok, _} ->
          :ok

        {:error, saida} ->
          {:error,
           "não foi possível atualizar a `dev` do remoto antes de criar o worktree " <>
             "(git fetch): #{String.slice(to_string(saida), 0, 300)}"}
      end
    end)
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
    trabalho = ProjectRepository.branch_de_trabalho()
    propria = "feature/#{task_slug}"
    adotando? = base == propria
    base = base |> ja_mergeada_volta_ao_trabalho(work_dir) |> retomada(work_dir, propria)

    with {:ok, ponto} <- garantir_base(work_dir, base),
         ponto = ponta_atual(work_dir, base, trabalho, ponto),
         {:ok, wt} <- criar_worktree(work_dir, agent_id, task_slug, ponto) do
      # RN-779 (AT-458): partindo de outra branch que não a de trabalho (a da
      # task anterior, RN-760, ou o trabalho preservado desta, RN-743), o
      # worktree integra a ponta ATUAL da `dev` antes do primeiro passo. A
      # readoção depois de conflito (RN-715) fica de fora: integrar ali é o
      # trabalho do próprio agente.
      if base != trabalho and not adotando?,
        do: integrar_trabalho(work_dir, wt, agent_id, base, trabalho),
        else: {:ok, wt}
    end
  end

  @prefixo_do_conflito "conflito ao integrar a `dev` atual"

  @doc "A falha de `add_worktree/4` é o conflito de integração da RN-779?"
  def conflito_de_integracao?(motivo) when is_binary(motivo),
    do: String.starts_with?(motivo, @prefixo_do_conflito)

  def conflito_de_integracao?(_), do: false

  # RN-779: a ponta da `dev` é a do REMOTO (`origin/dev`, atualizada pelo
  # `fetch` de `criar/4`) quando a local ficou para trás: a local só anda no
  # checkout da inicialização (sem auto-pull), e era dela que a task retomada
  # nascia, sem nenhum merge feito depois.
  defp ponta_do_trabalho(work_dir, trabalho) do
    remota = "origin/#{trabalho}"

    cond do
      not ref?(work_dir, "refs/remotes/#{remota}") -> trabalho
      not ref?(work_dir, "refs/heads/#{trabalho}") -> remota
      ancestral?(work_dir, trabalho, remota) -> remota
      true -> trabalho
    end
  end

  @doc """
  RN-797 (AT-474). A branch do worktree não traz NADA que a `dev` não tenha:
  árvore limpa (nada sem commit) e nenhum diff desde o ancestral comum com a
  ponta da `dev` (`git diff --quiet <ponta>...HEAD`). É o caso da task
  reintegrada (RN-779) cujo código já entrou por outra PR. Qualquer dúvida —
  pasta que o engine não alcança (modo `runner`), git que falha — é `false`:
  na dúvida a task segue para os gates, nunca fecha sozinha.
  """
  def sem_diff_contra_a_dev?(path) do
    trabalho = ProjectRepository.branch_de_trabalho()

    with true <- is_binary(path) and File.dir?(path),
         {:ok, ""} <- git(path, ["status", "--porcelain"]),
         ponta = ponta_do_trabalho(path, trabalho),
         true <- ref?(path, ponta),
         {:ok, _} <- git(path, ["diff", "--quiet", "#{ponta}...HEAD"]) do
      true
    else
      _ -> false
    end
  end

  @doc """
  RN-811 (AT-486). Como `sem_diff_contra_a_dev?/1`, mas ANTES atualiza a `dev`
  do remoto pelo MESMO `fetch` que a RN-779 faz no claim: sem ele a comparação
  usava a `dev` do dia da criação do worktree, e a branch já inteira na `dev`
  remota passava pelos gates com 0 arquivos. `fetch` que falha não decide
  nada: compara com o que há (na dúvida, a task segue para os gates).
  """
  def sem_diff_contra_a_dev?(path, project_id) do
    case ProjectRepository.remoto_de_trabalho(project_id) do
      {:ok, remoto} -> sem_diff_atualizado?(path, project_id, remoto)
      _ -> sem_diff_contra_a_dev?(path)
    end
  rescue
    _ -> sem_diff_contra_a_dev?(path)
  end

  @doc false
  def sem_diff_atualizado?(path, project_id, remoto) do
    if is_binary(path) and File.dir?(path), do: atualizar_remoto(project_id, path, remoto)
    sem_diff_contra_a_dev?(path)
  end

  defp ponta_atual(work_dir, base, trabalho, ponto) do
    if base == trabalho and ponto != [], do: [ponta_do_trabalho(work_dir, trabalho)], else: ponto
  end

  # RN-779 + RN-743: a task RETOMADA (a mesma task, num processo novo, que
  # perdeu o ponteiro em memória) parte da própria branch quando ela tem
  # trabalho que a `dev` não contém — senão o `-B` a redefinia e o trabalho
  # preservado sumia do histórico da branch.
  defp retomada(base, work_dir, propria) do
    trabalho = ProjectRepository.branch_de_trabalho()

    if base == trabalho and ref?(work_dir, "refs/heads/#{propria}") and
         ref?(work_dir, "refs/heads/#{trabalho}") and
         not ancestral?(work_dir, propria, ponta_do_trabalho(work_dir, trabalho)),
       do: propria,
       else: base
  end

  defp integrar_trabalho(work_dir, %{path: path} = wt, agent_id, base, trabalho) do
    ponta = ponta_do_trabalho(work_dir, trabalho)

    if ref?(work_dir, ponta) do
      args = [
        "-c",
        "user.name=#{agent_id}[bot]",
        "-c",
        "user.email=#{agent_id}@bot.brabo.local",
        "merge",
        "--no-edit",
        "--no-ff",
        ponta
      ]

      case git(path, args) do
        {:ok, _} ->
          {:ok, wt}

        {:error, saida} ->
          arquivos =
            case git(path, ["diff", "--name-only", "--diff-filter=U"]) do
              {:ok, out} -> out |> String.split("\n", trim: true) |> Enum.join(", ")
              _ -> ""
            end

          _ = git(path, ["merge", "--abort"])

          {:error,
           "#{@prefixo_do_conflito} (#{ponta}) no worktree de #{wt.branch}, que partiu de " <>
             "#{base}: " <>
             if(arquivos == "",
               do: String.slice(to_string(saida), 0, 300),
               else: "arquivos em conflito: #{arquivos}"
             ) <>
             ". O trabalho de #{base} segue intacto; integre a `dev` nessa branch e desbloqueie a task."}
      end
    else
      {:ok, wt}
    end
  end

  defp ancestral?(work_dir, a, b),
    do: match?({:ok, _}, git(work_dir, ["merge-base", "--is-ancestor", a, b]))

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

  # RN-760 (AT-447): a próxima task parte da branch da anterior enquanto ela
  # NÃO foi mergeada; mergeada (ancestral da `dev` local), parte da `dev`, que
  # já a contém e pode ter andado. Merge por squash num remoto não é ancestral
  # e segue partindo da branch anterior — declarado.
  defp ja_mergeada_volta_ao_trabalho(base, work_dir) do
    trabalho = ProjectRepository.branch_de_trabalho()

    if base != trabalho and ref?(work_dir, "refs/heads/#{base}") and
         ref?(work_dir, "refs/heads/#{trabalho}") and
         ancestral?(work_dir, base, ponta_do_trabalho(work_dir, trabalho)),
       do: trabalho,
       else: base
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
    case git(work_dir, ["worktree", "add", "--no-track", path, "-B", branch] ++ ponto_de_partida) do
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
