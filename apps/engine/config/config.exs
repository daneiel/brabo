# This file is responsible for configuring your application
# and its dependencies with the aid of the Config module.
#
# This configuration file is loaded before any dependency and
# is restricted to this project.

# General application configuration
import Config

config :engine,
  ecto_repos: [Engine.Repo],
  generators: [timestamp_type: :utc_datetime]

# O engine roda no MESMO Postgres que a api (apps/api, via Drizzle), mas
# as tabelas de domínio do engine (e as do Oban) vivem no schema "engine"
# — nunca em "public" — para nunca colidir com as tabelas de domínio da
# api. migration_default_prefix vale para `table(...)` sem prefix
# explícito nas migrations; schema_migrations em si continua em "public"
# (comportamento padrão do Ecto — só rastreia versão, nunca colide por
# nome com nada da api).
config :engine, Engine.Repo, migration_default_prefix: "engine"

config :engine, Oban,
  engine: Oban.Engines.Basic,
  repo: Engine.Repo,
  prefix: "engine",
  queues: [default: 10],
  plugins: [Oban.Plugins.Pruner]

# Configure the endpoint
config :engine, EngineWeb.Endpoint,
  url: [host: "localhost"],
  adapter: Bandit.PhoenixAdapter,
  render_errors: [
    formats: [json: EngineWeb.ErrorJSON],
    layout: false
  ],
  pubsub_server: Engine.PubSub,
  live_view: [signing_salt: "F3rONsq2"]

# Configure Elixir's Logger
config :logger, :default_formatter,
  format: "$time $metadata[$level] $message\n",
  metadata: [:request_id]

# Use Jason for JSON parsing in Phoenix
config :phoenix, :json_library, Jason

# Import environment specific config. This must remain at the bottom
# of this file so it overrides the configuration defined above.
import_config "#{config_env()}.exs"
