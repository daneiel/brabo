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

  @impl true
  def id(_socket), do: nil
end
