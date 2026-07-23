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

# We don't run a server during test. If one is required,
# you can enable the server option below.
config :engine, EngineWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: 4002],
  secret_key_base: "fV+i+3IClmiwdtLIM5mSKmMC76GsORgjHVEc6pZ/bMoPzY6XCu1gg/4FUVzU2Bfw",
  server: false

# Print only warnings and errors during test
config :logger, level: :warning

# Initialize plugs at runtime for faster test compilation
config :phoenix, :plug_init_mode, :runtime

# Sort query params output of verified routes for robust url comparisons
config :phoenix,
  sort_verified_routes_query_params: true
