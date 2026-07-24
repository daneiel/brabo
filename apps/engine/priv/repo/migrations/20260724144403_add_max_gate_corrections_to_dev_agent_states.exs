defmodule Engine.Repo.Migrations.AddMaxGateCorrectionsToDevAgentStates do
  use Ecto.Migration

  # Teto de correções dev<->gate (QA/SecOps, Fase 4a) — configurável na
  # ativação, repassado pra api a cada `POST gates/verdict` (nulo usa o
  # default da api, DEFAULT_MAX_GATE_CORRECTIONS).
  def change do
    alter table(:dev_agent_states, prefix: "engine") do
      add :max_gate_corrections, :integer
    end
  end
end
