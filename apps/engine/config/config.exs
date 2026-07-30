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

# Lifeline é o que faz "kill do engine gera análise pós-restart" (Fase 4b)
# ser verdade. Com o Oban.Engines.Basic, um job SIGKILLado enquanto estava
# `executing` não volta sozinho: o nó morreu sem marcar desfecho, então a
# linha fica órfã em `executing` para sempre e o max_attempts do worker
# nunca é exercido. O Lifeline devolve órfãos para `available` depois de
# `rescue_after`, e aí a retentativa normal acontece.
#
# Vale para TODOS os workers de propósito (Psicólogo, Anamnese, drain do
# outbox) — a orfandade é do mecanismo, não de um worker.
config :engine, Oban,
  engine: Oban.Engines.Basic,
  repo: Engine.Repo,
  prefix: "engine",
  queues: [default: 10],
  # Explícito, e maior que o default de 15s: o drain do preStop (Fase 5) já
  # consumiu parte do terminationGracePeriodSeconds antes de o SIGTERM chegar,
  # e um job cortado no meio só volta depois do `rescue_after` do Lifeline
  # (5 min). Dar 25s ao Oban aumenta a chance de o job terminar sozinho.
  shutdown_grace_period: :timer.seconds(25),
  plugins: [
    Oban.Plugins.Pruner,
    {Oban.Plugins.Lifeline, rescue_after: :timer.minutes(5)}
  ]

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
#
# A lista de metadata cresceu no ADR 0035: `session_id` e `trace_id` são os dois
# ids por onde se caça qualquer coisa neste sistema, e `layer` acompanha o caminho
# entre camadas do lado da api. Sem estarem aqui, `Logger.metadata(session_id:)`
# não aparece na saída da suite nem em `$metadata`.
config :logger, :default_formatter,
  format: "$time $metadata[$level] $message\n",
  metadata: [:request_id, :session_id, :trace_id, :layer]

# Use Jason for JSON parsing in Phoenix
config :phoenix, :json_library, Jason

# Import environment specific config. This must remain at the bottom
# of this file so it overrides the configuration defined above.
import_config "#{config_env()}.exs"
