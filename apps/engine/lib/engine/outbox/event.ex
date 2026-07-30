defmodule Engine.Outbox.Event do
  @moduledoc """
  Mapeia outbox_events — tabela existente, gerenciada pela api via
  Drizzle (schema "public"). O engine só lê/atualiza `processed_at`,
  nunca roda migration própria pra essa tabela.

  @schema_prefix é o que importa em runtime aqui — migration_default_prefix
  (config de Engine.Repo) só afeta `mix ecto.gen.migration`, não query.
  """

  use Ecto.Schema

  @primary_key {:id, :binary_id, autogenerate: false}
  @schema_prefix "public"
  schema "outbox_events" do
    field :aggregate_type, :string
    field :aggregate_id, :binary_id
    field :event_type, :string
    field :payload, :map, default: %{}
    # Metadado de TRANSPORTE, separado do payload de propósito (a api grava em
    # `apps/api/src/infrastructure/persistence/drizzle/outbox.repository.ts`).
    # Carrega o `traceparent` de quem gerou o evento.
    #
    # Faltar este campo aqui foi um bug silencioso da Fase 5 até o ADR 0035: a
    # coluna existia no banco e a api gravava, mas sem a declaração o struct
    # `%Event{}` não tinha a chave `:metadata` — então a primeira cláusula de
    # `Engine.Outbox.Drain.traceparent/1` era INALCANÇÁVEL e todo job do Oban
    # nascia com `traceparent: nil`. Nada falhava; a correlação do trabalho
    # assíncrono simplesmente não existia.
    field :metadata, :map, default: %{}
    field :created_at, :utc_datetime_usec
    field :processed_at, :utc_datetime_usec
  end
end
