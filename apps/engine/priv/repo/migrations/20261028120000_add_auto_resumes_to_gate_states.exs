defmodule Engine.Repo.Migrations.AddAutoResumesToGateStates do
  use Ecto.Migration

  # AT-582 (L4): teto de 1 retomada automática por ciclo de gate, no boot e no
  # tick. Contador por linha; a linha some quando o ciclo termina.
  def change do
    alter table(:gate_states, prefix: "engine") do
      add :auto_resumes, :integer, null: false, default: 0
    end
  end
end
