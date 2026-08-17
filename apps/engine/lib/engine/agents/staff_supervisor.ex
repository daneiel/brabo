defmodule Engine.Agents.StaffSupervisor do
  @moduledoc """
  DynamicSupervisor que cria um StaffServer por sessão (espelha
  `Engine.Agents.DevLeadSupervisor`/`Engine.Agents.ArquitetoSupervisor`).
  Idempotente; sinaliza `:started` (start fresco) vs `:existing`.

  Diferente dos demais leads, `:started` NÃO dispara kickoff nenhum — o
  Staff (`docs/fluxo.yml`, `camada_decisao_tecnica`, ADR 0088) não sintetiza
  uma instrução de abertura a partir do event log. Quem chama
  `start_agent/2` (o controller do engine) não encontra um `kickoff/1` para
  invocar, de propósito.
  """

  use DynamicSupervisor

  alias Engine.Agents.StaffServer

  def start_link(_opts), do: DynamicSupervisor.start_link(__MODULE__, :ok, name: __MODULE__)

  @impl true
  def init(:ok), do: DynamicSupervisor.init(strategy: :one_for_one)

  def start_agent(session_id, project_id) do
    case Registry.lookup(Engine.Sessions.Registry, "staff:" <> session_id) do
      [{pid, _}] ->
        {:ok, pid, :existing}

      [] ->
        spec = {StaffServer, {session_id, project_id}}

        case DynamicSupervisor.start_child(__MODULE__, spec) do
          {:ok, pid} -> {:ok, pid, :started}
          {:error, {:already_started, pid}} -> {:ok, pid, :existing}
        end
    end
  end
end
