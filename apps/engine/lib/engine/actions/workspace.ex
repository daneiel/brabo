defmodule Engine.Actions.Workspace do
  @moduledoc """
  Garante o working tree do projeto em <PROJECT_WORKSPACES_ROOT>/<project_id>/,
  derivado do bare repo local já provisionado (Fase 2). O diretório pode já
  existir sem ser um working tree git ainda (por exemplo, porque a api
  gravou permissions.json ali antes de qualquer execução) — por isso nunca
  usa `git clone` direto (falha em diretório não-vazio); em vez disso, faz
  init + remote add + fetch + checkout dentro do diretório, só na primeira
  vez (sem auto-pull depois — "por ora", ver plano).

  Limitação conhecida: duas execuções concorrentes pro MESMO projeto,
  ambas vendo o working tree ainda inexistente, podem corromper o
  checkout (sem lock de inicialização) — aceitável pra este incremento,
  não é um requisito do critério de aceite.
  """

  def ensure!(project_id, bare_repo_path, default_branch \\ "main") do
    dir = workspace_dir(project_id)
    File.mkdir_p!(dir)

    unless File.dir?(Path.join(dir, ".git")) do
      init_from_bare!(dir, bare_repo_path, default_branch)
    end

    dir
  end

  def workspace_dir(project_id) do
    Path.join(Application.fetch_env!(:engine, :project_workspaces_root), project_id)
  end

  defp init_from_bare!(dir, bare_repo_path, default_branch) do
    {_, 0} = System.cmd("git", ["init"], cd: dir, stderr_to_stdout: true)

    {_, 0} =
      System.cmd("git", ["remote", "add", "origin", bare_repo_path],
        cd: dir,
        stderr_to_stdout: true
      )

    {_, 0} = System.cmd("git", ["fetch", "origin"], cd: dir, stderr_to_stdout: true)

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
