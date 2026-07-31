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

# Exportação de span: só com coletor (ADR 0035).
#
# Fora daqui nada desliga o exportador — o default do `otel_configuration` é
# `{opentelemetry_exporter, %{}}`, que aponta para `localhost:4318`. Então em
# qualquer ambiente sem `OTEL_EXPORTER_OTLP_ENDPOINT` (release mal configurado,
# `mix phx.server` fora do compose) o engine gastaria um batch condenado a cada
# ciclo. Instrumentação e contexto seguem ligados: o que se desliga é só a saída.
#
# Vale para todos os ambientes de propósito. Em dev e test a config de compilação
# já pôs `:none`, e reafirmar aqui é inofensivo.
if System.get_env("OTEL_EXPORTER_OTLP_ENDPOINT") in [nil, ""] do
  config :opentelemetry, traces_exporter: :none
end

# Origens de navegador aceitas, num lugar só (ADR 0037).
#
# `WEB_ORIGIN` é a MESMA variável que a api usa para o CORS dela. Ela alimenta
# duas coisas aqui: o `EngineWeb.Plugs.Cors` das rotas de health, e o
# `check_origin` do socket mais abaixo. Estavam separados, e o `check_origin` era
# o único a ler a variável — foi assim que o CORS do `/health` ficou sem nenhuma
# origem por dois ciclos inteiros sem ninguém notar.
#
# Em produção NÃO há default de desenvolvimento. A api levanta exceção no boot
# nesse caso; aqui a lista fica vazia, o que fecha o acesso de navegador sem
# derrubar o engine — CORS não é função dele (filas do Oban e canais seguem
# funcionando), e um engine que não sobe por causa disso troca um painel de status
# quebrado por um sistema parado.
web_origins =
  case System.get_env("WEB_ORIGIN") do
    vazio when vazio in [nil, ""] ->
      if config_env() == :prod, do: [], else: ["http://localhost:5173"]

    origens ->
      origens |> String.split(",", trim: true) |> Enum.map(&String.trim/1)
  end

config :engine, :web_origins, web_origins

