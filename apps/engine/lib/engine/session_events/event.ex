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

  def list(session_id) do
    Repo.all(from(e in __MODULE__, where: e.session_id == ^session_id, order_by: e.seq))
  end
end
