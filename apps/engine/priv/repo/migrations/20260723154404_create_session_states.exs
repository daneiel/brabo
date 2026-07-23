defmodule Engine.Repo.Migrations.CreateSessionStates do
  use Ecto.Migration

  # Estado observável de cada sessão supervisionada — a única rede de
  # segurança pra reidratação se o container do engine reiniciar (o
  # Monitor morre junto, nenhum :DOWN é processado durante a queda). Sem
  # coluna de limpeza: ao terminar (qualquer causa), a linha é deletada,
  # não marcada como terminal.
  def change do
    # session_id/project_id como :string (não :binary_id) — mesma
    # convenção já usada pra actor_id/scope_id no resto do sistema:
    # às vezes é um UUID de verdade (produção), às vezes um identificador
    # arbitrário (testes) — nunca reforçado como UUID estrito aqui.
    create table(:session_states, primary_key: false) do
      add :session_id, :string, primary_key: true
      add :project_id, :string, null: false
      # "active" | "closing"
      add :status, :string, null: false
      # nullable, só observabilidade (ex. "heartbeat_timeout")
      add :closing_cause, :string

      timestamps(type: :utc_datetime_usec)
    end
  end
end
