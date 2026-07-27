defmodule Engine.Sessions.ProjectSession do
  @moduledoc """
  Leitura read-only de `sessions` (tabela da api, Drizzle, schema
  "public") — mesmo padrão de `Engine.SessionEvents.Event`/
  `Engine.Projects.Project`; nunca changeset/insert.

  Existe pra a Anamnese (Fase 4b), que é project-scoped mas precisa de um
  `session_id` pra narrar eventos e atribuir custo (`append_event` e
  `token_usage` são session-scoped por FK). Usa a sessão mais recente do
  projeto — a rodada é sobre o projeto todo, a sessão é só o endereço da
  narração.
  """

  use Ecto.Schema
  import Ecto.Query

  alias Engine.Repo

  @primary_key {:id, :binary_id, autogenerate: false}
  @schema_prefix "public"
  schema "sessions" do
    field :project_id, :binary_id
    field :created_at, :utc_datetime
  end

  @doc "Id da sessão mais recente do projeto, ou `nil` se não houver."
  def latest_id(project_id) do
    Repo.one(
      from(s in __MODULE__,
        where: s.project_id == type(^project_id, :binary_id),
        order_by: [desc: s.created_at],
        limit: 1,
        select: s.id
      )
    )
  end
end
