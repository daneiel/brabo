defmodule Engine.Actions.Workspace do
  @moduledoc """
  Garante o working tree do projeto em <PROJECT_WORKSPACES_ROOT>/<project_id>/,
  derivado do bare repo local já provisionado (Fase 2). O diretório pode já
  existir sem ser um working tree git ainda (por exemplo, porque a api
  gravou permissions.json ali antes de qualquer execução) — por isso nunca
  usa `git clone` direto (falha em diretório não-vazio); em vez disso, faz
  init + remote add + fetch + checkout dentro do diretório, só na primeira
  vez (sem auto-pull depois — "por ora", ver plano).

  A inicialização é SERIALIZADA por projeto (`:global.trans`): na ativação
  da execução, N dev agents do mesmo projeto chamam `ensure!/3` em paralelo
  e todos veem o working tree ainda inexistente. Sem o lock, os `git init`/
  `fetch` colidem no mesmo diretório ("could not lock config file",
  "cannot copy .../hooks/*.sample: Arquivo existe") e derrubam todos os
  agentes menos um — o que quebrava o critério de aceite de dois devs em
  paralelo. Ver `ensure/3` pro caminho sem exceção.
  """

  alias Engine.Actions.GitAuth

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

  def ensure!(project_id, bare_repo_path, default_branch \\ "main", remoto \\ %{}) do
    dir = workspace_dir(project_id)
    File.mkdir_p!(dir)

    if git_dir?(dir) do
      dir
    else
      # O lock é por projeto: dois projetos diferentes inicializam em
      # paralelo normalmente. Recheca dentro da seção crítica — quem
      # esperou o lock encontra o working tree já pronto e não refaz nada.
      :global.trans({{__MODULE__, project_id}, self()}, fn ->
        unless git_dir?(dir) do
          init_from_bare!(dir, bare_repo_path, default_branch, remoto)
        end
      end)

      dir
    end
  end

  defp git_dir?(dir), do: File.dir?(Path.join(dir, ".git"))

  def workspace_dir(project_id) do
    Path.join(Application.fetch_env!(:engine, :project_workspaces_root), project_id)
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
