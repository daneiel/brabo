defmodule Engine.Gates.GateState do
  @moduledoc """
  Estado durável de um ciclo de gate (QA/SecOps) em voo — mesma disciplina de
  `Engine.Dev.DevAgentState` (ADR 0045), aplicada ao que o ADR 0057 tinha
  declarado como limite conhecido: o `pendente`/`em_voo` do `QaLeadServer` e o
  ciclo do `SecOpsAgentServer` só existiam em memória, e um restart no meio
  perdia o laço pra sempre — nada resgatava.

  Chave composta `{project_id, task_id, gate}`. Escrita e apagada nos MESMOS
  pontos onde `qa_lead_server.ex`/`secops_agent_server.ex` já fazem as
  transições intermediárias (ver ADR 0067) — este módulo não decide nada,
  só persiste.
  """

  use Ecto.Schema
  import Ecto.Changeset
  import Ecto.Query

  alias Engine.Repo

  @primary_key false
  @schema_prefix "engine"
  schema "gate_states" do
    field :project_id, :string, primary_key: true
    field :task_id, :string, primary_key: true
    field :gate, :string, primary_key: true
    field :session_id, :string
    field :step, :string
    field :subagent, :string
    field :next_action, :string
    field :correction_reason, :string
    field :correction_diagnosis, :string

    timestamps(type: :utc_datetime_usec)
  end

  @fields [
    :project_id,
    :task_id,
    :gate,
    :session_id,
    :step,
    :subagent,
    :next_action,
    :correction_reason,
    :correction_diagnosis
  ]

  def upsert!(attrs) do
    %__MODULE__{}
    |> cast(attrs, @fields)
    |> Repo.insert!(
      on_conflict:
        {:replace,
         [
           :session_id,
           :step,
           :subagent,
           :next_action,
           :correction_reason,
           :correction_diagnosis,
           :updated_at
         ]},
      conflict_target: [:project_id, :task_id, :gate]
    )
  end

  def delete(project_id, task_id, gate) do
    Repo.delete_all(
      from(s in __MODULE__,
        where: s.project_id == ^project_id and s.task_id == ^task_id and s.gate == ^gate
      )
    )

    :ok
  end

  @doc """
  Ciclos em voo há mais de `stale_after_seconds` — o que
  `Engine.Gates.GateRescuer` varre. O limiar é generoso de propósito: o
  ToolLoop de um subagente de QA pode legitimamente rodar até
  `TOOL_LOOP_MAX_ITERATIONS_GATE` (60) iterações, e resgatar um ciclo que só
  está lento duplicaria trabalho — ver o ADR 0067 sobre por que o valor
  default é 15 minutos e não algo mais agressivo.
  """
  def list_stale(stale_after_seconds) do
    limite = DateTime.add(DateTime.utc_now(), -stale_after_seconds, :second)

    Repo.all(
      from(s in __MODULE__,
        where: s.updated_at < ^limite,
        order_by: [asc: s.updated_at]
      )
    )
  end

  def list_all, do: Repo.all(__MODULE__)

  @doc "Estado durável de um ciclo específico, ou nil."
  def get(project_id, task_id, gate),
    do: Repo.get_by(__MODULE__, project_id: project_id, task_id: task_id, gate: gate)
end
