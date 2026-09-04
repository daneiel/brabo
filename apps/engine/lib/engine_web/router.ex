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

    # RN-122: cancela o turno em curso do agente conversacional daquela
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

    # RN-454: leitura da flag global — a aba Insights precisa saber que a
    # pausa é DECISÃO sem esbarrar no 503 de "/reanalyze" primeiro.
    get "/psychologist/status", PsychologistCommandController, :status

    post "/projects/:projectId/anamnese/run", AnamneseCommandController, :run

    post "/projects/:projectId/agents/:agent/instructions/invalidate",
         InstructionCommandController,
         :invalidate

    # Runner local + terminal interativo — ver EngineWeb.RunnerTicketCommandController.
    post "/projects/:projectId/runner-tickets", RunnerTicketCommandController, :create

    # O runner sobe o container do projeto na máquina do usuário (ADR 0137) —
    # ver EngineWeb.ContainerCommandController. Só para projeto
    # mounted/runner; container vai pelo broker, que nunca chama isto.
    post "/projects/:projectId/containers/start", ContainerCommandController, :start
    post "/projects/:projectId/containers/stop", ContainerCommandController, :stop
    post "/projects/:projectId/containers/remove", ContainerCommandController, :remove
  end
end
