defmodule Engine.Actions.Workspace.RunnerGit do
  @moduledoc """
  `git init`/`remote add`/`fetch`/`checkout` e os equivalentes de
  `File.dir?`/`ls`/`rm_rf` que `Engine.Dev.WorktreeManager` precisa, para um
  projeto `execution_mode: runner` — via o MESMO canal Phoenix que já
  executa comando de terminal aprovado
  (`Engine.Runners.RunnerRouter.exec/5`, RN-423/ADR 0104). Nunca
  `System.cmd`/`File.*` local: o caminho que `Engine.Actions.Workspace.
  workspace_dir/2` devolve para `runner` é do HOST, e o processo do engine
  não tem bind-mount nenhum para lá (a lacuna que a RN-478 registrou e
  deixou ABERTA de propósito).

  ## RN-505 (ADR 0145) — Docker vira pré-requisito real do modo `runner`

  TODA função pública daqui checa `Engine.Runners.RunnerReadiness` ANTES de
  mandar qualquer coisa pelo canal — as MESMAS três pré-condições que
  `Engine.Actions.TerminalExecutor` sempre checou para rotear terminal
  (workspace verificado, runner conectado, container REGISTRADO `running`).
  Faltando alguma, a função falha com mensagem NOMEADA (a mesma linguagem de
  `RunnerReadiness.mensagem/2`) em vez de tentar um `exec` às cegas e deixar
  o timeout do canal explicar por tabela. `ensure!/5` LEVANTA (mesmo
  contrato de `Engine.Actions.Workspace.ensure!/4`, que
  `Engine.Actions.Workspace.ensure_remoto/2` já sabe capturar); as funções
  de worktree devolvem `{:error, motivo}` — mesmo contrato não-levantador
  que `Engine.Dev.WorktreeManager` já tinha para as suas.

  ## Credencial de git (ADR 0056) — por que `env`, nunca argv nem `.git/config`

  `git fetch` autenticado usa a MESMA disciplina de `Engine.Actions.GitAuth`
  do lado local: a credencial viaja só no AMBIENTE do processo filho que o
  RUNNER spawna — o campo `env` que a RN-505 acrescentou ao protocolo
  `exec`/`exec_result` (`Engine.Runners.RunnerRouter.exec/5`,
  `apps/runner/src/exec.ts`) — nunca concatenada no comando (apareceria no
  log do runner) nem gravada em `.git/config` (o dev agent lê essa pasta
  com aprovação automática, RN-075). O helper de credencial (`-c
  credential.helper=...`) é instalado por FLAG no próprio comando; só o
  VALOR sai do ambiente.

  ## Onde o comando roda de verdade

  Interno ao runner (ADR 0137): com um container ativo, ele roteia para
  `docker exec`; sem ele, para o host. Este módulo nunca sabe qual dos dois
  — ele só entrega o comando pelo canal, exatamente como
  `Engine.Actions.TerminalExecutor.run_via_runner/4` já fazia para comando
  de terminal comum.
  """

  alias Engine.Actions.GitAuth
  alias Engine.Runners.{RunnerReadiness, RunnerRouter}

  @timeout_ms 60_000
  @marca ".brabo-workspace-pronto"

  @doc """
  Espelho de `Engine.Actions.Workspace.ensure!/4` (a função privada
  `init_from_bare!/4` de lá), via o runner. `dir` já é o caminho ABSOLUTO do
  HOST — o mesmo que `Workspace.workspace_dir/2` sempre devolveu para
  `runner`. Idempotente pela MESMA marca de arquivo
  (`.brabo-workspace-pronto`) e SERIALIZADO pelo MESMO lock `:global.trans`
  por `project_id` — dois dev agents do mesmo projeto `runner` ativando a
  execução em paralelo não colidem, igual ao caminho local.

  Levanta (nunca devolve `{:error, _}`) quando a pré-condição da RN-505
  falta, ou quando o `git fetch`/`checkout` falha de verdade — mesmo
  contrato que `Engine.Actions.Workspace.ensure!/4` sempre teve, e que
  `ensure_remoto/2` já sabe capturar e traduzir em `{:error, mensagem}`.
  """
  def ensure!(project_id, dir, bare_repo_path, default_branch, remoto) do
    verificar_pronto_ou_levanta!(project_id)

    if pronto?(project_id, dir) do
      dir
    else
      :global.trans({{__MODULE__, project_id}, self()}, fn ->
        cond do
          pronto?(project_id, dir) ->
            :ok

          git_dir?(project_id, dir) ->
            marcar_pronto!(project_id, dir)

          true ->
            init_from_bare!(project_id, dir, bare_repo_path, default_branch, remoto)
            marcar_pronto!(project_id, dir)
        end
      end)

      dir
    end
  end

  @doc "Espelho de `Engine.Dev.WorktreeManager.add_worktree/3`, via o runner."
  def add_worktree(project_id, work_dir, agent_id, task_slug) do
    with :pronto <- RunnerReadiness.verificar(project_id) do
      path = worktree_path(work_dir, agent_id)
      branch = "feature/#{task_slug}"
      _ = remove_worktree(project_id, work_dir, agent_id)

      # `-B`, mesmo motivo do caminho local (`Engine.Dev.WorktreeManager`):
      # redefine a branch em vez de recusar quando ela já existe de uma
      # tentativa anterior da MESMA task.
      case git(project_id, work_dir, "worktree add #{shq(path)} -B #{shq(branch)}") do
        {:ok, {0, _}} -> {:ok, %{path: path, branch: branch}}
        {:ok, {_status, out}} -> {:error, out}
        {:error, motivo} -> {:error, motivo}
      end
    else
      {:erro, motivo} -> {:error, RunnerReadiness.mensagem(motivo, project_id)}
    end
  end

  @doc """
  Espelho de `Engine.Dev.WorktreeManager.remove_at/2`, via o runner —
  best-effort, sempre `:ok`. Sem runner pronto, não há como remover AGORA;
  isso não é falha (o worktree continua existindo na máquina do usuário,
  só não dá pra alcançá-lo deste instante) — mesma régua de `list_worktrees/2`.
  """
  def remove_worktree(project_id, work_dir, agent_id) do
    if RunnerReadiness.pronto?(project_id) do
      path = worktree_path(work_dir, agent_id)
      _ = git(project_id, work_dir, "worktree remove --force #{shq(path)}")
      _ = git(project_id, work_dir, "worktree prune")
      _ = exec(project_id, "rm -rf #{shq(path)}", nil)
    end

    :ok
  end

  @doc """
  Espelho de `Engine.Dev.WorktreeManager.list_at/1`, via o runner. `[]`
  sem runner pronto — "não dá pra saber agora" nunca é uma lista de
  órfãos: o CHAMADOR do job periódico
  (`Engine.Dev.WorktreeCleanup`) já checa `RunnerReadiness.pronto?/1` e
  PULA o projeto inteiro antes de chegar aqui; este default só protege quem
  chamar `Engine.Dev.WorktreeManager.list/1` direto.
  """
  def list_worktrees(project_id, work_dir) do
    if RunnerReadiness.pronto?(project_id) do
      dir = worktrees_dir(work_dir)

      # `-mindepth 1 -maxdepth 1 -type d`: portátil entre o `find` GNU
      # (Linux) e o BSD (macOS) — os dois suportam essas duas flags, ao
      # contrário de `-printf`, só GNU.
      comando =
        "find #{shq(dir)} -mindepth 1 -maxdepth 1 -type d -exec basename {} \\;"

      case exec(project_id, comando, nil) do
        {:ok, {0, saida}} -> String.split(saida, "\n", trim: true)
        _ -> []
      end
    else
      []
    end
  end

  @doc "Espelho de `Engine.Dev.WorktreeManager.cleanup_orphans_at/2`, via o runner."
  def cleanup_orphans(project_id, work_dir, live_agent_ids) do
    live = MapSet.new(live_agent_ids)

    list_worktrees(project_id, work_dir)
    |> Enum.reject(&MapSet.member?(live, &1))
    |> Enum.map(fn agent_id ->
      remove_worktree(project_id, work_dir, agent_id)
      agent_id
    end)
  end

  # --- init_from_bare!, via o runner ---

  defp init_from_bare!(project_id, dir, bare_repo_path, default_branch, remoto) do
    exec!(project_id, "mkdir -p #{shq(dir)}", nil, nil)
    git!(project_id, dir, "init")
    git!(project_id, dir, "remote add origin #{shq(bare_repo_path)}")
    fetch!(project_id, dir, remoto)

    branch_args = "#{shq(default_branch)} origin/#{shq(default_branch)}"

    case git(project_id, dir, "checkout -B #{branch_args}") do
      {:ok, {0, _}} ->
        :ok

      _ ->
        # Bare repo provisionado mas nunca recebeu push (sem commits, sem
        # origin/<branch> ainda) — mesmo fallback do caminho local: cria um
        # branch local vazio válido.
        git!(project_id, dir, "checkout -b #{shq(default_branch)}")
    end
  end

  # ADR 0056/RN-505 — ver o moduledoc. `args_de_auth/1`/`env_de_auth/1` são
  # os MESMOS que `Engine.Actions.GitAuth` usa no caminho local: só o
  # transporte da credencial muda (era `System.cmd(env: ...)` local, agora é
  # o campo `env` do payload `exec` do canal).
  defp fetch!(project_id, dir, remoto) do
    # `[]` (provider `local`, sem token) vira `nil`, não `%{}` — o payload do
    # canal só ganha a chave `env` quando ela carrega credencial de verdade
    # (ver `EngineWeb.TerminalChannel.handle_info({:dispatch_exec, ...})`).
    env =
      case GitAuth.env_de_auth(remoto) do
        [] -> nil
        pares -> Map.new(pares)
      end

    # `Enum.join/2` em vez de `"git #{flags} fetch origin"`: com `flags`
    # vazio (provider `local`, sem token) a interpolação deixava DOIS espaços
    # entre "git" e "fetch" — inofensivo pro shell, mas o comando deixava de
    # bater byte a byte com o que um `git fetch origin` comum produziria.
    comando = Enum.join(["git"] ++ GitAuth.args_de_auth(remoto) ++ ["fetch", "origin"], " ")

    case exec(project_id, comando, dir, env) do
      {:ok, {0, _}} ->
        :ok

      {:ok, {_status, out}} ->
        raise "git fetch falhou (runner, projeto #{project_id}): #{out}"

      {:error, motivo} ->
        raise motivo
    end
  end

  defp pronto?(project_id, dir) do
    match?({:ok, {0, _}}, exec(project_id, "test -f #{shq(marca(dir))}", nil))
  end

  defp marcar_pronto!(project_id, dir) do
    exec!(project_id, "touch #{shq(marca(dir))}", nil, nil)
    :ok
  end

  defp git_dir?(project_id, dir) do
    match?({:ok, {0, _}}, exec(project_id, "test -d #{shq(Path.join(dir, ".git"))}", nil))
  end

  defp marca(dir), do: Path.join(dir, @marca)

  # `git!/3`: variante que LEVANTA em status != 0 — usada por `init_from_bare!/5`,
  # cuja pré-condição é a MESMA de `ensure!/5` (já verificada em `verificar_pronto_ou_levanta!/1`
  # antes de entrar no `:global.trans`).
  defp git!(project_id, dir, subcomando) do
    case git(project_id, dir, subcomando) do
      {:ok, {0, out}} ->
        out

      {:ok, {status, out}} ->
        raise "git #{subcomando} falhou (runner, projeto #{project_id}), status #{status}: #{out}"

      {:error, motivo} ->
        raise motivo
    end
  end

  # `git/3`: variante que NÃO levanta — usada por chamadores que já sabem
  # tratar `{:error, _}`/status != 0 (`add_worktree/4`, o fallback de
  # checkout em `init_from_bare!/5`).
  defp git(project_id, dir, subcomando), do: exec(project_id, "git " <> subcomando, dir)

  # O par exec/exec! espelha `git/exec!` acima, um nível abaixo: `exec/3`
  # devolve `{:ok, {status, saida}} | {:error, mensagem}`, nunca levanta;
  # `exec!/4` levanta, para os pontos de `init_from_bare!/5` que não têm
  # fallback nenhum (mkdir/touch/init/remote add — falhar aqui é falha real,
  # não um caminho alternativo a tentar).
  defp exec(project_id, command, cwd, env \\ nil) do
    case RunnerReadiness.verificar(project_id) do
      :pronto ->
        case RunnerRouter.exec(project_id, command, cwd, @timeout_ms, env) do
          {:ok, payload} ->
            {:ok, {Map.get(payload, "exitCode") || -1, Map.get(payload, "output") || ""}}

          {:error, :not_connected} ->
            {:error,
             "o runner caiu durante a materialização do worktree (projeto " <>
               "#{project_id}) — tente de novo."}

          {:error, :timeout} ->
            {:error, "git (runner, projeto #{project_id}) não respondeu em #{@timeout_ms}ms."}
        end

      {:erro, motivo} ->
        {:error, RunnerReadiness.mensagem(motivo, project_id)}
    end
  end

  defp exec!(project_id, command, cwd, env) do
    case exec(project_id, command, cwd, env) do
      {:ok, {0, out}} ->
        out

      {:ok, {status, out}} ->
        raise "#{command} falhou (runner, #{project_id}), status #{status}: #{out}"

      {:error, motivo} ->
        raise motivo
    end
  end

  defp verificar_pronto_ou_levanta!(project_id) do
    case RunnerReadiness.verificar(project_id) do
      :pronto -> :ok
      {:erro, motivo} -> raise RunnerReadiness.mensagem(motivo, project_id)
    end
  end

  defp worktrees_dir(work_dir), do: Path.join(work_dir, ".worktrees")
  defp worktree_path(work_dir, agent_id), do: Path.join(worktrees_dir(work_dir), agent_id)

  # Shell-quote: aspas simples, com o escape POSIX padrão para uma aspa
  # simples embutida (fecha, escapa, reabre). Todo caminho/branch que entra
  # num comando montado por concatenação de string passa por aqui — nunca
  # interpolado cru.
  defp shq(valor), do: "'" <> String.replace(valor, "'", "'\\''") <> "'"
end
