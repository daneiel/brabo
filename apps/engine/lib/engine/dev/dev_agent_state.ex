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
    :max_gate_corrections
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
end
