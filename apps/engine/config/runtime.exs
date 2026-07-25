import Config

# config/runtime.exs is executed for all environments, including
# during releases. It is executed after compilation and before the
# system starts, so it is typically used to load production configuration
# and secrets from environment variables or elsewhere. Do not define
# any compile-time configuration in here, as it won't be applied.
# The block below contains prod specific runtime configuration.

# ## Using releases
#
# If you use `mix release`, you need to explicitly enable the server
# by passing the PHX_SERVER=true when you start it:
#
#     PHX_SERVER=true bin/engine start
#
# Alternatively, you can use `mix phx.gen.release` to generate a `bin/server`
# script that automatically sets the env var above.
if System.get_env("PHX_SERVER") do
  config :engine, EngineWeb.Endpoint, server: true
end

config :engine, EngineWeb.Endpoint,
  http: [port: String.to_integer(System.get_env("PORT", "4000"))]

# Comunicação engine -> api (evento de término e psychologist.hypothesis,
# ver Engine.Sessions.Monitor/EngineApiClient), e engine <- api (comando
# síncrono de criar sessão, ver EngineWeb.Plugs.VerifyApiToken).
config :engine,
  keycloak_url: System.get_env("KEYCLOAK_URL", "http://localhost:8080"),
  keycloak_realm: System.get_env("KEYCLOAK_REALM", "brabo-dev"),
  engine_keycloak_client_id: System.get_env("ENGINE_KEYCLOAK_CLIENT_ID", "engine-service"),
  engine_keycloak_client_secret:
    System.get_env("ENGINE_KEYCLOAK_CLIENT_SECRET", "engine-service-dev-secret-change-me"),
  api_url: System.get_env("API_URL", "http://localhost:3000"),
  api_keycloak_client_id: System.get_env("API_KEYCLOAK_CLIENT_ID", "api-service"),
  session_heartbeat_timeout_ms:
    String.to_integer(System.get_env("SESSION_HEARTBEAT_TIMEOUT_MS", "30000")),
  # Diretório compartilhado com a api (mesmo path, mesmo volume Docker) —
  # permissions.json mora em <root>/<project_id>/permissions.json; o
  # executor de terminal faz o checkout do working tree no mesmo lugar.
  project_workspaces_root:
    System.get_env("PROJECT_WORKSPACES_ROOT", "/tmp/brabo-project-workspaces"),
  terminal_action_timeout_ms:
    String.to_integer(System.get_env("TERMINAL_ACTION_TIMEOUT_MS", "15000")),
  # Teto por scanner de segurança (gitleaks/semgrep) nos gates de SecOps.
  # Bem mais folgado que o terminal: o semgrep varre a árvore inteira e pode
  # baixar regras da rede (`--config auto`). Sem esse teto, um scanner
  # pendurado congela o gate do projeto (ver Engine.Gates.Scanner).
  secops_scan_timeout_ms:
    String.to_integer(System.get_env("SECOPS_SCAN_TIMEOUT_MS", "180000")),
  # Harness — ToolLoop / ContextManager (Fase 3a, sessão 2).
  tool_loop_max_iterations: String.to_integer(System.get_env("TOOL_LOOP_MAX_ITERATIONS", "8")),
  # Um turno de LLM não é uma chamada de API comum: com modelo local o
  # PRIMEIRO turno ainda carrega os pesos na memória antes do primeiro token.
  # No default do Req isso estoura e a task morre bloqueada sem diagnóstico.
  llm_turn_timeout_ms: String.to_integer(System.get_env("LLM_TURN_TIMEOUT_MS", "300000")),
  # % do limite do modelo a partir do qual o ContextManager compacta.
  context_compaction_threshold:
    String.to_float(System.get_env("CONTEXT_COMPACTION_THRESHOLD", "0.7")),
  # Janela de contexto assumida quando o modelo não informa uma.
  default_context_window: String.to_integer(System.get_env("DEFAULT_CONTEXT_WINDOW", "8192")),
  # Agentes de fundo (Psicólogo via outbox, Anamnese periódica) competem por
  # turnos de LLM com os agentes de execução. Com provider local de um modelo
  # só, essa disputa derruba a conexão do dev no meio do ciclo. Desligáveis por
  # ambiente pra rodar o critério de aceite numa máquina apertada — default
  # ligado, sem mudança de comportamento.
  start_outbox_drain?: System.get_env("START_OUTBOX_DRAIN", "true") == "true",
  start_anamnese?: System.get_env("START_ANAMNESE", "true") == "true"

if config_env() == :prod do
  database_url =
    System.get_env("DATABASE_URL") ||
      raise """
      environment variable DATABASE_URL is missing.
      For example: ecto://USER:PASS@HOST/DATABASE
      """

  maybe_ipv6 = if System.get_env("ECTO_IPV6") in ~w(true 1), do: [:inet6], else: []

  config :engine, Engine.Repo,
    # ssl: true,
    url: database_url,
    pool_size: String.to_integer(System.get_env("POOL_SIZE") || "10"),
    # For machines with several cores, consider starting multiple pools of `pool_size`
    # pool_count: 4,
    socket_options: maybe_ipv6

  # The secret key base is used to sign/encrypt cookies and other secrets.
  # A default value is used in config/dev.exs and config/test.exs but you
  # want to use a different value for prod and you most likely don't want
  # to check this value into version control, so we use an environment
  # variable instead.
  secret_key_base =
    System.get_env("SECRET_KEY_BASE") ||
      raise """
      environment variable SECRET_KEY_BASE is missing.
      You can generate one by calling: mix phx.gen.secret
      """

  host = System.get_env("PHX_HOST") || "example.com"

  config :engine, :dns_cluster_query, System.get_env("DNS_CLUSTER_QUERY")

  config :engine, EngineWeb.Endpoint,
    url: [host: host, port: 443, scheme: "https"],
    http: [
      # Enable IPv6 and bind on all interfaces.
      # Set it to  {0, 0, 0, 0, 0, 0, 0, 1} for local network only access.
      # See the documentation on https://bandit.hexdocs.pm/Bandit.html#t:options/0
      # for details about using IPv6 vs IPv4 and loopback vs public addresses.
      ip: {0, 0, 0, 0, 0, 0, 0, 0}
    ],
    secret_key_base: secret_key_base

  # ## SSL Support
  #
  # To get SSL working, you will need to add the `https` key
  # to your endpoint configuration:
  #
  #     config :engine, EngineWeb.Endpoint,
  #       https: [
  #         ...,
  #         port: 443,
  #         cipher_suite: :strong,
  #         keyfile: System.get_env("SOME_APP_SSL_KEY_PATH"),
  #         certfile: System.get_env("SOME_APP_SSL_CERT_PATH")
  #       ]
  #
  # The `cipher_suite` is set to `:strong` to support only the
  # latest and more secure SSL ciphers. This means old browsers
  # and clients may not be supported. You can set it to
  # `:compatible` for wider support.
  #
  # `:keyfile` and `:certfile` expect an absolute path to the key
  # and cert in disk or a relative path inside priv, for example
  # "priv/ssl/server.key". For all supported SSL configuration
  # options, see https://plug.hexdocs.pm/Plug.SSL.html#configure/1
  #
  # We also recommend setting `force_ssl` in your config/prod.exs,
  # ensuring no data is ever sent via http, always redirecting to https:
  #
  #     config :engine, EngineWeb.Endpoint,
  #       force_ssl: [hsts: true]
  #
  # Check `Plug.SSL` for all available options in `force_ssl`.
end
