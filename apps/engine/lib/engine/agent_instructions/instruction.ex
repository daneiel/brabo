defmodule Engine.AgentInstructions.Instruction do
  @moduledoc """
  Leitura read-only de agent_instructions (tabela da api, gerenciada por
  Drizzle no schema "public") — mesmo padrão de
  Engine.Projects.ProjectRepository: nunca changeset/insert aqui, só
  consulta direta. É o "arquivo de agente no banco" que o
  Engine.Harness.InstructionFiles mescla com os AGENTS.md do workspace, com
  a MAIOR precedência (banco > diretório > raiz).

  Uma linha ativa por (project_id, agent); `version` é bumpado pela api no
  update, nunca é histórico.
  """

  use Ecto.Schema

  alias Engine.Repo

  @primary_key {:id, :binary_id, autogenerate: false}
  @schema_prefix "public"
  schema "agent_instructions" do
    field :project_id, :binary_id
    field :agent, :string
    field :content, :string
    field :version, :integer
  end

  @doc """
  Conteúdo da instrução do agente no projeto, ou `nil` se não houver linha.
  """
  def get(project_id, agent) do
    Repo.get_by(__MODULE__, project_id: project_id, agent: agent)
  end
end
