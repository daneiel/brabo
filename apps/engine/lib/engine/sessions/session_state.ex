defmodule Engine.Sessions.SessionState do
  @moduledoc """
  Persistência do estado observável de cada sessão supervisionada, no
  schema "engine". É a única rede de segurança pra reidratação: se o
  container do engine cair, o Monitor cai junto (nenhum :DOWN é
  processado durante a queda) — só o que estiver aqui sobrevive.

  Sem coluna de limpeza: ao terminar (qualquer causa), a linha é
  deletada, não marcada como terminal — list_non_terminal/0 é só um
  SELECT * simples.
  """

  use Ecto.Schema
  import Ecto.Changeset
  import Ecto.Query

  alias Engine.Repo

  @primary_key {:session_id, :string, autogenerate: false}
  @schema_prefix "engine"
  schema "session_states" do
    field :project_id, :string
    field :status, :string
    field :closing_cause, :string

    timestamps(type: :utc_datetime_usec)
  end

  def upsert_active!(session_id, project_id) do
    %__MODULE__{}
    |> change(%{session_id: session_id, project_id: project_id, status: "active"})
    |> Repo.insert!(
      on_conflict: {:replace, [:project_id, :status, :closing_cause, :updated_at]},
      conflict_target: :session_id
    )
  end

  def mark_closing!(session_id, cause) do
    Repo.update_all(
      from(s in __MODULE__, where: s.session_id == ^session_id),
      set: [status: "closing", closing_cause: cause, updated_at: DateTime.utc_now()]
    )
  end

  def delete(session_id) do
    Repo.delete_all(from(s in __MODULE__, where: s.session_id == ^session_id))
  end

  def list_non_terminal do
    Repo.all(__MODULE__)
  end
end
