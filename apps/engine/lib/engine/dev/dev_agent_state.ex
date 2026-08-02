defmodule Engine.Dev.DevAgentState do
  @moduledoc """
  Estado durável de cada dev agent (Fase 4a), schema "engine" — rede de
  segurança pra reidratação (mesmo papel de SessionState). Chave composta
  {project_id, agent_id}. Ao terminar, a linha é deletada.
  """

  use Ecto.Schema
  import Ecto.Changeset
  import Ecto.Query

  alias Engine.Repo

  @primary_key false
  @schema_prefix "engine"
  schema "dev_agent_states" do
    field :project_id, :string, primary_key: true
    field :agent_id, :string, primary_key: true
    field :module, :string
    field :session_id, :string
    field :task_id, :string
    field :worktree_path, :string
    field :status, :string, default: "working"
    field :task_budget_micros, :integer
    field :max_gate_corrections, :integer
    # Circuit breaker por agente (Fase 12b, RN-047) — ver dev_agent_server.ex.
    field :consecutive_blocked, :integer, default: 0
    field :max_consecutive_blocked, :integer
    # "real" (ToolLoop + LLM) | "noop" (smoke test da infra, sem LLM) — a
    # reidratação escolhe o módulo a subir a partir daqui.
    field :impl, :string, default: "real"

    timestamps(type: :utc_datetime_usec)
  end

  @fields [
    :project_id,
    :agent_id,
    :module,
    :session_id,
    :task_id,
    :worktree_path,
    :status,
    :task_budget_micros,
    :max_gate_corrections,
    :consecutive_blocked,
    :max_consecutive_blocked,
    :impl
  ]

  def upsert!(attrs) do
    %__MODULE__{}
    |> cast(attrs, @fields)
    |> Repo.insert!(
      on_conflict:
        {:replace,
         [
           :module,
           :session_id,
           :task_id,
           :worktree_path,
           :status,
           :task_budget_micros,
           :max_gate_corrections,
           :consecutive_blocked,
           :max_consecutive_blocked,
           :impl,
           :updated_at
         ]},
      conflict_target: [:project_id, :agent_id]
    )
  end

  def delete(project_id, agent_id) do
    Repo.delete_all(
      from(s in __MODULE__,
        where: s.project_id == ^project_id and s.agent_id == ^agent_id
      )
    )
  end

  def list_all, do: Repo.all(__MODULE__)

  @doc "Estado durável de um agente específico, ou nil."
  def get(project_id, agent_id),
    do: Repo.get_by(__MODULE__, project_id: project_id, agent_id: agent_id)

  @doc """
  Acha o estado do dev agent que está (ou esteve) trabalhando em `task_id`
  (Fase 4a — gates de QA/SecOps precisam do worktree/branch da task pra
  rodar suite/scanners, sem serem eles mesmos o processo que a reivindicou).
  `nil` se nenhum agente tem essa task registrada.
  """
  def find_by_task_id(project_id, task_id) do
    Repo.one(
      from(s in __MODULE__,
        where: s.project_id == ^project_id and s.task_id == ^task_id,
        limit: 1
      )
    )
  end

  @doc """
  Agentes de um módulo do projeto (Fase 12b — `DevAgentWakeWorker` usa isto
  pra achar quem acordar em `task.became_claimable`, incluindo extras de
  paralelização como `dev-api-2`, que `Naming.dev_agent_id/1` não conhece).
  """
  def list_by_module(project_id, module) do
    Repo.all(
      from(s in __MODULE__,
        where: s.project_id == ^project_id and s.module == ^module
      )
    )
  end

  @doc "Agentes de um módulo do projeto num status específico."
  def list_by_status(project_id, module, status) do
    Repo.all(
      from(s in __MODULE__,
        where: s.project_id == ^project_id and s.module == ^module and s.status == ^status
      )
    )
  end
end
