defmodule Engine.Dev.DevRehydrator do
  @moduledoc """
  Boot task: recria os dev agents sobreviventes de um boot anterior a partir de
  `dev_agent_states` (mesmo idioma do Engine.Sessions.Rehydrator). Rehydration
  NÃO redispara o ciclo `:work` — nenhum `GenServer.cast(:work, ...)` é feito
  daqui; um novo CLAIM é decisão de quem reativa a execução.

  Isso não quer dizer que o agente volta em branco (Fase 12b-6): `resume`
  carrega `task_id`/`worktree_path`/`status`/`consecutive_blocked`, e é
  `DevAgentServer.init/1` — não este módulo — quem decide o que fazer com
  cada estado (retomar `awaiting_gate` intacto, bloquear um `working`
  interrompido, etc.). Este módulo só entrega a linha; a lógica de
  reidratação inteira mora no agente.

  O modo (`impl`) vem da linha durável: um NoopDevAgent tem que voltar Noop
  depois de um restart do nó, não virar agente real.
  """

  alias Engine.Dev.{DevAgentState, DevAgentSupervisor}
  alias Engine.Readiness

  def run do
    DevAgentState.list_all()
    |> Enum.each(fn s ->
      resume = %{
        task_id: s.task_id,
        worktree_path: s.worktree_path,
        status: s.status,
        consecutive_blocked: s.consecutive_blocked
      }

      DevAgentSupervisor.start_agent(
        s.project_id,
        s.agent_id,
        s.module,
        s.session_id,
        s.task_budget_micros,
        s.max_gate_corrections,
        s.impl,
        s.max_consecutive_blocked,
        resume
      )
    end)

    Readiness.mark(:dev_agents)
  end

  def start_link(_opts) do
    :ok = run()
    :ignore
  end

  def child_spec(_opts) do
    %{id: __MODULE__, start: {__MODULE__, :start_link, [[]]}, restart: :transient}
  end
end
