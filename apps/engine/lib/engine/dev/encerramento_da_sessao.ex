defmodule Engine.Dev.EncerramentoDaSessao do
  @moduledoc """
  RN-763 (AT-456). Encerrar a sessão de execução PARA os dev agents dela e os
  gates (QA/SecOps) do projeto — a régua que o `SessionLifecycleWorker` já
  aplicava aos conversacionais (RN-581). Antes, o dev seguia reivindicando
  task e abrindo PR com a sessão encerrada; o único freio era parar o
  container.

  Em duas metades, porque o processo é local ao nó e o estado é do banco:

    1. `parar_processos/2` roda em TODO nó (`:erpc.multicall`): avisa o
       `Engine.Dev.Monitor` que o agente sai de propósito (sem religamento, a
       linha durável sai) e o derruba na hora — o turno em curso NÃO é
       gravado, como nos conversacionais. Os gates do projeto também caem.
    2. Uma vez, no banco: para cada linha de `dev_agent_states` da sessão com
       task em curso, o trabalho do worktree vira commit na branch da task
       (`WorktreeManager.preservar/4`, a RN-743) e a task é BLOQUEADA com
       motivo "sessão de execução encerrada", origem `politica` e o
       diagnóstico dizendo onde ficou o trabalho — volta à fila só quando um
       humano a libera, nunca perdida. As linhas de `gate_states` da sessão
       saem, para o `GateRescuer` não reabrir um ciclo da sessão encerrada.

  Declarado: ação pendente de dev agent fica pendente (a decisão humana sobre
  ela continua entrando em sessão encerrada); PR já aberta continua aberta;
  a sessão com `execution.activated` não reabre (RN-650), então retomar é
  ativar a execução numa sessão nova.
  """

  require Logger
  import Ecto.Query, only: [from: 2]

  alias Engine.Dev.{AgentIo, DevAgentState}
  alias Engine.Gates.GateState
  alias Engine.Repo
  alias Engine.Sessions.EngineApiClient

  @motivo "sessão de execução encerrada"

  @doc "Para dev agents e gates da sessão em todos os nós e devolve os ids parados."
  def parar_da_sessao(session_id) do
    linhas = linhas_da_sessao(session_id)

    if linhas == [] do
      apagar_gates_da_sessao(session_id)
      []
    else
      alvos = Enum.map(linhas, &{&1.project_id, &1.agent_id})
      projetos = linhas |> Enum.map(& &1.project_id) |> Enum.uniq()
      nos = [node() | Node.list()]

      nos
      |> :erpc.multicall(__MODULE__, :parar_processos, [alvos, projetos], 10_000)
      |> Enum.zip(nos)
      |> Enum.each(fn
        {{:ok, _}, _} -> :ok
        {erro, no} -> Logger.warning("sessão #{session_id}: nó #{inspect(no)}: #{inspect(erro)}")
      end)

      Enum.each(linhas, &devolver_task/1)
      apagar_gates_da_sessao(session_id)
      Enum.map(linhas, & &1.agent_id)
    end
  end

  @doc false
  def parar_processos(alvos, projetos) do
    Enum.each(alvos, fn {project_id, agent_id} ->
      case Registry.lookup(Engine.Dev.Registry, {project_id, agent_id}) do
        [{pid, _}] ->
          :ok = Engine.Dev.Monitor.esquecer(pid)
          Process.exit(pid, :kill)

        [] ->
          :ok
      end
    end)

    for project_id <- projetos, gate <- ["qa", "secops"] do
      case Registry.lookup(Engine.Gates.Registry, {project_id, gate}) do
        [{pid, _}] -> Process.exit(pid, :kill)
        [] -> :ok
      end
    end

    :ok
  end

  defp linhas_da_sessao(session_id) do
    Repo.all(from(d in DevAgentState, where: d.session_id == ^session_id))
  rescue
    e ->
      Logger.warning("sessão #{session_id}: dev_agent_states ilegível: #{inspect(e)}")
      []
  end

  defp devolver_task(%{task_id: task_id} = linha) when is_binary(task_id) do
    diagnostico =
      "A sessão de execução foi encerrada com a task em curso (#{linha.status}); " <>
        "o dev agent parou sem gravar o turno. " <>
        onde_ficou(linha) <>
        " Libere a task para retomá-la numa nova execução."

    _ =
      EngineApiClient.mark_task_blocked(
        linha.project_id,
        linha.session_id,
        task_id,
        @motivo,
        diagnostico,
        linha.agent_id,
        "politica"
      )

    DevAgentState.delete(linha.project_id, linha.agent_id)
  end

  defp devolver_task(linha), do: DevAgentState.delete(linha.project_id, linha.agent_id)

  defp onde_ficou(%{worktree_path: path} = linha) when is_binary(path) do
    case AgentIo.worktree_manager().preservar(
           linha.project_id,
           path,
           linha.agent_id,
           linha.task_id
         ) do
      {:ok, sha} ->
        "O trabalho do worktree foi preservado em commit #{String.slice(sha, 0, 12)}."

      :nada ->
        "O worktree não tinha mudança sem commit."

      {:error, motivo} ->
        "Não foi possível preservar o worktree: #{String.slice(to_string(motivo), 0, 200)}."
    end
  end

  defp onde_ficou(_), do: "Não havia worktree."

  defp apagar_gates_da_sessao(session_id) do
    Repo.delete_all(from(g in GateState, where: g.session_id == ^session_id))
  rescue
    e -> Logger.warning("sessão #{session_id}: gate_states: #{inspect(e)}")
  end
end
