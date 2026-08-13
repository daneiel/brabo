defmodule Engine.Sessions.SocketTicket do
  @moduledoc """
  Leitura + consumo de `session_socket_tickets` — tabela existente,
  gerenciada pela api via Drizzle (schema "public"). Mesmo padrão de
  `Engine.Outbox.Event` sobre `outbox_events`: o engine nunca roda migration
  própria pra essa tabela e nunca faz changeset/insert; a única escrita é o
  `UPDATE` condicional e estreito que o uso único exige — não é uma exceção à
  regra de "read-only", é o mesmo tipo de escrita que `Outbox.Drain` já faz em
  `processed_at`.

  RN-108: o ticket autentica `connect/3` de `EngineWeb.SessionSocket`, e fecha
  o gap que o moduledoc daquele módulo documentava como limitação deliberada.

  ## Por que `validar/1` E `consumir/2`, e não uma função só

  `connect/3` do socket ainda não sabe qual `session_id` vai ser pedido — o
  tópico (`session:<id>`) só existe no JOIN do canal, que roda depois. Marcar
  o ticket como consumido em `connect/3` amarraria o uso único ao socket, não
  à sessão certa: um ticket emitido para a sessão A poderia autenticar o
  socket e nunca ser exigido a bater com sessão nenhuma. `validar/1` faz um
  SELECT (existe, não expirou, não foi consumido — sem marcar nada) para
  `connect/3` decidir aceitar ou recusar a conexão; `consumir/2` faz o UPDATE
  condicional que EXIGE o `session_id` do tópico pedido bater com o da linha,
  e é isso que `SessionChannel.join/3` chama. Entre os dois não há janela de
  valor: sem JOIN não há broadcast nenhum pro socket, então um ticket que
  passou em `validar/1` mas nunca foi consumido não deu nada a quem o tem.

  ## Por que SHA-256 puro, e não HMAC com pepper

  Ver o comentário em `apps/api/src/db/schema.ts` sobre `sessionSocketTickets`
  — o engine não tem acesso ao pepper derivado de `AUTH_TOKEN_PEPPER`/
  `AUTH_JWT_SECRET` da api, e exigir isso duplicaria segredo de auth entre os
  dois serviços só para verificar um token de 256 bits de CSPRNG que não tem
  dicionário possível de qualquer jeito.
  """

  use Ecto.Schema

  import Ecto.Query

  alias Engine.Repo

  @primary_key {:id, :binary_id, autogenerate: false}
  @schema_prefix "public"
  schema "session_socket_tickets" do
    field :session_id, :binary_id
    field :project_id, :binary_id
    field :user_id, :binary_id
    field :scope, :string
    field :ticket_hash, :string
    field :expires_at, :utc_datetime_usec
    field :consumed_at, :utc_datetime_usec
    field :created_at, :utc_datetime_usec
  end

  @doc """
  Chamado por `connect/3` do socket: existe, não expirou, não foi consumido?
  SEM marcar consumido (ver moduledoc). Devolve `{:ok, %{project_id:,
  user_id:, scope:}}` ou `{:error, :invalid}` — inexistente, expirado e já
  consumido respondem TODOS igual, de propósito: distinguir os três a quem
  está tentando conectar é dar informação de graça pra quem está adivinhando.
  """
  def validar(ticket_bruto) do
    hash = hash(ticket_bruto)

    query =
      from t in __MODULE__,
        where:
          t.ticket_hash == ^hash and
            is_nil(t.consumed_at) and
            t.expires_at > ^DateTime.utc_now(),
        select: %{project_id: t.project_id, user_id: t.user_id, scope: t.scope}

    case Repo.one(query) do
      nil -> {:error, :invalid}
      linha -> {:ok, linha}
    end
  end

  @doc """
  Chamado por `SessionChannel.join/3`: consome atomicamente, exigindo que o
  `session_id` bata com o do tópico pedido. O `UPDATE` condicional É a
  guarda — sem `SELECT` antes, mesmo raciocínio do
  `AccountTokenRepository.consumir` do lado api (Fase 7a): reuso, ticket de
  outra sessão e corrida concorrente caem todos em `{:error, :invalid}`, e o
  Postgres resolve a corrida sozinho (o perdedor bate no `where` já com
  `consumed_at` preenchido pelo vencedor).
  """
  def consumir(ticket_bruto, session_id) do
    hash = hash(ticket_bruto)

    query =
      from t in __MODULE__,
        where:
          t.ticket_hash == ^hash and
            t.session_id == ^session_id and
            is_nil(t.consumed_at) and
            t.expires_at > ^DateTime.utc_now(),
        select: %{project_id: t.project_id, user_id: t.user_id, scope: t.scope}

    case Repo.update_all(query, set: [consumed_at: DateTime.utc_now()]) do
      {1, [linha]} -> {:ok, linha}
      {0, _} -> {:error, :invalid}
    end
  end

  defp hash(ticket_bruto) do
    :sha256 |> :crypto.hash(ticket_bruto) |> Base.encode16(case: :lower)
  end
end
