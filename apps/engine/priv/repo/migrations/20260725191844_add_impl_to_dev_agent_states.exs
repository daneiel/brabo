defmodule Engine.Repo.Migrations.AddImplToDevAgentStates do
  use Ecto.Migration

  # Qual implementação de dev agent a linha representa (Fase 4a): "real"
  # (ToolLoop + LLM) ou "noop" (NoopDevAgentServer, sem LLM — smoke test da
  # infraestrutura). Precisa ser durável porque a reidratação no boot é quem
  # escolhe o módulo a subir: sem isso, um Noop voltaria como agente REAL
  # depois de um restart do nó. Linhas anteriores à coluna são "real".
  def change do
    alter table(:dev_agent_states, prefix: "engine") do
      add :impl, :string, null: false, default: "real"
    end
  end
end
