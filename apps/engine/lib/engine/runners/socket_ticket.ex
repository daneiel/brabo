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

  @doc "Os dois papéis que um ticket pode carregar — ver moduledoc do `EngineWeb.TerminalChannel`."
  def kinds, do: @kinds

  @doc """
  Gera e persiste um ticket novo para `project_id`/`user_id`/`kind`. Devolve
  `{:ok, %{ticket: <bruto>, expires_at: DateTime}}` — o valor BRUTO só existe
  neste retorno; a linha grava só o hash.
  """
  def emitir(project_id, user_id, kind) when kind in @kinds do
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
  user_id:, kind:}}` ou `{:error, :invalid}` — os três motivos de recusa
  (inexistente, expirado, já consumido) respondem igual, de propósito, mesmo
  raciocínio do irmão de sessão.
  """
  def validar(ticket_bruto) do
    hash = hash(ticket_bruto)

    query =
      from t in __MODULE__,
        where:
          t.ticket_hash == ^hash and
            is_nil(t.consumed_at) and
            t.expires_at > ^DateTime.utc_now(),
        select: %{project_id: t.project_id, user_id: t.user_id, kind: t.kind}

    case Repo.one(query) do
      nil -> {:error, :invalid}
      linha -> {:ok, linha}
    end
  end

  @doc """
  Chamado por `EngineWeb.TerminalChannel.join/3`: consome atomicamente,
  exigindo que o `project_id` bata com o do tópico pedido
  (`terminal:<projectId>`). O `UPDATE` condicional É a guarda, sem `SELECT`
  antes — reuso, ticket de outro projeto e corrida concorrente caem todos
  em `{:error, :invalid}`.
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
        select: %{project_id: t.project_id, user_id: t.user_id, kind: t.kind}

    case Repo.update_all(query, set: [consumed_at: agora_usec()]) do
      {1, [linha]} -> {:ok, linha}
      {0, _} -> {:error, :invalid}
    end
  end

  defp agora_usec, do: DateTime.utc_now() |> DateTime.truncate(:microsecond)

  defp hash(ticket_bruto) do
    :sha256 |> :crypto.hash(ticket_bruto) |> Base.encode16(case: :lower)
  end
end
