defmodule Engine.Projects.ProjectRepository do
  @moduledoc """
  Leitura read-only de project_repositories (tabela da api, gerenciada por
  Drizzle) — mesmo padrão de Engine.SessionEvents.Event: nunca
  changeset/insert aqui, só consulta direta (mesmo Postgres, schema "public").

  Desde o ADR 0056 este módulo responde a DUAS perguntas diferentes, e separá-las
  é o que destravou metade dos consumidores:

  - `default_branch/1` — só o nome da branch. Não precisa de credencial nem de
    provider `local`, e **nunca precisou**: `Engine.Gates.Diff` e
    `Engine.Harness.ProjectContext` paravam em provider remoto por dano
    colateral de uma função que devolvia mais do que eles pediam.
  - `remoto_de_trabalho/1` — o que materializa o working tree. Para provider
    remoto, a credencial vem da api (ver `Engine.Sessions.EngineApiClient`).

  Desde a RN-577 responde a uma TERCEIRA, a mais barata das três: se o projeto
  TEM repositório (`recusa_de_pr_sem_repositorio/2`). É a pergunta que as tools
  que propõem PR (`open_adr_pr` do Arquiteto, `open_infra_pr` do Infra Lead)
  fazem ANTES de propor, para não pôr na fila de aprovação uma ação que o caso
  de uso de execução só pode recusar.
  """

  use Ecto.Schema

  alias Engine.Repo
  alias Engine.Sessions.EngineApiClient

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
  A branch default do projeto, seja qual for o provider.

  `{:error, :not_found}` só quando o projeto nunca teve repositório.
  """
  def default_branch(project_id) do
    case Repo.get_by(__MODULE__, project_id: project_id) do
      nil -> {:error, :not_found}
      %{default_branch: branch} -> {:ok, branch}
    end
  end

  @doc """
  `nil` quando o projeto TEM repositório; motivo NOMEADO quando não tem
  (RN-577). O motivo é resultado de ferramenta que o modelo lê (RN-163), nunca
  `agent.error`.

  O predicado é o MESMO do caso de uso que executaria a ação na api
  (`ProvisionedRepositoryRepository.findByProjectId` em
  `ExecuteAdrPrUseCase`/`ExecuteInfraPrUseCase`: existe linha em
  `project_repositories` para o projeto) — lido aqui, localmente, do mesmo
  Postgres, sem HTTP no laço do agente. Se os dois divergissem, a tool deixaria
  passar o que a execução recusa (o defeito da AT-088) ou recusaria o que a
  execução aceitaria. Os casos de uso continuam recusando como antes: isto é
  uma camada ANTES, nunca no lugar.

  O texto diz o que falta e QUANDO passa a existir, sem decidir onde o
  repositório deveria nascer: hoje ele nasce no aceite do handoff do Arquiteto
  para o Dev Lead (RN-522/RN-541), ou na adoção de um repositório existente.
  """
  def recusa_de_pr_sem_repositorio(project_id, tipo_de_acao) do
    case Repo.get_by(__MODULE__, project_id: project_id) do
      nil ->
        "projeto sem repositório provisionado — `#{tipo_de_acao}` não foi " <>
          "proposta, porque aprovada ela só poderia falhar. O repositório " <>
          "deste projeto ainda não existe: ele nasce quando o handoff do " <>
          "Arquiteto para o Dev Lead é aceito (RN-522). Não repita a chamada " <>
          "agora; ela passa a valer depois desse aceite."

      _repo ->
        nil
    end
  end

  @doc """
  O remoto de trabalho: `%{kind, origin, default_branch, token, username}`.

  `local` é resolvido AQUI, direto do banco, e de propósito: não depende de a
  api estar no ar, é o que o `pnpm dev` e a suite inteira exercitam, e não há
  credencial para buscar. Provider remoto pergunta à api, que é quem tem a
  chave mestra — o engine não a recebe e não persiste nada do que volta.
  """
  def remoto_de_trabalho(project_id) do
    case Repo.get_by(__MODULE__, project_id: project_id) do
      nil ->
        {:error, :not_found}

      %{provider: "local", external_id: path, default_branch: branch} ->
        {:ok, %{kind: :local, origin: path, default_branch: branch, token: nil, username: nil}}

      %{provider: _remoto, default_branch: branch} ->
        remoto_pela_api(project_id, branch)
    end
  end

  defp remoto_pela_api(project_id, branch_do_banco) do
    case EngineApiClient.get_git_remote(project_id) do
      {:ok, %{origin: origin} = remoto} when is_binary(origin) and origin != "" ->
        {:ok,
         %{
           kind: :remote,
           origin: origin,
           default_branch: remoto[:default_branch] || branch_do_banco,
           token: remoto[:token],
           username: remoto[:username]
         }}

      {:ok, _sem_origem} ->
        # A api respondeu, mas sem origem utilizável. Vira erro NOMEADO em vez
        # de um remoto meia-boca que falharia depois, longe daqui — é a regra
        # do CLAUDE.md sobre desfecho de falha dizer a origem (achados P/Q/T).
        {:error, {:remoto_indisponivel, :sem_origem}}

      {:error, reason} ->
        {:error, {:remoto_indisponivel, reason}}
    end
  end

  @doc """
  Path do bare repo local. Mantida para quem só sabe trabalhar com `local`.

  Prefira `remoto_de_trabalho/1`: esta recusa provider remoto por construção, e
  foi essa recusa que parou o dev agent em projeto do GitHub.
  """
  def get_local_repo_path(project_id) do
    case Repo.get_by(__MODULE__, project_id: project_id) do
      nil -> {:error, :not_found}
      %{provider: "local", external_id: path, default_branch: branch} -> {:ok, path, branch}
      %{provider: other} -> {:error, {:unsupported_provider, other}}
    end
  end
end
