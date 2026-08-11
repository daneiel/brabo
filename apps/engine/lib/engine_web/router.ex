defmodule EngineWeb.Router do
  use EngineWeb, :router

  pipeline :api do
    plug :accepts, ["json"]
  end

  pipeline :internal do
    plug :accepts, ["json"]
    plug EngineWeb.Plugs.VerifyServiceToken
  end

  scope "/", EngineWeb do
    pipe_through :api

    # /health é o original (imagem e docker/smoke.sh dependem dele).
    # /live e /ready existem porque as perguntas são diferentes — ver o
    # moduledoc do HealthController.
    get "/health", HealthController, :check
    get "/live", HealthController, :live
    get "/ready", HealthController, :ready

    # Sem auth de propósito; o alcance é restringido por NetworkPolicy.
    get "/metrics", MetricsController, :index
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
    post "/sessions/:sessionId/agent/revise", AgentCommandController, :revise

    # RN-121: cancela o turno em curso do agente conversacional daquela
    # sessão — mesmo padrão de `agent/message` (o "agent" vem do corpo, não
    # da URL, porque um endpoint só cobre os quatro conversacionais).
    post "/sessions/:sessionId/agent/cancel", AgentCommandController, :cancel

    post "/sessions/:sessionId/agent/offer-infra-handoff",
         AgentCommandController,
         :offer_infra_handoff

    post "/sessions/:sessionId/agent/offer-dev-handoff",
         AgentCommandController,
         :offer_dev_handoff

    post "/sessions/:sessionId/execution/start", ExecutionCommandController, :start
    post "/sessions/:sessionId/execution/parallelize", ExecutionCommandController, :parallelize

    post "/sessions/:sessionId/dev-agents/:agentId/rearm",
         ExecutionCommandController,
         :rearm

    post "/sessions/:sessionId/psychologist/reanalyze",
         PsychologistCommandController,
         :reanalyze

    post "/projects/:projectId/anamnese/run", AnamneseCommandController, :run

    post "/projects/:projectId/agents/:agent/instructions/invalidate",
         InstructionCommandController,
         :invalidate
  end
end
