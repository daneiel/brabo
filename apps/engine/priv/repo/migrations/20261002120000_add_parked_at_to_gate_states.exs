defmodule Engine.Repo.Migrations.AddParkedAtToGateStates do
  use Ecto.Migration

  # ADR 0207 (RN-722): ciclo de gate parado há mais de 2 h NÃO é retomado
  # sozinho pelo `GateRescuer` — a linha é ESTACIONADA, e só um gesto humano
  # a retoma (`Engine.Gates.GateRescuer.retomar_estacionado/3`). Nulável:
  # nulo é o ciclo normal. Uma nova entrada em voo (`GateState.upsert!/1`)
  # limpa a marca.
  def change do
    alter table(:gate_states, prefix: "engine") do
      add :parked_at, :utc_datetime_usec
    end
  end
end
