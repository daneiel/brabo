defmodule EngineWeb.Router do
  use EngineWeb, :router

  pipeline :api do
    plug :accepts, ["json"]
  end

  pipeline :internal do
    plug :accepts, ["json"]
    plug EngineWeb.Plugs.VerifyApiToken
  end

  scope "/", EngineWeb do
    pipe_through :api

    get "/health", HealthController, :check
  end

  scope "/api", EngineWeb do
    pipe_through :api
  end

  scope "/internal", EngineWeb do
    pipe_through :internal

    post "/sessions", SessionCommandController, :create
    post "/actions/execute", ActionCommandController, :execute
  end
end
