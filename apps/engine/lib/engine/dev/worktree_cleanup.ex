defmodule Engine.Dev.WorktreeCleanup do
  @moduledoc """
  Poda worktrees órfãos (Fase 4a): varre os workspaces dos projetos e remove os
  worktrees cujo dev agent não está mais vivo. Rodado pelo
  `WorktreeCleanupWorker` (Oban) periodicamente.

  ## Por que a fonte de verdade é a tabela, não o Registry (Fase 5)

  A versão original consultava o `Engine.Dev.Registry`, que é **local ao nó**.
  Enquanto o engine era uma réplica só, "vivo no Registry" e "vivo" eram a
  mesma coisa. Com o HPA da Fase 5 deixaram de ser, e o volume de workspaces é
  compartilhado entre as réplicas: a réplica A varre os worktrees dos agentes
  da réplica B, não os encontra no próprio Registry e **os remove como
  órfãos** — apagando trabalho em andamento, com o dev agent ainda escrevendo
  ali.

  `dev_agent_states` é global por construção (é a mesma linha de que a
  reidratação parte) e a linha é deletada quando o agente termina, então o
  conjunto é equivalente ao do Registry num nó só e correto em N nós.
  """

  alias Engine.Dev.DevAgentState
  alias Engine.Dev.WorktreeManager

  def run do
    root = Application.get_env(:engine, :project_workspaces_root)

    case root && File.ls(root) do
      {:ok, project_ids} ->
        # Uma consulta só para todos os projetos: varrer o disco já é N
        # chamadas de sistema, não vale somar N round-trips ao banco.
        live = live_agents_by_project()

        Enum.each(project_ids, fn project_id ->
          WorktreeManager.cleanup_orphans(project_id, Map.get(live, project_id, []))
        end)

        :ok

      _ ->
        :ok
    end
  end

  @doc "agent_ids com dev agent vivo em QUALQUER réplica, agrupados por projeto."
  def live_agents_by_project do
    DevAgentState.list_all()
    |> Enum.group_by(& &1.project_id, & &1.agent_id)
  end

  @doc "agent_ids com dev agent vivo em qualquer réplica, para um projeto."
  def live_agents(project_id) do
    Map.get(live_agents_by_project(), project_id, [])
  end
end
