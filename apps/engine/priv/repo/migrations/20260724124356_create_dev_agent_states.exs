defmodule Engine.Repo.Migrations.CreateDevAgentStates do
  use Ecto.Migration

  # Estado durável dos dev agents (Fase 4a) no schema "engine" — rede de
  # segurança pra reidratação (mesmo papel de session_states). Chave composta
  # {project_id, agent_id}. Ao terminar, a linha é deletada.
  def change do
    create table(:dev_agent_states, primary_key: false, prefix: "engine") do
      add :project_id, :string, null: false, primary_key: true
      add :agent_id, :string, null: false, primary_key: true
      add :module, :string, null: false
      add :session_id, :string, null: false
      add :task_id, :string
      add :worktree_path, :string
      add :status, :string, null: false, default: "working"

      timestamps(type: :utc_datetime_usec)
    end
  end
end
