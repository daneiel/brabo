import Config

# Configure your database
#
# The MIX_TEST_PARTITION environment variable can be used
# to provide built-in test partitioning in CI environment.
# Run `mix help test` for more information.
config :engine, Engine.Repo,
  username: System.get_env("POSTGRES_USER", "brabo"),
  password: System.get_env("POSTGRES_PASSWORD", "brabo"),
  hostname: System.get_env("POSTGRES_HOST", "localhost"),
  database: "engine_test#{System.get_env("MIX_TEST_PARTITION")}",
  pool: Ecto.Adapters.SQL.Sandbox,
  pool_size: System.schedulers_online() * 2

# Gate de testabilidade: o drain da outbox roda como job Oban
# auto-reagendado, indesejável em testes determinísticos — os testes
# chamam Engine.Outbox.Drain.run_once/0 diretamente.
config :engine, start_outbox_drain?: false
config :engine, start_anamnese?: false
config :engine, start_model_sync?: false
config :engine, start_gate_rescue?: false
config :engine, Oban, testing: :manual

# O poller roda fora da Sandbox do Ecto: cada ciclo viraria um aviso de
# ownership a cada 10s durante a suite inteira. Os testes chamam
# `Engine.Telemetry.ObanQueueDepth.measure/0` direto.
config :engine, :poll_oban_queue_depth, false

# Segredo fixo do tráfego interno na suite. O plug compara com este valor;
# testes que exercitam rotação sobrescrevem via Application.put_env.
config :engine, service_token: "service-token-de-teste"

# We don't run a server during test. If one is required,
# you can enable the server option below.
config :engine, EngineWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: 4002],
  secret_key_base: "fV+i+3IClmiwdtLIM5mSKmMC76GsORgjHVEc6pZ/bMoPzY6XCu1gg/4FUVzU2Bfw",
  server: false

# Print only warnings and errors during test
config :logger, level: :warning

# Mesma separação do dev (ADR 0035): sem exportador, e sem instrumentação
# automática.
#
# A suite não tem coletor, então exportar é batch condenado. E o automático fica
# de fora aqui — e só aqui — porque `OpentelemetryEcto` cria um span por query, o
# que encareceria toda `DataCase` para nada. Span MANUAL continua funcionando com
# `trace_id` de verdade (é o que `span_test.exs` e `otel_test.exs` afirmam): isso
# não depende do automático.
config :opentelemetry, traces_exporter: :none
config :engine, otel_auto_instrumentation: false

# Initialize plugs at runtime for faster test compilation
config :phoenix, :plug_init_mode, :runtime

# Sort query params output of verified routes for robust url comparisons
config :phoenix,
  sort_verified_routes_query_params: true
