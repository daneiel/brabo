defmodule Engine.Projects.ProjectRepository do
  @moduledoc """
  Leitura read-only de project_repositories (tabela da api, gerenciada por
  Drizzle) — mesmo padrão de Engine.SessionEvents.Event: nunca
  changeset/insert aqui, só consulta direta (mesmo Postgres, schema
  "public"). Único jeito do engine saber onde fica o bare repo local de um
  projeto pra derivar o workspace (ver Engine.Actions.Workspace).
  """

  use Ecto.Schema

  alias Engine.Repo

  @primary_key {:id, :binary_id, autogenerate: false}
  @schema_prefix "public"
  schema "project_repositories" do
    field :project_id, :binary_id
    field :provider, :string
    field :external_id, :string
    field :url, :string
    field :default_branch, :string
  end

  @doc """
  Path absoluto do bare repo local do projeto. Só suporta o provider
  'local' (github/gitlab remotos ficam fora de escopo do executor de
  terminal por ora) — {:error, :unsupported_provider} nos demais, e
  {:error, :not_found} se o projeto nunca teve repositório provisionado.
  """
  def get_local_repo_path(project_id) do
    case Repo.get_by(__MODULE__, project_id: project_id) do
      nil -> {:error, :not_found}
      %{provider: "local", external_id: path, default_branch: branch} -> {:ok, path, branch}
      %{provider: other} -> {:error, {:unsupported_provider, other}}
    end
  end
end
