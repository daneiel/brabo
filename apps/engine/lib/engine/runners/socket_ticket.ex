defmodule Engine.Runners.SocketTicket do
  @moduledoc """
  Emissão + leitura + consumo de `runner_socket_tickets` — tabela OWNED pelo
  engine (schema "engine"), ao contrário da irmã de sessão
  (`Engine.Sessions.SocketTicket`, que lê `session_socket_tickets` — tabela
  da api, Drizzle, schema "public", onde é a API quem escreve).

  ## Por que o dono trocou de lado

  O ticket de sessão é escopado por SESSÃO, e a api já tem tudo que precisa
  (`sessionId`/`projectId`/`userId`) para inserir a linha sozinha antes de
  devolver o ticket bruto ao cliente. O ticket de runner/terminal é escopado
  por PROJETO — não há sessão de chat no meio — e o dono da tabela é quem
  PRECISA lê-la em `connect/3` (o engine, sempre); trocar o dono evita que a
  api precise de acesso de escrita ao schema "engine" só para esta única
  tabela. Por isso a api PEDE o ticket por HTTP interno
  (`POST /internal/projects/:projectId/runner-tickets`,
  `EngineWeb.RunnerTicketCommandController`) em vez de inserir direto — o
  inverso exato do fluxo de sessão.

  ## Por que `validar/1` E `consumir/2`, e não uma função só

  Mesmo raciocínio de `Engine.Sessions.SocketTicket`: `connect/3` do socket
  ainda não sabe qual tópico (`terminal:<projectId>`) vai ser pedido —
  `validar/1` decide se a CONEXÃO é aceita (sem marcar nada), e
  `consumir/2`, chamado pelo `join/3` do canal, faz o UPDATE condicional que
  EXIGE o `project_id` do tópico pedido bater com o da linha. Entre os dois
  não há janela de valor: sem join não há broadcast nenhum pro socket.

  ## Por que SHA-256 puro

  Mesmo argumento do irmão de sessão: o token bruto é 256 bits de CSPRNG,
  sem dicionário possível — HMAC com pepper não protegeria nada a mais, e
  duplicaria segredo de auth que hoje só a api conhece.

  ## A credencial que emitiu o ticket (ADR 0201, RN-685)

  Até a RN-685 a linha guardava `project_id`/`user_id`/`kind` e nada mais, e
  por isso a revogação só sabia mirar o par `{projeto, usuário}` (RN-520). A
  api passou a dizer QUAL credencial pediu o ticket — `credential_kind`
  (`"device_key"` ou `"pat"`) e `credential_id` (o `kid` da chave, que é o id
  do registro, RN-475; ou o id do PAT) —, e é isso que vai para
  `socket.assigns.credencial` e deixa a revogação derrubar só as conexões
  daquela credencial.

  Credencial AUSENTE é estado legítimo, e não vira recusa: o ticket de
  `terminal` é da aba da web (sessão, sem credencial de dispositivo), e o de
  `runner` emitido por uma api anterior a esta mudança chega sem ela durante
  o rollout. Um par incompleto ou de espécie desconhecida também vira AUSENTE
  — nunca uma credencial inventada, que faria a revogação mirar o que não
  existe.
  """

  use Ecto.Schema

  import Ecto.Query

  alias Engine.Repo

  @primary_key {:id, :string, autogenerate: false}
  @schema_prefix "engine"
  schema "runner_socket_tickets" do
    field :project_id, :string
    field :user_id, :string
    field :kind, :string
    field :credential_kind, :string
    field :credential_id, :string
    field :ticket_hash, :string
    field :expires_at, :utc_datetime_usec
    field :consumed_at, :utc_datetime_usec
    field :created_at, :utc_datetime_usec
  end

  # TTL curto de propósito, mesmo valor de `SOCKET_TICKET_TTL_MS` do lado
  # api (RN-108) — o ticket é de uso único e vive só o tempo do `connect/3`
  # seguinte.
  @ttl_ms 30_000

  @kinds ~w(runner terminal)

  @especies_de_credencial ~w(device_key pat)

  @typedoc "A credencial que emitiu o ticket — `nil` quando não há (ver moduledoc)."
  @type credencial :: %{kind: String.t(), id: String.t()} | nil

  @doc "Os dois papéis que um ticket pode carregar — ver moduledoc do `EngineWeb.TerminalChannel`."
  def kinds, do: @kinds

  @doc """
  Normaliza o par vindo do pedido interno: `%{kind:, id:}` só quando os DOIS
  existem e a espécie é conhecida (`"device_key"` | `"pat"`); `nil` em
  qualquer outro caso.
  """
  @spec credencial(term(), term()) :: credencial()
  def credencial(kind, id)
      when kind in @especies_de_credencial and is_binary(id) and id != "",
      do: %{kind: kind, id: id}

  def credencial(_kind, _id), do: nil

  @doc """
  Gera e persiste um ticket novo para `project_id`/`user_id`/`kind`, com a
  `credencial` que o pediu (ou `nil`). Devolve
  `{:ok, %{ticket: <bruto>, expires_at: DateTime}}` — o valor BRUTO só existe
  neste retorno; a linha grava só o hash.
  """
  def emitir(project_id, user_id, kind, credencial \\ nil) when kind in @kinds do
    # 32 bytes de CSPRNG, mesma escolha do irmão de sessão e de
    # `CreateSocketTicketUseCase` do lado api.
    bruto = 32 |> :crypto.strong_rand_bytes() |> Base.url_encode64(padding: false)
    agora = agora_usec()
    expira = DateTime.add(agora, @ttl_ms, :millisecond)

    resultado =
      Repo.insert(%__MODULE__{
        id: Ecto.UUID.generate(),
        project_id: project_id,
        user_id: user_id,
        kind: kind,
        credential_kind: credencial && credencial.kind,
        credential_id: credencial && credencial.id,
        ticket_hash: hash(bruto),
        expires_at: expira,
        created_at: agora
      })

    case resultado do
      {:ok, _linha} -> {:ok, %{ticket: bruto, expires_at: expira}}
      {:error, _} = erro -> erro
    end
  end

  @doc """
  Chamado por `EngineWeb.RunnerSocket.connect/3`: existe, não expirou, não
  foi consumido? SEM marcar consumido. Devolve `{:ok, %{project_id:,
  user_id:, kind:, credencial:}}` ou `{:error, :invalid}` — os três motivos
  de recusa (inexistente, expirado, já consumido) respondem igual, de
  propósito, mesmo raciocínio do irmão de sessão.
  """
  def validar(ticket_bruto) do
    hash = hash(ticket_bruto)

    query =
      from t in __MODULE__,
        where:
          t.ticket_hash == ^hash and
            is_nil(t.consumed_at) and
            t.expires_at > ^DateTime.utc_now(),
        select: %{
          project_id: t.project_id,
          user_id: t.user_id,
          kind: t.kind,
          credential_kind: t.credential_kind,
          credential_id: t.credential_id
        }

    case Repo.one(query) do
      nil -> {:error, :invalid}
      linha -> {:ok, com_credencial(linha)}
    end
  end

  @doc """
  Chamado por `EngineWeb.TerminalChannel.join/3`: consome atomicamente,
  exigindo que o `project_id` bata com o do tópico pedido
  (`terminal:<projectId>`). O `UPDATE` condicional É a guarda, sem `SELECT`
  antes — reuso, ticket de outro projeto, corrida concorrente e ticket
  anulado por revogação (`anular_pendentes_da_credencial/1`) caem todos em
  `{:error, :invalid}`.
  """
  def consumir(ticket_bruto, project_id) do
    hash = hash(ticket_bruto)

    query =
      from t in __MODULE__,
        where:
          t.ticket_hash == ^hash and
            t.project_id == ^project_id and
            is_nil(t.consumed_at) and
            t.expires_at > ^DateTime.utc_now(),
        select: %{
          project_id: t.project_id,
          user_id: t.user_id,
          kind: t.kind,
          credential_kind: t.credential_kind,
          credential_id: t.credential_id
        }

    case Repo.update_all(query, set: [consumed_at: agora_usec()]) do
      {1, [linha]} -> {:ok, com_credencial(linha)}
      {0, _} -> {:error, :invalid}
    end
  end

  @doc """
  Anula os tickets AINDA NÃO CONSUMIDOS de `credencial` — chamado na
  revogação (ADR 0201, RN-685), ANTES de derrubar as conexões vivas.

  Fecha a janela entre emitir e usar: um ticket pedido segundos antes da
  revogação ainda passaria no `connect/3` e no `join/3` depois dela, e a
  conexão nasceria de uma credencial já revogada. Marcar `consumed_at` é o
  mesmo estado de "já usado" que `validar/1` e `consumir/2` recusam — nenhum
  estado novo. Devolve quantas linhas anulou. Credencial `nil` não anula
  nada: sem espécie e id não há o que mirar.
  """
  @spec anular_pendentes_da_credencial(credencial()) :: non_neg_integer()
  def anular_pendentes_da_credencial(%{kind: kind, id: id}) do
    query =
      from t in __MODULE__,
        where:
          t.credential_kind == ^kind and
            t.credential_id == ^id and
            is_nil(t.consumed_at)

    {n, _} = Repo.update_all(query, set: [consumed_at: agora_usec()])
    n
  end

  def anular_pendentes_da_credencial(_), do: 0

  defp com_credencial(linha) do
    linha
    |> Map.put(:credencial, credencial(linha.credential_kind, linha.credential_id))
    |> Map.drop([:credential_kind, :credential_id])
  end

  defp agora_usec, do: DateTime.utc_now() |> DateTime.truncate(:microsecond)

  defp hash(ticket_bruto) do
    :sha256 |> :crypto.hash(ticket_bruto) |> Base.encode16(case: :lower)
  end
end
