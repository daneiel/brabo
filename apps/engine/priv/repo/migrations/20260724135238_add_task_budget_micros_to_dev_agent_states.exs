defmodule Engine.Repo.Migrations.AddTaskBudgetMicrosToDevAgentStates do
  use Ecto.Migration

  # Orçamento de tokens por task (Fase 4a) — configurável na ativação da
  # execução; `nil` usa o default (`ActivateExecutionUseCase`, api).
  def change do
    alter table(:dev_agent_states, prefix: "engine") do
      add :task_budget_micros, :bigint
    end
  end
end
