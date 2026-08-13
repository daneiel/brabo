defmodule Engine.Projects.Project do
  @moduledoc """
  Leitura read-only de projects (tabela da api, Drizzle, schema "public") —
  mesmo padrão de Engine.Projects.ProjectRepository. Mapeia só os campos que
  a camada de contexto do harness lê (nome e slug do projeto) e o nome de
  pasta do workspace (RN-109); nunca changeset/insert.
  """

  use Ecto.Schema
  import Ecto.Query

  alias Engine.Repo

  @primary_key {:id, :binary_id, autogenerate: false}
  @schema_prefix "public"
  schema "projects" do
    field :name, :string
    field :slug, :string
    field :workspace_dir_name, :string
  end

  @doc """
  Projeto por id, ou `nil` se não existir.
  """
  def get(project_id) do
    Repo.get(__MODULE__, project_id)
  end

  @doc """
  Ids de todos os projetos — usado pelo tick periódico da Anamnese
  (Fase 4b) pra fazer fan-out de uma rodada por projeto.
  """
  def list_ids do
    Repo.all(from(p in __MODULE__, select: p.id))
  end

  @doc """
  O nome de pasta do workspace de um projeto (RN-109) — `nil` se o projeto não
  existir, se `project_id` não tiver forma de UUID, ou se a consulta falhar
  por qualquer motivo. `Engine.Actions.Workspace.workspace_dir/1` é quem
  decide o que fazer quando vem `nil` (hoje: cai de volta no `project_id`
  cru, o mesmo comportamento de antes desta coluna existir).

  As duas guardas (forma de UUID antes da consulta, `rescue`/`catch` ao
  redor dela) não são excesso de zelo: `project_id` chega como string
  qualquer em MUITOS testes do engine que nunca tocaram o banco antes de
  `workspace_dir/1` ganhar esta resolução (`"project-42"`, literais fixos) —
  um `binary_id` mal-formado levantava `Ecto.Query.CastError`, e chamar isto
  de um processo sem conexão do Sandbox alocada levantava
  `DBConnection.OwnershipError`. As duas são o MESMO caso, visto de fora:
  "não deu pra resolver" — e a resposta é degradar pro fallback, nunca
  propagar a falha pra quem só queria um caminho de disco.

  `coalesce` cobre a linha cujo `workspace_dir_name` está null no PRÓPRIO
  banco — nunca deveria acontecer em produção (a coluna é NOT NULL lá,
  RN-109), mas o fixture de teste do engine (`test/test_helper.exs`) mantém a
  coluna nullable de propósito: são 50+ specs da api que inserem `projects`
  sem saber deste conceito, e não é este módulo quem deveria ensiná-los.
  """
  def workspace_dir_name(project_id) do
    case Ecto.UUID.cast(project_id) do
      :error ->
        nil

      {:ok, _} ->
        Repo.one(
          from p in __MODULE__,
            where: p.id == ^project_id,
            select: fragment("coalesce(?, ?::text)", p.workspace_dir_name, p.id)
        )
    end
  rescue
    _ -> nil
  catch
    :exit, _ -> nil
  end

  @doc """
  `%{id, workspace_dir_name}` de TODOS os projetos, numa consulta só — usado
  pela poda de worktrees órfãos (`Engine.Dev.WorktreeCleanup`), que precisa
  saber a QUE projeto cada pasta em disco pertence sem uma consulta por
  projeto (ver comentário lá).
  """
  def all_workspace_dirs do
    Repo.all(
      from p in __MODULE__,
        select: %{
          id: p.id,
          workspace_dir_name: fragment("coalesce(?, ?::text)", p.workspace_dir_name, p.id)
        }
    )
  end
end
