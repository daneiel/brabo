defmodule Engine.Repo.Migrations.AddCredentialToRunnerSocketTickets do
  use Ecto.Migration

  # ADR 0201 (RN-685): o ticket do socket `/runner` passa a registrar QUAL
  # credencial o emitiu — a chave de dispositivo (pelo `kid`, que É o id do
  # registro, RN-475) ou o Personal Access Token. É isto que deixa a
  # revogação mirar a CHAVE e não mais o par `{projeto, usuário}` (RN-520).
  #
  # As duas colunas são NULÁVEIS, e nulo é estado legítimo, não lacuna:
  # - o ticket de `kind: "terminal"` é da aba da web, autenticada por sessão,
  #   e não tem credencial de dispositivo nenhuma;
  # - o ticket emitido por uma api ANTERIOR a esta mudança chega sem os
  #   campos durante o rollout, e a conexão dele continua caindo pelo par
  #   usuário/projeto (ver `Engine.Runners.Revogacao`).
  #
  # Aditiva e sem backfill: os tickets vivem 30s, então não há acervo a
  # migrar — o que existe hoje expira antes de alguém sentir falta da coluna.
  def change do
    alter table(:runner_socket_tickets, prefix: "engine") do
      # "device_key" | "pat" — validado em código (`SocketTicket`), mesmo
      # padrão de `kind`, sem enum no banco.
      add :credential_kind, :string
      add :credential_id, :string
    end

    # A revogação anula os tickets PENDENTES daquela credencial
    # (`SocketTicket.anular_pendentes_da_credencial/1`): é a consulta que
    # este índice atende.
    create index(:runner_socket_tickets, [:credential_kind, :credential_id], prefix: "engine")
  end
end
