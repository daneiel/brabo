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
    # `traceparent` W3C da span raiz da sessão, vindo da api no comando de
    # criação. É o que faz o trabalho deste lado continuar a mesma trace.
    field :trace_parent, :string

    timestamps(type: :utc_datetime_usec)
  end

  def upsert_active!(session_id, project_id, trace_parent \\ nil) do
    attrs = %{session_id: session_id, project_id: project_id, status: "active"}

    # `trace_parent` só entra quando informado: numa reidratação ou adoção o
    # valor não vem no caminho, e sobrescrever com nil apagaria o vínculo da
    # sessão com a trace dela.
    attrs = if trace_parent, do: Map.put(attrs, :trace_parent, trace_parent), else: attrs

    replace =
      if trace_parent,
        do: [:project_id, :status, :closing_cause, :trace_parent, :updated_at],
        else: [:project_id, :status, :closing_cause, :updated_at]

    %__MODULE__{}
    |> change(attrs)
    |> Repo.insert!(on_conflict: {:replace, replace}, conflict_target: :session_id)
  end

  @doc "`traceparent` da sessão, ou nil. Lido a cada turno de agente."
  def traceparent(session_id) do
    Repo.one(from(s in __MODULE__, where: s.session_id == ^session_id, select: s.trace_parent))
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
