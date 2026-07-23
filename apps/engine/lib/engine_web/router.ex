defmodule EngineWeb.Router do
  use EngineWeb, :router

  pipeline :api do
    plug :accepts, ["json"]
  end

  scope "/", EngineWeb do
    pipe_through :api

    get "/health", HealthController, :check
  end

  scope "/api", EngineWeb do
    pipe_through :api
  end
end
