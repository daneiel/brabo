defmodule Engine.Dev.DevRehydrator do
  @moduledoc """
  Boot task: recria os dev agents sobreviventes de um boot anterior a partir de
  `dev_agent_states` (mesmo idioma do Engine.Sessions.Rehydrator). Rehydration
  NÃO redispara o ciclo `:work` — o agente volta vivo com seu estado; um novo
  ciclo é decisão de quem reativa a execução.

  O modo (`impl`) vem da linha durável: um NoopDevAgent tem que voltar Noop
  depois de um restart do nó, não virar agente real.
  """

  alias Engine.Dev.{DevAgentState, DevAgentSupervisor}

  def run do
    DevAgentState.list_all()
    |> Enum.each(fn s ->
      DevAgentSupervisor.start_agent(
        s.project_id,
        s.agent_id,
        s.module,
        s.session_id,
        s.task_budget_micros,
        s.max_gate_corrections,
        s.impl
      )
    end)
  end

  def start_link(_opts) do
    :ok = run()
    :ignore
  end

  def child_spec(_opts) do
    %{id: __MODULE__, start: {__MODULE__, :start_link, [[]]}, restart: :transient}
  end
end
