defmodule Engine.Dev.DevAgentSupervisor do
  @moduledoc """
  DynamicSupervisor dos dev agents (Fase 4a), um por {project_id, agent_id}.
  Idempotente; `start_agent/4..9` sinaliza `:started` (start fresco → o
  chamador dispara `:work`) vs `:existing`. `task_budget_micros` (teto de
  tokens por task), `max_gate_corrections` (teto de correções dev↔gate) e
  `max_consecutive_blocked` (circuit breaker, Fase 12b — RN-047) são
  opcionais, configurados na ativação da execução. `resume` (Fase 12b-6) é
  a linha durável quando quem chama é `Engine.Dev.DevRehydrator` — `nil`
  num start fresco.

  `impl` escolhe a implementação: `:real` (ToolLoop + LLM) ou `:noop`
  (`NoopDevAgentServer`, smoke test da infraestrutura sem LLM). Os dois
  compartilham Registry, `agent_id` e estado durável — é um modo, não uma
  identidade diferente.
  """

  use DynamicSupervisor

  alias Engine.Dev.{DevAgentServer, NoopDevAgentServer}

  def start_link(_opts), do: DynamicSupervisor.start_link(__MODULE__, :ok, name: __MODULE__)

  @impl true
  def init(:ok), do: DynamicSupervisor.init(strategy: :one_for_one)

  def start_agent(
        project_id,
        agent_id,
        module,
        session_id,
        task_budget_micros \\ nil,
        max_gate_corrections \\ nil,
        impl \\ :real,
        max_consecutive_blocked \\ nil,
        resume \\ nil
      ) do
    case Registry.lookup(Engine.Dev.Registry, {project_id, agent_id}) do
      [{pid, _}] ->
        {:ok, pid, :existing}

      [] ->
        spec =
          {server_for(impl),
           {project_id, agent_id, module, session_id, task_budget_micros, max_gate_corrections,
            max_consecutive_blocked, resume}}

        case DynamicSupervisor.start_child(__MODULE__, spec) do
          {:ok, pid} ->
            # Mesmo idioma do SessionSupervisor: quem sobe o processo é quem
            # o registra no Monitor (que apaga a linha durável no :DOWN).
            :ok = Engine.Dev.Monitor.watch(pid, project_id, agent_id)
            {:ok, pid, :started}

          {:error, {:already_started, pid}} ->
            {:ok, pid, :existing}
        end
    end
  end

  @doc """
  Módulo do server pra um modo. Aceita átomo (chamadas internas) ou string (o
  valor que vem do `dev_agent_states.impl` na reidratação e do corpo do
  comando da api). Qualquer coisa fora de "noop" cai no agente real — o
  default seguro é o de produção.
  """
  def server_for(impl) when impl in [:noop, "noop"], do: NoopDevAgentServer
  def server_for(_impl), do: DevAgentServer
end
