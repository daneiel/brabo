import Config

# Force using SSL in production. This also sets the "strict-security-transport" header,
# known as HSTS. If you have a health check endpoint, you may want to exclude it below.
# Note `:force_ssl` is required to be set at compile-time.
config :engine, EngineWeb.Endpoint,
  force_ssl: [
    rewrite_on: [:x_forwarded_proto],
    exclude: [
      # As probes do kubelet e o scrape do Prometheus chegam pelo IP DO POD,
      # não por localhost — a exclusão por host não os cobre. Sem estes paths
      # aqui, /live e /ready respondem 301 para https:// e o pod nunca fica
      # Ready. Nenhum deles carrega dado sensível nem aceita escrita.
      paths: ["/health", "/live", "/ready", "/metrics"],
      hosts: ["localhost", "127.0.0.1"]
    ]
  ]

# Do not print debug messages in production
config :logger, level: :info

# Runtime production configuration, including reading
# of environment variables, is done on config/runtime.exs.
