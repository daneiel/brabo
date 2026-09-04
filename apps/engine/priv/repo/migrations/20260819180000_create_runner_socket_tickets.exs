defmodule Engine.Repo.Migrations.CreateRunnerSocketTickets do
  use Ecto.Migration

  # Ticket opaco de uso único que autentica `connect/3` de
  # `EngineWeb.RunnerSocket` (replica o padrão RN-108 de
  # `session_socket_tickets` — ver `Engine.Sessions.SocketTicket` — mas
  # ESCOPADO POR PROJETO em vez de por sessão: o runner/terminal não têm
  # sessão de chat associada, são por PROJETO).
  #
  # Diferença estrutural do irmão: `session_socket_tickets` é tabela da api
  # (Drizzle, schema "public") e a api ESCREVE nela diretamente; esta tabela é
  # OWNED pelo próprio engine (schema "engine", mesma convenção de
  # `session_states`/`gate_states`) porque é o ENGINE quem gera e guarda o
  # ticket — a api não tem (e não deveria ter) acesso de escrita ao schema do
  # engine, então ela PEDE o ticket por HTTP interno
  # (`POST /internal/projects/:projectId/runner-tickets`) em vez de inserir
  # direto.
  def change do
    create table(:runner_socket_tickets, primary_key: false, prefix: "engine") do
      # :string, não :binary_id — mesma convenção do resto do schema "engine"
      # (ver comentário em create_session_states.exs): gerado em código
      # (Ecto.UUID.generate/0), sem depender de extensão de geração de uuid
      # no Postgres.
      add :id, :string, primary_key: true
      add :project_id, :string, null: false
      add :user_id, :string, null: false
      # "runner" (o CLI na máquina do usuário — no máximo UM por projeto,
      # garantido pelo `:global` de `Engine.Runners.Registry`, não por
      # constraint aqui) ou "terminal" (a web assistindo/interagindo,
      # vários simultâneos).
      add :kind, :string, null: false
      add :ticket_hash, :string, null: false
      add :expires_at, :utc_datetime_usec, null: false
      # Uso único — o engine marca atomicamente (UPDATE condicional, mesmo
      # padrão de `session_socket_tickets.consumed_at`).
      add :consumed_at, :utc_datetime_usec
      add :created_at, :utc_datetime_usec, null: false
    end

    create unique_index(:runner_socket_tickets, [:ticket_hash], prefix: "engine")
    create index(:runner_socket_tickets, [:project_id], prefix: "engine")
    # A poda apaga por tempo — mesmo padrão de `session_socket_tickets_expires_idx`.
    create index(:runner_socket_tickets, [:expires_at], prefix: "engine")
  end
end
