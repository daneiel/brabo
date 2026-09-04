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

  ## Por que a fonte de projetos é o banco, e não `File.ls(root)` (RN-109)

  Antes da RN-109 o nome de pasta de um projeto ERA o `project_id` — varrer o
  disco e tratar cada entrada como um id era uma leitura válida. Com nome de
  pasta legível (`<slug>-<8 chars>`), a pasta deixou de ser o id, e não dá
  pra voltar um pra o outro sem consultar. `Project.all_workspace_dirs/0` faz
  essa consulta — UMA, para todos os projetos, o mesmo cuidado que motivava
  ler o disco antes — e devolve `{id, workspace_dir_name}` prontos: nem esta
  função nem `WorktreeManager` precisam mais chamar `Workspace.workspace_dir/1`
  (que faria SUA PRÓPRIA consulta por projeto) para descobrir a pasta.

  ## Por que a JUNÇÃO é `Workspace.workspace_dir/2`, e não `Path.join` daqui (RN-169)

  Era `Path.join(root, dir_name)` escrito à mão — uma segunda derivação da
  mesma raiz, e o ADR 0072 a fez divergir: num projeto no modo `local` o
  localizador é o CAMINHO ABSOLUTO da pasta do usuário, e juntá-lo com a raiz
  gerenciada produz `/data/project-workspaces/home/voce/...`, que não existe.
  O efeito seria silencioso — `File.dir?` falso, projeto pulado, worktree
  órfão nunca podado. A junção passou a ser a MESMA de todo mundo.
  """

  alias Engine.Actions.Workspace
  alias Engine.Dev.DevAgentState
  alias Engine.Dev.WorktreeManager
  alias Engine.Projects.Project

  def run do
    root = Application.get_env(:engine, :project_workspaces_root)

    if root do
      live = live_agents_by_project()

      Project.all_workspace_dirs()
      |> Enum.each(fn %{id: project_id, workspace_dir_name: dir_name} ->
        work_dir = Workspace.workspace_dir(project_id, dir_name)

        if File.dir?(work_dir) do
          WorktreeManager.cleanup_orphans_at(work_dir, Map.get(live, project_id, []))
        end
      end)
    end

    :ok
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
