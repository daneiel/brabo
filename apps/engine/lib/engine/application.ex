defmodule Engine.Application do
  # See https://elixir.hexdocs.pm/Application.html
  # for more information on OTP Applications
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    children =
      [
        EngineWeb.Telemetry,
        Engine.Repo,
        {DNSCluster, query: Application.get_env(:engine, :dns_cluster_query) || :ignore},
        {Phoenix.PubSub, name: Engine.PubSub},
        {Task.Supervisor, name: Engine.TaskSupervisor},
        {Oban, Application.fetch_env!(:engine, Oban)},
        {Registry, keys: :unique, name: Engine.Sessions.Registry},
        Engine.Sessions.Monitor,
        Engine.Sessions.SessionSupervisor
      ] ++ outbox_poller_children() ++ [EngineWeb.Endpoint]

    # See https://elixir.hexdocs.pm/Supervisor.html
    # for other strategies and supported options
    opts = [strategy: :one_for_one, name: Engine.Supervisor]
    Supervisor.start_link(children, opts)
  end

  # Desligável em teste (config :engine, start_outbox_poller?: false) —
  # os testes chamam Engine.Outbox.Poller.run_once/0 direto, sem timer.
  defp outbox_poller_children do
    if Application.get_env(:engine, :start_outbox_poller?, true) do
      [Engine.Outbox.Poller]
    else
      []
    end
  end

  # Tell Phoenix to update the endpoint configuration
  # whenever the application is updated.
  @impl true
  def config_change(changed, _new, removed) do
    EngineWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
