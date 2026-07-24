defmodule Engine.Projects.Project do
  @moduledoc """
  Leitura read-only de projects (tabela da api, Drizzle, schema "public") —
  mesmo padrão de Engine.Projects.ProjectRepository. Mapeia só os campos que
  a camada de contexto do harness lê (nome e slug do projeto); nunca
  changeset/insert.
  """

  use Ecto.Schema

  alias Engine.Repo

  @primary_key {:id, :binary_id, autogenerate: false}
  @schema_prefix "public"
  schema "projects" do
    field :name, :string
    field :slug, :string
  end

  @doc """
  Projeto por id, ou `nil` se não existir.
  """
  def get(project_id) do
    Repo.get(__MODULE__, project_id)
  end
end
