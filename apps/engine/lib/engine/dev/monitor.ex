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

  @doc """
  RN-763: o agente vai sair DE PROPÓSITO (a sessão de execução foi encerrada).
  Qualquer motivo de saída dele passa a apagar a linha durável, sem religamento.
  """
  def esquecer(pid), do: GenServer.call(@name, {:esquecer, pid})

  @impl true
  def init(state), do: {:ok, state}

  @impl true
  def handle_call({:esquecer, pid}, _from, state) do
    state =
      case Map.fetch(state, pid) do
        {:ok, entry} -> Map.put(state, pid, Map.put(entry, :esquecer, true))
        :error -> state
      end

    {:reply, :ok, state}
  end

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
        state = Map.delete(state, pid)
        {:noreply, ao_terminar(entry, reason, state)}

      _ ->
        {:noreply, state}
    end
  end

  # AT-428 (RN-742). Morte por CRASH não é o agente terminando: em 08/10 o
  # `DevAgentServer` caiu por um `CaseClauseError` dentro do Finch, a linha foi
  # apagada como se ele tivesse acabado, nenhum evento foi gravado e a tela
  # seguiu dizendo "trabalhando". Agora o crash (1) vira `agent.error` DURÁVEL
  # com origem `infra` (RN-059), e (2) o agente é RELIGADO a partir da própria
  # linha — o `resume` cai no `handle_continue({:restart_recovery, _})` que já
  # existe, que bloqueia a task interrompida com diagnóstico e pega a próxima.
  # Teto de `@max_religamentos` por agente: no limite a linha sai e o erro diz
  # que não houve religamento, em vez de um laço de crash.
  @max_religamentos 3

  defp ao_terminar(entry, reason, state) do
    chave = {:religamentos, entry.project_id, entry.agent_id}
    feitos = Map.get(state, chave, 0)

    cond do
      Map.get(entry, :esquecer, false) ->
        safe_delete(entry.project_id, entry.agent_id)
        state

      not forget?(reason) ->
        state

      reason == :normal ->
        safe_delete(entry.project_id, entry.agent_id)
        state

      true ->
        linha = safe_get(entry.project_id, entry.agent_id)
        religar? = linha != nil and feitos < @max_religamentos
        unless religar?, do: safe_delete(entry.project_id, entry.agent_id)
        # Fora do Monitor: `start_agent` chama `watch/4`, um `call` a ESTE
        # processo, e o append é HTTP.
        Task.start(fn -> registrar_e_religar(entry, linha, reason, religar?) end)
        if religar?, do: Map.put(state, chave, feitos + 1), else: state
    end
  end

  @doc false
  def registrar_e_religar(entry, linha, reason, religar?) do
    if linha && linha.session_id do
      mensagem =
        "O processo do #{entry.agent_id} caiu (#{motivo_curto(reason)})" <>
          if(religar?,
            do: " e foi religado; a tarefa em curso foi bloqueada com diagnóstico.",
            else: " e NÃO foi religado (teto de religamentos); reative a execução."
          )

      try do
        _ =
          Engine.Sessions.EngineApiClient.append_event(linha.project_id, linha.session_id, %{
            type: "agent.error",
            actorKind: "agent",
            actorId: entry.agent_id,
            payload: %{
              origem: "infra",
              mensagem: mensagem,
              reason: "processo_do_dev_caiu",
              religado: religar?,
              taskId: linha.task_id
            }
          })
      rescue
        e -> Logger.warning("Dev.Monitor: agent.error de #{entry.agent_id}: #{inspect(e)}")
      end
    end

    if religar? do
      resume = %{
        task_id: linha.task_id,
        worktree_path: linha.worktree_path,
        status: linha.status,
        consecutive_blocked: linha.consecutive_blocked
      }

      case Engine.Dev.DevAgentSupervisor.start_agent(
             linha.project_id,
             linha.agent_id,
             linha.module,
             linha.session_id,
             linha.task_budget_micros,
             linha.max_gate_corrections,
             linha.impl,
             linha.max_consecutive_blocked,
             resume
           ) do
        {:ok, pid, _} ->
          # `working`/`awaiting_approval` já seguem pelo `handle_continue`; o
          # que estava livre volta a procurar trabalho.
          if linha.status not in ["working", "awaiting_approval"],
            do: GenServer.cast(pid, :work)

          :ok

        other ->
          Logger.error("Dev.Monitor: religar #{entry.agent_id} falhou: #{inspect(other)}")
      end
    end
  end

  defp motivo_curto({%{__exception__: true} = e, _stack}), do: inspect(e.__struct__)
  defp motivo_curto(reason), do: reason |> inspect() |> String.slice(0, 120)

  defp safe_get(project_id, agent_id) do
    DevAgentState.get(project_id, agent_id)
  rescue
    _ -> nil
  catch
    :exit, _ -> nil
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