# Comunicação engine -> api (evento de término e psychologist.hypothesis,
# ver Engine.Sessions.Monitor/EngineApiClient), e engine <- api (comando
# síncrono de criar sessão, ver EngineWeb.Plugs.VerifyServiceToken). Desde a
# Fase 7a os dois sentidos usam o MESMO segredo compartilhado.
config :engine,
  service_token: System.get_env("BRABO_SERVICE_TOKEN", "dev-service-token-change-me"),
  service_token_previous: System.get_env("BRABO_SERVICE_TOKEN_PREVIOUS"),
  api_url: System.get_env("API_URL", "http://localhost:3000"),
  session_heartbeat_timeout_ms:
    String.to_integer(System.get_env("SESSION_HEARTBEAT_TIMEOUT_MS", "30000")),
  # Quanto o drain do preStop espera para que outra réplica adote as sessões
  # deste nó antes de encerrá-las com causa node_shutdown. Precisa caber
  # FOLGADAMENTE dentro do terminationGracePeriodSeconds do Deployment (90s),
  # porque depois dele ainda há o teardown do BEAM.
  shutdown_drain_timeout_ms:
    String.to_integer(System.get_env("SHUTDOWN_DRAIN_TIMEOUT_MS", "45000")),
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
  secops_scan_timeout_ms: String.to_integer(System.get_env("SECOPS_SCAN_TIMEOUT_MS", "180000")),
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
  start_anamnese?: System.get_env("START_ANAMNESE", "true") == "true",
  # Triagem de custo do Psicólogo (Fase 4b) — abaixo do limiar a sessão é
  # analisada pelo agente `psicologo-leve` (modelo barato, tetos menores).
  # Os defaults são os valores do ADR 0015; ficam aqui, e não como atributo
  # de módulo, pra o operador poder apertar o custo por ambiente sem
  # recompilar — mesmo tratamento dos outros knobs do harness acima.
  psychologist_triage_threshold:
    String.to_integer(System.get_env("PSYCHOLOGIST_TRIAGE_THRESHOLD", "20")),
  psychologist_max_iterations_leve:
    String.to_integer(System.get_env("PSYCHOLOGIST_MAX_ITERATIONS_LEVE", "4")),
  psychologist_max_iterations_pesada:
    String.to_integer(System.get_env("PSYCHOLOGIST_MAX_ITERATIONS_PESADA", "8")),
  psychologist_budget_micros_leve:
    String.to_integer(System.get_env("PSYCHOLOGIST_BUDGET_MICROS_LEVE", "50000")),
  psychologist_budget_micros_pesada:
    String.to_integer(System.get_env("PSYCHOLOGIST_BUDGET_MICROS_PESADA", "300000")),
  # Teto de eventos e de tamanho de payload que entram no prompt. O log vai
  # numa mensagem pinned (que o ContextManager nunca compacta, pra não
  # perder os ids que a evidência cita), então quem protege a janela é este
  # corte — ver Engine.Psychologist.Triage.max_prompt_events/1.
  psychologist_max_prompt_events_leve:
    String.to_integer(System.get_env("PSYCHOLOGIST_MAX_PROMPT_EVENTS_LEVE", "50")),
  psychologist_max_prompt_events_pesada:
    String.to_integer(System.get_env("PSYCHOLOGIST_MAX_PROMPT_EVENTS_PESADA", "400")),
  psychologist_max_payload_chars:
    String.to_integer(System.get_env("PSYCHOLOGIST_MAX_PAYLOAD_CHARS", "600")),
  # Anamnese (Fase 4b) — mesma racional dos knobs do Psicólogo acima: teto de
  # custo é coisa que o operador aperta por ambiente, não constante de código.
  # O tick é global e faz fan-out por projeto (ver AnamneseSchedulerWorker).
  anamnese_interval_seconds:
    String.to_integer(System.get_env("ANAMNESE_INTERVAL_SECONDS", "900")),
  anamnese_initial_window_days:
    String.to_integer(System.get_env("ANAMNESE_INITIAL_WINDOW_DAYS", "30")),
  anamnese_min_events: String.to_integer(System.get_env("ANAMNESE_MIN_EVENTS", "10")),
  anamnese_max_iterations: String.to_integer(System.get_env("ANAMNESE_MAX_ITERATIONS", "6")),
  anamnese_budget_micros: String.to_integer(System.get_env("ANAMNESE_BUDGET_MICROS", "200000")),
  anamnese_max_prompt_events:
    String.to_integer(System.get_env("ANAMNESE_MAX_PROMPT_EVENTS", "500")),
  anamnese_max_payload_chars:
    String.to_integer(System.get_env("ANAMNESE_MAX_PAYLOAD_CHARS", "600"))

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

  # Em :prod o default do Phoenix pra `check_origin` é comparar a origem do
  # websocket com o `url: [host: ...]` abaixo — ou seja, com PHX_HOST. O painel
  # do time ao vivo (Fase 4a item 7) fala por canal Phoenix a partir do web, que
  # é servido de OUTRA origem (nginx em outra porta/host), então o handshake é
  # recusado e o painel fica mudo sem erro visível no servidor.
  #
  # A lista sai de `web_origins`, calculada uma vez no topo deste arquivo e
  # compartilhada com o `EngineWeb.Plugs.Cors` — a duplicação da leitura de
  # `WEB_ORIGIN` era o que permitia os dois divergirem (ADR 0037).
  #
  # Lista vazia significa `WEB_ORIGIN` ausente em produção: aí vale o default
  # ESTRITO do Phoenix (`true`, que compara com o `PHX_HOST` abaixo), nunca `[]` —
  # que o Phoenix leria como "nenhuma origem confere" e derrubaria o painel do
  # time ao vivo em vez de só o CORS do health.
  check_origin = if web_origins == [], do: true, else: web_origins

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
    check_origin: check_origin,
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
