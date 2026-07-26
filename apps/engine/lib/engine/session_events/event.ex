defmodule Engine.SessionEvents.Event do
  @moduledoc """
  Leitura read-only do event log de domínio (session_events, tabela da
  api, gerenciada por Drizzle) — nunca changeset/insert aqui. Escrever
  novos eventos exige o contrato atômico de seq (lock de linha) que só
  AppendSessionEventUseCase sabe fazer corretamente do lado da api; ver
  Engine.Sessions.EngineApiClient.append_event/3 pra isso.
  """

  use Ecto.Schema
  import Ecto.Query

  alias Engine.Repo

  @primary_key {:id, :string, autogenerate: false}
  @schema_prefix "public"
  schema "session_events" do
    field :session_id, :binary_id
    field :seq, :integer
    field :type, :string
    field :actor_kind, :string
    field :actor_id, :string
    field :payload, :map, default: %{}
    field :created_at, :utc_datetime
  end

  @doc """
  Quantos eventos a sessão tem. COUNT no banco em vez de
  `length(list(session_id))` — quem só precisa do número (a triagem do
  Psicólogo) não carrega o log inteiro pra memória.
  """
  def count(session_id) do
    Repo.aggregate(from(e in __MODULE__, where: e.session_id == ^session_id), :count, :id)
  end

  @doc """
  Os `limit` eventos mais recentes da sessão, devolvidos em ordem de seq
  CRESCENTE (a query desce por seq pra pegar a cauda, o resultado volta
  cronológico pra ser lido como log).
  """
  def list_recent(session_id, limit) do
    from(e in __MODULE__,
      where: e.session_id == ^session_id,
      order_by: [desc: e.seq],
      limit: ^limit
    )
    |> Repo.all()
    |> Enum.reverse()
  end

  @doc """
  Janela de tempo do PROJETO inteiro (Fase 4b — a Anamnese analisa
  "janelas do event log"). Junta em sessions pra filtrar por projeto, já
  que session_events não carrega project_id. `limit` protege contra
  janelas patológicas.
  """
  def list_for_project_window(project_id, from_time, to_time, limit \\ 500) do
    Repo.all(
      from(e in __MODULE__,
        join: s in Engine.Sessions.ProjectSession,
        on: e.session_id == s.id,
        where:
          s.project_id == type(^project_id, :binary_id) and
            e.created_at >= ^from_time and e.created_at < ^to_time,
        order_by: e.created_at,
        limit: ^limit
      )
    )
  end
end
