import Config

# Force using SSL in production. This also sets the "strict-security-transport" header,
# known as HSTS. If you have a health check endpoint, you may want to exclude it below.
# Note `:force_ssl` is required to be set at compile-time.
config :engine, EngineWeb.Endpoint,
  force_ssl: [
    rewrite_on: [:x_forwarded_proto],
    exclude: [
      # Probes, scrape e o tráfego interno api->engine. A lista de caminhos
      # exatos do `paths:` não serve para `/internal/*` (são mais de vinte
      # rotas e a comparação é exata), então a decisão vira uma função — ver
      # EngineWeb.ForceSslExclusions para o porquê de cada exclusão.
      conn: {EngineWeb.ForceSslExclusions, :exclude?, []},
      hosts: ["localhost", "127.0.0.1"]
    ]
  ]

# Do not print debug messages in production
config :logger, level: :info

# Log JSON com trace_id (Fase 5, item 6). Só em :prod — em desenvolvimento o
# formato legível vale mais que o parseável, e a suite não deve virar JSON.
config :logger, :default_handler, formatter: {Engine.Telemetry.JsonLogFormatter, %{}}

# Runtime production configuration, including reading
# of environment variables, is done on config/runtime.exs.
