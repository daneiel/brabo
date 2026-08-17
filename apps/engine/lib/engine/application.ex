defmodule Engine.Application do
  # See https://elixir.hexdocs.pm/Application.html
  # for more information on OTP Applications
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    # ANTES da árvore: as instrumentações automáticas anexam handlers de
    # :telemetry, e handler anexado depois do evento não produz span.
    Engine.Telemetry.Otel.setup()

    children = [
      EngineWeb.Telemetry,
      Engine.Repo,
      {DNSCluster, query: Application.get_env(:engine, :dns_cluster_query) || :ignore},
      {Phoenix.PubSub, name: Engine.PubSub},
      {Task.Supervisor, name: Engine.TaskSupervisor},
      {Oban, Application.fetch_env!(:engine, Oban)},
      {Registry, keys: :unique, name: Engine.Sessions.Registry},
      # Dev agents (Fase 4a) — chave {project_id, agent_id}.
      {Registry, keys: :unique, name: Engine.Dev.Registry},
      # Gates de PR (Fase 4a) — chave {project_id, "qa"|"secops"}.
      {Registry, keys: :unique, name: Engine.Gates.Registry},
      # Dono da tabela ETS que cacheia o merge de instruções do harness
      # (Engine.Harness.InstructionFiles) — só detém a tabela, sem lógica.
      Engine.Harness.InstructionFiles.Cache,
      Engine.Sessions.Monitor,
      Engine.Sessions.SessionSupervisor,
      # Agentes conversacionais por sessão (Fase 3b) — um CriativoServer por
      # sessão em ideação, iniciado por comando do usuário via a api; um
      # PoServer por sessão, ativado pelo handoff aceito.
      Engine.Agents.CriativoSupervisor,
      Engine.Agents.PoSupervisor,
      Engine.Agents.ArquitetoSupervisor,
      Engine.Agents.DevLeadSupervisor,
      # UX/Product Designer (ADR 0087) — solo, sem área. Ativado por handoff
      # aceito endereçado a "ux-designer" (mesmo mecanismo genérico dos
      # demais).
      Engine.Agents.UxDesignerSupervisor,
      # Infra Lead (Fase 4a; área — Fase 8c) — mesma família session-scoped
      # dos demais, ativado por handoff aceito do Arquiteto.
      Engine.Infra.InfraLeadSupervisor,
      # Dev agents de execução (Fase 4a) — um por {project, agent_id}.
      # O Monitor sobe ANTES do supervisor: start_agent/6 registra o pid
      # nele, então ele precisa estar vivo quando o primeiro agente nasce.
      Engine.Dev.Monitor,
      Engine.Dev.DevAgentSupervisor,
      # Gates de PR (Fase 4a; QA virou área na Fase 8b) — um QA Lead + um
      # SecOpsAgent por projeto.
      Engine.Gates.QaLeadSupervisor,
      Engine.Gates.SecOpsAgentSupervisor,
      # Reidrata sessões sobreviventes de um boot anterior ANTES do
      # Endpoint subir — nunca aceitar heartbeat de alguém reconectando
      # antes da sessão existir de novo.
      {Engine.Sessions.Rehydrator, []},
      # Reidrata os dev agents sobreviventes (depois do DevAgentSupervisor).
      {Engine.Dev.DevRehydrator, []},
      # Resgata ciclos de gate (QA/SecOps) órfãos de um boot anterior — mesmo
      # idioma do DevRehydrator, depois dos dois supervisors de gate (ADR 0067).
      {Engine.Gates.GateRescuer, []},
      EngineWeb.Endpoint
    ]

    # See https://elixir.hexdocs.pm/Supervisor.html
    # for other strategies and supported options
    opts = [strategy: :one_for_one, name: Engine.Supervisor]
    result = Supervisor.start_link(children, opts)

    if match?({:ok, _}, result) and outbox_drain_should_start?() do
      {:ok, _cleanup} = Engine.Workers.WorktreeCleanupWorker.kickoff()
      {:ok, _job} = Engine.Workers.OutboxDrainWorker.kickoff()
      # Readota sessões cuja réplica sumiu sem preStop (kill -9, OOMKill).
      {:ok, _adoption} = Engine.Workers.SessionAdoptionWorker.kickoff()
    end

    if match?({:ok, _}, result) and anamnese_should_start?() do
      {:ok, _anamnese} = Engine.Workers.AnamneseSchedulerWorker.kickoff()
    end

    if match?({:ok, _}, result) and model_sync_should_start?() do
      {:ok, _model_sync} = Engine.Workers.ModelSyncSchedulerWorker.kickoff()
    end

    if match?({:ok, _}, result) and gate_rescue_should_start?() do
      {:ok, _gate_rescue} = Engine.Workers.GateRescueSchedulerWorker.kickoff()
    end

    result
  end

  # Desligável em teste (config :engine, start_outbox_drain?: false) — os
  # testes chamam Engine.Outbox.Drain.run_once/0 direto, sem depender do
  # job Oban recorrente.
  defp outbox_drain_should_start? do
    Application.get_env(:engine, :start_outbox_drain?, true)
  end

  # Desligável em teste (config :engine, start_anamnese?: false) — a
  # suite dispara AnamneseWorker.perform/1 direto, sem o tick periódico.
  defp anamnese_should_start? do
    Application.get_env(:engine, :start_anamnese?, true)
  end

  # Desligável em teste (config :engine, start_model_sync?: false) — a suite
  # chama ModelSyncSchedulerWorker.perform/1 direto, sem o tick periódico.
  defp model_sync_should_start? do
    Application.get_env(:engine, :start_model_sync?, true)
  end

  # Desligável em teste (config :engine, start_gate_rescue?: false) — a suite
  # chama Engine.Gates.GateRescuer.run/0 direto, sem o tick periódico.
  defp gate_rescue_should_start? do
    Application.get_env(:engine, :start_gate_rescue?, true)
  end

  # Tell Phoenix to update the endpoint configuration
  # whenever the application is updated.
  @impl true
  def config_change(changed, _new, removed) do
    EngineWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
