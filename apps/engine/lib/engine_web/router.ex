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
    post "/actions/execute-git", ActionCommandController, :execute_git

    post "/sessions/:sessionId/agent/start", AgentCommandController, :start
    post "/sessions/:sessionId/agent/message", AgentCommandController, :message
    post "/sessions/:sessionId/agent/readiness", AgentCommandController, :readiness

    post "/sessions/:sessionId/agent/offer-infra-handoff",
         AgentCommandController,
         :offer_infra_handoff

    post "/sessions/:sessionId/execution/start", ExecutionCommandController, :start
    post "/sessions/:sessionId/execution/parallelize", ExecutionCommandController, :parallelize

    post "/sessions/:sessionId/psychologist/reanalyze",
         PsychologistCommandController,
         :reanalyze

    post "/projects/:projectId/agents/:agent/instructions/invalidate",
         InstructionCommandController,
         :invalidate
  end
end
