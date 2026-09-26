defmodule Engine.Gates.QaLeadSupervisor do
  @moduledoc """
  DynamicSupervisor do `QaLeadServer` (Fase 8b), um por `project_id` —
  absorve o papel do antigo `QaAgentSupervisor` (Fase 4a). Idempotente —
  `start_agent/1` sinaliza `:started`/`:existing` (mesmo desenho do
  `Engine.Dev.DevAgentSupervisor`).
  """

  use DynamicSupervisor

  alias Engine.Gates.QaLeadServer

  def start_link(_opts), do: DynamicSupervisor.start_link(__MODULE__, :ok, name: __MODULE__)

  @impl true
  def init(:ok), do: DynamicSupervisor.init(strategy: :one_for_one)

  def start_agent(project_id) do
    case pid_vivo(project_id) do
      pid when is_pid(pid) ->
        {:ok, pid, :existing}

      nil ->
        case DynamicSupervisor.start_child(__MODULE__, {QaLeadServer, project_id}) do
          {:ok, pid} -> {:ok, pid, :started}
          {:error, {:already_started, pid}} -> {:ok, pid, :existing}
        end
    end
  end

  # Só um pid VIVO conta como `:existing` (AT-204): o Registry apaga a chave de
  # forma ASSÍNCRONA, e logo depois de o processo morrer o lookup ainda pode
  # devolver o pid morto — o resgate do `GateRescuer` tomaria por vivo o gate
  # que tem de reerguer. Registrar por cima de um pid morto não é recusado.
  defp pid_vivo(project_id) do
    case Registry.lookup(Engine.Gates.Registry, {project_id, "qa"}) do
      [{pid, _}] -> if Process.alive?(pid), do: pid
      [] -> nil
    end
  end
end
