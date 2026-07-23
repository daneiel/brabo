defmodule Engine.Repo.Migrations.CreateEngineSchema do
  use Ecto.Migration

  # Cria o schema Postgres dedicado ao engine. As tabelas de domínio do
  # engine (Oban incluso — ver migration_default_prefix em
  # config/config.exs) vivem aqui, nunca em "public", para nunca colidir
  # com as tabelas de domínio da api no mesmo banco. A tabela
  # schema_migrations do próprio Ecto continua em "public" — é o padrão
  # do Ecto e não colide por nome com nada da api (Drizzle rastreia suas
  # migrações em __drizzle_migrations, num schema "drizzle" à parte).
  def up do
    execute("CREATE SCHEMA IF NOT EXISTS engine")
  end

  def down do
    execute("DROP SCHEMA IF EXISTS engine CASCADE")
  end
end
