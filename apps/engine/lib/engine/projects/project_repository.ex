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
  repositório deveria nascer: desde a RN-582 (ADR 0165) ele nasce no aceite do
  handoff AO Arquiteto — antes do primeiro turno dele —, com o aceite ao Dev
  Lead como segunda porta idempotente, ou na adoção de um repositório
  existente. Com o gatilho ali, um agente que chega a esta recusa está num
  projeto cujo provisionamento FALHOU no aceite (há `repository.provision_failed`
  na sessão) ou que passou pelo Arquiteto antes da RN-582 — e o texto diz as
  duas saídas, em vez de mandar esperar um aceite que já aconteceu.
  """
  def recusa_de_pr_sem_repositorio(project_id, tipo_de_acao) do
    case Repo.get_by(__MODULE__, project_id: project_id) do
      nil ->
        "projeto sem repositório provisionado — `#{tipo_de_acao}` não foi " <>
          "proposta, porque aprovada ela só poderia falhar. O repositório " <>
          "deste projeto ainda não existe: ele nasce quando o handoff ao " <>
          "Arquiteto é aceito (RN-582), e se esse aceite já aconteceu o " <>
          "provisionamento falhou — o evento `repository.provision_failed` " <>
          "diz por quê. Diga isso ao usuário: aceitar o handoff ao Dev Lead " <>
          "provisiona de novo, e a página de provisionamento do projeto " <>
          "também. Não repita a chamada agora; ela passa a valer quando o " <>
          "repositório existir."

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

  # RN-664 (AT-250) — a branch de TRABALHO. Não confundir com
  # `default_branch`: aquela é a do provider (a que um clone abre, e a que a
  # promoção alcança por último), esta é onde o trabalho dos agentes nasce e
  # para onde as PRs deles vão — a política de branches do produto (trabalho
  # nasce de `dev`), que o bootstrap cria (`bootstrap-steps.ts`). O mesmo valor
  # mora na api como `BRANCH_DE_TRABALHO`
  # (`apps/api/src/domain/actions/protected-branches.ts`); os dois mudam juntos.
  @branch_de_trabalho "dev"

  @doc """
  A branch de trabalho dos agentes (RN-664): a base do workspace, a base do
  worktree de cada dev agent, o alvo do `pr_open` e o lado esquerdo do diff
  que o gate julga. Os TRÊS usam esta função, e mudam juntos — só um deles
  mudando deixaria o gate julgando um diff que não é o da PR.
  """
  def branch_de_trabalho, do: @branch_de_trabalho

  @doc """
  `{:ok, "dev"}` quando o projeto tem repositório; `{:error, :not_found}`
  quando nunca teve — o MESMO contrato de `default_branch/1`, para quem trocou
  uma pela outra (`Engine.Gates.Diff`, `Engine.Harness.ProjectContext`).

  Não pergunta se a branch EXISTE no repositório: quem precisa dela de verdade
  (o workspace, o worktree, o `git diff`, o provider que abre a PR) falha
  NOMEANDO a ausência — nunca cai em silêncio para `default_branch`.
  """
  def branch_de_trabalho(project_id) do
    case Repo.get_by(__MODULE__, project_id: project_id) do
      nil -> {:error, :not_found}
      _repo -> {:ok, @branch_de_trabalho}
    end
  end

  @doc """
  A recusa NOMEADA de quando o repositório do projeto não tem a branch de
  trabalho (RN-664) — repositório ADOTADO sem bootstrap, ou bootstrap que não
  chegou ao passo `create_dev_branch`. Não há queda para a branch default:
  trabalhar sobre ela e abrir a PR em `dev` seria julgar e propor um diff que
  não é o da PR.
  """
  def mensagem_sem_branch_de_trabalho(onde) do
    "o repositório do projeto não tem a branch `#{@branch_de_trabalho}` " <>
      "(#{onde}) — o trabalho dos agentes nasce dela e as PRs deles miram " <>
      "nela (RN-664), e não há queda para a branch default. Crie a branch " <>
      "`#{@branch_de_trabalho}` no repositório (o plano de bootstrap do " <>
      "projeto a cria) e tente de novo."
  end
end
