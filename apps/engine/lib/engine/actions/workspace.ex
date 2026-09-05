defmodule Engine.Actions.Workspace do
  @moduledoc """
  Garante o working tree do projeto em
  <PROJECT_WORKSPACES_ROOT>/<workspace_dir_name>/, derivado do bare repo
  local já provisionado (Fase 2). O diretório pode já existir sem ser um
  working tree git ainda (por exemplo, porque a api gravou permissions.json
  ali antes de qualquer execução) — por isso nunca usa `git clone` direto
  (falha em diretório não-vazio); em vez disso, faz init + remote add +
  fetch + checkout dentro do diretório, só na primeira vez (sem auto-pull
  depois — "por ora", ver plano).

  `workspace_dir_name` (RN-109) é o nome de pasta legível
  (`<slug>-<8 chars do id>` pra projeto novo, o UUID puro pra projeto de
  antes dessa coluna existir) — a MESMA coluna que a api lê em
  `project-workspaces-root.ts`. Num projeto no modo `local` (RN-169, ADR 0072)
  a pasta não é essa: é o caminho absoluto do usuário, e o localizador vem
  pronto da consulta. `workspace_dir/1` resolve o localizador a partir do
  `project_id` via `Engine.Projects.Project.workspace_dir_name/1` (uma
  consulta), e é por isso que esta função NÃO é hot path: quem chama por
  ferramenta de agente (search/read/write_file) já recebe `ctx[:workspace_root]`
  PRONTO — resolvido uma vez, na criação do worktree do agente
  (`Engine.Dev.WorktreeManager`) — e só cai aqui como fallback.

  A inicialização é SERIALIZADA por projeto (`:global.trans`): na ativação
  da execução, N dev agents do mesmo projeto chamam `ensure!/3` em paralelo
  e todos veem o working tree ainda inexistente. Sem o lock, os `git init`/
  `fetch` colidem no mesmo diretório ("could not lock config file",
  "cannot copy .../hooks/*.sample: Arquivo existe") e derrubam todos os
  agentes menos um — o que quebrava o critério de aceite de dois devs em
  paralelo. Ver `ensure/3` pro caminho sem exceção.

  Desde a RN-507 (ADR 0145), `ensure!/4` bifurca por `execution_mode`: LOCAL
  (`init_from_bare!/4`, tudo acima) para `container`/`mounted`; via
  `Engine.Actions.Workspace.RunnerGit` para `runner` — os MESMOS init +
  remote add + fetch + checkout, só que executados na máquina do usuário, via
  canal Phoenix, porque o processo do engine não tem bind-mount nenhum para o
  caminho de HOST que um projeto `runner` usa. `mounted` NÃO muda: a base
  única do ADR 0141 já é bind-mount por identidade no engine, então o
  caminho local sempre funcionou para ele.
  """

  alias Engine.Actions.GitAuth
  alias Engine.Actions.Workspace.RunnerGit
  alias Engine.Projects.Project

  @doc """
  Versão que não levanta: devolve `{:ok, dir}` ou `{:error, mensagem}`.
  Preferida por quem roda dentro de um processo supervisionado (dev agents)
  — uma falha de git aqui não deve derrubar o agente e deixar a task que
  ele já reivindicou órfã em `in_progress`.
  """
  def ensure(project_id, bare_repo_path, default_branch \\ "main") do
    {:ok, ensure!(project_id, bare_repo_path, default_branch)}
  rescue
    e -> {:error, Exception.message(e)}
  end

  @doc """
  Versão que fala o vocabulário do ADR 0056: recebe o **remoto de trabalho**
  (`%{origin, default_branch, token, username}`) em vez de um caminho.

  A origem gravada no `origin` é sempre a LIMPA — a credencial entra por
  invocação, via `Engine.Actions.GitAuth`, e não sobra no `.git/config`.
  """
  def ensure_remoto(project_id, remoto) do
    {:ok, ensure!(project_id, remoto.origin, remoto.default_branch || "main", remoto)}
  rescue
    e -> {:error, Exception.message(e)}
  end

  @doc """
  Garante o working tree — LOCAL para `container`/`mounted`
  (`init_from_bare!/4`, comportamento de sempre: `BRABO_PROJECTS_BASE` é
  bind-mount por identidade no engine também, então `mounted` já enxerga a
  pasta), via `RunnerGit` para `runner`.

  Até a RN-507 (ADR 0145), esta função tentava `File.mkdir_p!`/`git init`
  LOCAL para os TRÊS modos — em `runner` isso é o defeito que a RN-478
  registrou e deixou ABERTO de propósito: `workspace_dir/2` devolve o
  caminho do HOST, e o processo do engine não tem bind-mount nenhum para lá,
  então a tentativa sempre falhava (com uma mensagem melhorada, mas ainda uma
  falha). A materialização passa a acontecer DENTRO do container real do
  projeto, na máquina do usuário — pelo MESMO canal Phoenix que já executa
  comando de terminal aprovado (`Engine.Runners.RunnerRouter.exec/5`) — e só
  quando as TRÊS pré-condições da RN-507 estão satisfeitas
  (`Engine.Runners.RunnerReadiness`); faltando alguma, `RunnerGit.ensure!/5`
  levanta com mensagem NOMEADA, sem tentar I/O nenhum antes.
  """
  def ensure!(project_id, bare_repo_path, default_branch \\ "main", remoto \\ %{}) do
    dir = workspace_dir(project_id)

    if runner?(project_id) do
      RunnerGit.ensure!(project_id, dir, bare_repo_path, default_branch, remoto)
    else
      ensure_local!(project_id, dir, bare_repo_path, default_branch, remoto)
    end
  end

  defp runner?(project_id) do
    match?(%{execution_mode: "runner"}, Project.get(project_id))
  rescue
    _ -> false
  catch
    :exit, _ -> false
  end

  defp ensure_local!(project_id, dir, bare_repo_path, default_branch, remoto) do
    File.mkdir_p!(dir)

    if pronto?(dir) do
      dir
    else
      # O lock é por projeto: dois projetos diferentes inicializam em
      # paralelo normalmente. Recheca dentro da seção crítica — quem
      # esperou o lock encontra o working tree já pronto e não refaz nada.
      :global.trans({{__MODULE__, project_id}, self()}, fn ->
        cond do
          pronto?(dir) ->
            :ok

          # Workspace de ANTES da marca: já é repo utilizável, e re-inicializar
          # apagaria trabalho. Só ganha a marca.
          git_dir?(dir) ->
            marcar_pronto!(dir)

          true ->
            init_from_bare!(dir, bare_repo_path, default_branch, remoto)
            marcar_pronto!(dir)
        end
      end)

      dir
    end
  end

  @marca ".brabo-workspace-pronto"

  # O caminho rápido SEM lock precisa de um critério que só seja verdadeiro no
  # FIM da inicialização.
  #
  # Era `.git` existir — e `init_from_bare!` começa com `git init`, que cria o
  # `.git` na PRIMEIRA linha, antes do fetch e do checkout. Quem chegasse nessa
  # janela via "pronto", pulava o lock inteiro e rodava `git worktree add` num
  # repositório pela metade: `fatal: not a git repository`.
  #
  # Só aparece com DOIS dev agents subindo juntos, o que exige duas entradas no
  # module_map — por isso atravessou todas as execuções de um módulo só.
  #
  # O lock continua onde estava. O que muda é a guarda que decide se vale a
  # pena pegá-lo.
  defp pronto?(dir), do: File.regular?(Path.join(dir, @marca))

  defp marcar_pronto!(dir), do: File.write!(Path.join(dir, @marca), "")

  defp git_dir?(dir), do: File.dir?(Path.join(dir, ".git"))

  @doc """
  A pasta do workspace, a partir do `project_id`. Faz UMA consulta pra
  resolver `workspace_dir_name` (RN-109) — aceitável aqui porque nenhum
  chamador desta aridade está no hot path do laço de ferramentas (ver
  `@moduledoc`); quem está usa `workspace_dir/2` com o nome já em mãos.
  """
  def workspace_dir(project_id) do
    workspace_dir(project_id, Project.workspace_dir_name(project_id))
  end

  @doc """
  A pasta do workspace, com o localizador JÁ resolvido — sem consulta nenhuma.
  `nil` degrada para o `project_id` cru (mesmo comportamento de antes da
  RN-109), o que só acontece se o projeto não existir mais no banco.

  O localizador é uma de duas coisas (RN-169, ADR 0072), e a barra inicial
  distingue sem ambiguidade — o nome de pasta do modo `container` é validado
  na api contra `^[A-Za-z0-9_-]{1,64}$`, que não admite `/`:

  - ABSOLUTO: é a pasta do usuário de um projeto `local`, e ela É a raiz.
    Juntar com `project_workspaces_root` produziria
    `/data/project-workspaces/home/voce/projetos/loja`, que não existe — e o
    engine escreveria num lugar que a api não enxerga, que é exatamente a
    divergência que a derivação única existe para impedir;
  - relativo: é o nome de pasta da RN-109, dentro da raiz gerenciada.
  """
  def workspace_dir(project_id, workspace_dir_name) do
    localizador = workspace_dir_name || project_id

    if String.starts_with?(localizador, "/") do
      Path.expand(localizador)
    else
      Path.join(Application.fetch_env!(:engine, :project_workspaces_root), localizador)
    end
  end

  defp init_from_bare!(dir, bare_repo_path, default_branch, remoto) do
    {_, 0} = System.cmd("git", ["init"], cd: dir, stderr_to_stdout: true)

    # A origem gravada é a LIMPA: é este valor que fica no `.git/config`, dentro
    # da pasta onde o dev agent tem leitura auto-aprovada (RN-075). A credencial
    # entra só na invocação do `fetch`, abaixo — ADR 0056, decisão 2.
    {_, 0} =
      System.cmd("git", ["remote", "add", "origin", bare_repo_path],
        cd: dir,
        stderr_to_stdout: true
      )

    {:ok, _} = GitAuth.run(dir, ["fetch", "origin"], remoto)

    case System.cmd("git", ["checkout", "-B", default_branch, "origin/#{default_branch}"],
           cd: dir,
           stderr_to_stdout: true
         ) do
      {_, 0} ->
        :ok

      {_, _} ->
        # Bare repo provisionado mas nunca recebeu push (sem commits, sem
        # origin/<branch> ainda) — cria um branch local vazio válido.
        {_, 0} =
          System.cmd("git", ["checkout", "-b", default_branch], cd: dir, stderr_to_stdout: true)

        :ok
    end
  end
end
