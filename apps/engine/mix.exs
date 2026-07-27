defmodule Engine.MixProject do
  use Mix.Project

  def project do
    [
      app: :engine,
      version: "0.1.0",
      elixir: "~> 1.17",
      elixirc_paths: elixirc_paths(Mix.env()),
      start_permanent: Mix.env() == :prod,
      aliases: aliases(),
      deps: deps(),
      releases: releases(),
      # O CodeReloader é ferramenta de DEV. Declarado sem guarda, ele ia junto
      # pro release de produção — onde não há código pra recarregar.
      listeners: listeners(Mix.env())
    ]
  end

  defp listeners(:prod), do: []
  defp listeners(_), do: [Phoenix.CodeReloader]

  # `mix release` (Fase 5): a imagem de produção roda o release, não o Mix —
  # `mix phx.server`/`mix ecto.migrate` não existem lá dentro. Daí o
  # `Engine.Release`, que expõe migrate/0 via `bin/engine eval`.
  defp releases do
    [
      engine: [
        include_executables_for: [:unix],
        # ERTS embarcado: o estágio final não precisa de Erlang instalado,
        # só das libs de sistema. É o que permite runtime enxuto.
        include_erts: true,
        strip_beams: true
      ]
    ]
  end

  # Configuration for the OTP application.
  #
  # Type `mix help compile.app` for more information.
  def application do
    [
      mod: {Engine.Application, []},
      extra_applications: [:logger, :runtime_tools]
    ]
  end

  def cli do
    [
      preferred_envs: [precommit: :test]
    ]
  end

  # Specifies which paths to compile per environment.
  defp elixirc_paths(:test), do: ["lib", "test/support"]
  defp elixirc_paths(_), do: ["lib"]

  # Specifies your project dependencies.
  #
  # Type `mix help deps` for examples and options.
  defp deps do
    [
      {:phoenix, "~> 1.8.9"},
      {:phoenix_ecto, "~> 4.5"},
      {:ecto_sql, "~> 3.13"},
      {:postgrex, ">= 0.0.0"},
      {:telemetry_metrics, "~> 1.0"},
      {:telemetry_poller, "~> 1.0"},
      # Só o agregador + scrape/1; a rota /metrics é do router que já existe.
      # PromEx traria plug e servidor HTTP próprios mais um uploader de
      # dashboards do Grafana — que é o item 5 da Fase 5, sessão seguinte.
      {:telemetry_metrics_prometheus_core, "~> 1.2"},
      {:gettext, "~> 1.0"},
      {:jason, "~> 1.2"},
      {:dns_cluster, "~> 0.2.0"},
      {:bandit, "~> 1.5"},
      {:oban, "~> 2.23"},
      {:req, "~> 0.5"},
      # OpenTelemetry (Fase 5, item 3). Justificativa por pacote:
      #   opentelemetry_api      — API de span, o que o código de domínio usa
      #   opentelemetry          — SDK, o que amostra e agrega
      #   opentelemetry_exporter — exporta OTLP para o Collector
      #   opentelemetry_ecto     — span por query, sem tocar repositório
      #   opentelemetry_oban     — propaga contexto do insert do job para a
      #                            execução dele, que é o elo assíncrono da
      #                            trace de uma sessão
      #   opentelemetry_bandit / _phoenix — span por requisição HTTP recebida,
      #                            e é por ela que o contexto vindo da api entra
      {:opentelemetry_api, "~> 1.4"},
      {:opentelemetry, "~> 1.5"},
      {:opentelemetry_exporter, "~> 1.8"},
      {:opentelemetry_ecto, "~> 1.2"},
      {:opentelemetry_oban, "~> 1.1"},
      {:opentelemetry_bandit, "~> 0.2"},
      {:opentelemetry_phoenix, "~> 2.0"},
      # Auditoria de dependências no CI (Fase 5, item 7).
      #
      # `mix hex.audit`, que vem com o Hex, reporta pacote APOSENTADO (retired)
      # — não vulnerabilidade. Sozinho, o gate do engine seria decorativo:
      # nenhuma CVE reprovaria o build. O mix_audit lê a base de advisories de
      # segurança do Elixir e é o que de fato detecta CVE em dependência.
      # Os dois rodam no job `audit`; são perguntas diferentes.
      {:mix_audit, "~> 2.1", only: [:dev, :test], runtime: false}
    ]
  end

  # Aliases are shortcuts or tasks specific to the current project.
  # For example, to install project dependencies and perform other setup tasks, run:
  #
  #     $ mix setup
  #
  # See the documentation for `Mix` for more info on aliases.
  defp aliases do
    [
      setup: ["deps.get", "ecto.setup"],
      "ecto.setup": ["ecto.create", "ecto.migrate", "run priv/repo/seeds.exs"],
      "ecto.reset": ["ecto.drop", "ecto.setup"],
      test: ["ecto.create --quiet", "ecto.migrate --quiet", "test"],
      precommit: ["compile --warnings-as-errors", "deps.unlock --unused", "format", "test"]
    ]
  end
end
