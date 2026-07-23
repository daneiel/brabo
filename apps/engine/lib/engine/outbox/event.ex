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
    field :created_at, :utc_datetime_usec
    field :processed_at, :utc_datetime_usec
  end
end
