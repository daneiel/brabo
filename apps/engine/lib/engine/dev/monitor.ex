defmodule Engine.Dev.Monitor do
  @moduledoc """
  Observa cada DevAgentServer via Process.monitor/1 (não link — um dev
  morto não derruba o resto do engine) e apaga sua linha em
  `dev_agent_states` quando o agente termina. Mesmo papel do
  `Engine.Sessions.Monitor` pras sessões.

  Sem isso a linha sobrevive ao processo e o `Engine.Dev.DevRehydrator`
  ressuscita, a cada boot do nó, TODO dev agent que já existiu — inclusive
  os que morreram por crash, que voltam vivos sem ciclo de trabalho e
  seguram um `agent_id` no Registry pra sempre (o que também deixa o
  WorktreeCleanupWorker inócuo, já que agente "vivo" nunca tem worktree
  órfão).
  """

  use GenServer

  require Logger

  alias Engine.Dev.DevAgentState

  @name __MODULE__

  def start_link(_opts), do: GenServer.start_link(__MODULE__, %{}, name: @name)

  @doc "Passa a observar o dev agent. Idempotente por pid."
  def watch(pid, project_id, agent_id),
    do: GenServer.call(@name, {:watch, pid, project_id, agent_id})

  @impl true
  def init(state), do: {:ok, state}

  @impl true
  def handle_call({:watch, pid, project_id, agent_id}, _from, state) do
    state =
      if Map.has_key?(state, pid) do
        state
      else
        ref = Process.monitor(pid)
        Map.put(state, pid, %{ref: ref, project_id: project_id, agent_id: agent_id})
      end

    {:reply, :ok, state}
  end

  @impl true
  def handle_info({:DOWN, ref, :process, pid, reason}, state) do
    case Map.fetch(state, pid) do
      {:ok, %{ref: ^ref} = entry} ->
        if forget?(reason), do: safe_delete(entry.project_id, entry.agent_id)
        {:noreply, Map.delete(state, pid)}

      _ ->
        {:noreply, state}
    end
  end

  # Singleton, mesmo raciocínio do Engine.Sessions.Monitor: uma falha do banco
  # ao apagar a linha não pode derrubar o monitoramento de todos os agentes.
  defp safe_delete(project_id, agent_id) do
    DevAgentState.delete(project_id, agent_id)
  rescue
    e -> Logger.warning("Dev.Monitor: falha ao apagar #{agent_id}: #{inspect(e)}")
  catch
    :exit, reason ->
      Logger.warning("Dev.Monitor: falha ao apagar #{agent_id}: #{inspect(reason)}")
  end

  # :shutdown = o supervisor está descendo (nó parando) — PRESERVA a linha,
  # que é exatamente o caso que a rehydration existe pra cobrir. Qualquer
  # outro motivo (:normal, crash, :killed) significa que este agente
  # específico acabou: a linha sai, senão ele volta a cada boot pra sempre.
  defp forget?(:shutdown), do: false
  defp forget?({:shutdown, _}), do: false
  defp forget?(_), do: true
end
