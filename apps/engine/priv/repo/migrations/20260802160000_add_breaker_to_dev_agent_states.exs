defmodule Engine.Repo.Migrations.AddBreakerToDevAgentStates do
  use Ecto.Migration

  # Circuit breaker por agente (Fase 12b, RN-047): quantas tasks TERMINARAM
  # blocked em sequência, e o teto que dispara `idle_tripped`. As duas
  # chegam juntas — são as duas metades do mesmo mecanismo, diferente do
  # padrão de uma coluna por migração usado pra adições NÃO relacionadas.
  def change do
    alter table(:dev_agent_states, prefix: "engine") do
      add :consecutive_blocked, :integer, null: false, default: 0
      add :max_consecutive_blocked, :integer
    end
  end
end
