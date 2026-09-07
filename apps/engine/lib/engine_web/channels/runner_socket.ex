defmodule EngineWeb.RunnerSocket do
  @moduledoc """
  Socket do runner local e do terminal interativo da web — separado do
  `/socket` de sessão (`EngineWeb.SessionSocket`) de propósito: os dois
  papéis que entram aqui (`runner`, o CLI na máquina do usuário; `terminal`,
  a web assistindo/interagindo) não têm sessão de chat nenhuma por trás,
  são escopados por PROJETO.

  Réplica ESTRUTURAL do padrão RN-108 de `EngineWeb.SessionSocket`
  (`connect/3` exige `params["ticket"]`, um ticket opaco de uso único), não
  a lógica de negócio: aqui o ticket vem de
  `Engine.Runners.SocketTicket` (tabela `runner_socket_tickets`, OWNED pelo
  engine — ver o moduledoc dela para o porquê do dono ter trocado de lado)
  em vez de `Engine.Sessions.SocketTicket`, e carrega `kind`
  (`"runner"`/`"terminal"`) em vez de `scope`.

  Sem ticket, ou com um inexistente/expirado/já consumido, a conexão inteira
  é recusada — não só o join do canal.

  `project_id`/`user_id`/`kind` vão pra `socket.assigns`; o CONSUMO atômico
  (que exige o `project_id` do tópico pedido — `terminal:<projectId>` —
  bater com o da linha) acontece no join do canal, não aqui: ver
  `EngineWeb.TerminalChannel.join/3`.
  """

  use Phoenix.Socket

  alias Engine.Runners.SocketTicket

  channel "terminal:*", EngineWeb.TerminalChannel

  @impl true
  def connect(%{"ticket" => ticket}, socket, _connect_info)
      when is_binary(ticket) and ticket != "" do
    case SocketTicket.validar(ticket) do
      {:ok, %{project_id: project_id, user_id: user_id, kind: kind}} ->
        socket =
          socket
          |> assign(:ticket, ticket)
          |> assign(:project_id, project_id)
          |> assign(:user_id, user_id)
          |> assign(:kind, kind)

        {:ok, socket}

      {:error, :invalid} ->
        {:error, %{reason: "unauthorized"}}
    end
  end

  def connect(_params, _socket, _connect_info), do: {:error, %{reason: "unauthorized"}}

  @doc """
  O identificador do socket, no formato que o mecanismo de desconexão forçada
  do Phoenix usa (`Endpoint.broadcast(id, "disconnect", %{})`) — ADR 0147
  ponto 6, RN-520.

  Ele DEIXOU de ser `nil`, e a razão é que revogar uma credencial passou a
  precisar alcançar a conexão viva. Sem `id/1`, o transporte não se inscreve
  em tópico nenhum e não há como pedir a ele que encerre; parar só o processo
  do CANAL deixaria o socket de pé e o cliente Phoenix tentando reentrar no
  tópico para sempre, com um ticket já consumido — degradação silenciosa, que
  é exatamente o defeito que o ADR 0147 existe para não repetir.

  Os TRÊS segmentos são o escopo: `kind` separa o CLI (`runner`) da aba
  Terminal da web (`terminal`), e o par projeto/usuário é a granularidade que
  o ticket carrega — não há mais fina, porque a identidade da CREDENCIAL não
  chega até aqui (ver `Engine.Runners.Revogacao`).
  """
  @spec socket_id(term(), term(), term()) :: String.t() | nil
  def socket_id(kind, project_id, user_id)
      when is_binary(kind) and is_binary(project_id) and is_binary(user_id) do
    "runner_socket:#{kind}:#{project_id}:#{user_id}"
  end

  def socket_id(_kind, _project_id, _user_id), do: nil

  @impl true
  def id(%{assigns: %{kind: kind, project_id: project_id, user_id: user_id}}),
    do: socket_id(kind, project_id, user_id)

  # `nil` continua sendo resposta válida: socket sem os três assigns (nunca
  # acontece pelo `connect/3` acima, mas o contrato do Phoenix permite) só
  # perde a desconexão forçada, nunca a conexão.
  def id(_socket), do: nil
end
