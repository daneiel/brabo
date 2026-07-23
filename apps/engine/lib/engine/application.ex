defmodule Engine.Application do
  # See https://elixir.hexdocs.pm/Application.html
  # for more information on OTP Applications
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    children = [
      EngineWeb.Telemetry,
      Engine.Repo,
      {DNSCluster, query: Application.get_env(:engine, :dns_cluster_query) || :ignore},
      {Phoenix.PubSub, name: Engine.PubSub},
      {Oban, Application.fetch_env!(:engine, Oban)},
      # Start a worker by calling: Engine.Worker.start_link(arg)
      # {Engine.Worker, arg},
      # Start to serve requests, typically the last entry
      EngineWeb.Endpoint
    ]

    # See https://elixir.hexdocs.pm/Supervisor.html
    # for other strategies and supported options
    opts = [strategy: :one_for_one, name: Engine.Supervisor]
    Supervisor.start_link(children, opts)
  end

  # Tell Phoenix to update the endpoint configuration
  # whenever the application is updated.
  @impl true
  def config_change(changed, _new, removed) do
    EngineWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
