defmodule Engine.Dev.WorktreeCleanup do
  @moduledoc """
  Poda worktrees órfãos (Fase 4a): varre os workspaces dos projetos e remove os
  worktrees cujo dev agent não está mais vivo no `Engine.Dev.Registry`. Rodado
  pelo `WorktreeCleanupWorker` (Oban) periodicamente.
  """

  alias Engine.Dev.WorktreeManager

  def run do
    root = Application.get_env(:engine, :project_workspaces_root)

    case root && File.ls(root) do
      {:ok, project_ids} ->
        Enum.each(project_ids, fn project_id ->
          WorktreeManager.cleanup_orphans(project_id, live_agents(project_id))
        end)

        :ok

      _ ->
        :ok
    end
  end

  # agent_ids com processo vivo no Registry pra o projeto.
  def live_agents(project_id) do
    Registry.select(Engine.Dev.Registry, [
      {{{:"$1", :"$2"}, :_, :_}, [{:==, :"$1", project_id}], [:"$2"]}
    ])
  end
end
