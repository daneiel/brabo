defmodule EngineWeb.SessionChannelTest do
  @moduledoc """
  RN-108: o join do canal `session:<id>` continua exigindo que a sessão exista
  no Registry (comportamento pré-existente, intacto) e passa a exigir que o
  `project_id` do ticket (já validado por `connect/3`) bata com o `project_id`
  da sessão pedida, e CONSOME o ticket atomicamente contra o `session_id` do
  tópico — ver `Engine.Sessions.SocketTicketTest` para o uso único isolado.

  `async: false` — mesmo motivo de `SessionOwnershipTest`: `SessionServer` se
  registra em `:global`, que é global ao node de teste inteiro.
  """

  use EngineWeb.ChannelCase, async: false

  alias Engine.Sessions.{SessionServer, SessionSupervisor, SocketTicket}

  setup do
    Engine.GlobalSessionTestLock.acquire()
    Application.put_env(:engine, :engine_api_client, Engine.Sessions.FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())
    Application.put_env(:engine, :session_heartbeat_timeout_ms, 60_000)

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :test_pid)
      Application.delete_env(:engine, :session_heartbeat_timeout_ms)
      Engine.GlobalSessionTestLock.release()
    end)

    :ok
  end

  defp stop_session(session_id) do
    if pid = SessionServer.whereis(session_id) do
      :ok = Engine.Sessions.Monitor.expect_stop(session_id)
      SessionServer.stop(pid)
    end
  end

  defp insert_ticket!(ticket_bruto, attrs) do
    hash = :sha256 |> :crypto.hash(ticket_bruto) |> Base.encode16(case: :lower)

    defaults = %{
      id: Ecto.UUID.generate(),
      session_id: Ecto.UUID.generate(),
      project_id: Ecto.UUID.generate(),
      user_id: Ecto.UUID.generate(),
      scope: "heartbeat",
      ticket_hash: hash,
      expires_at: DateTime.add(DateTime.utc_now(), 30, :second),
      consumed_at: nil,
      created_at: DateTime.utc_now()
    }

    linha = Map.merge(defaults, attrs)

    %SocketTicket{}
    |> Ecto.Changeset.change(linha)
    |> Engine.Repo.insert!()

    linha
  end

  defp socket_com_assigns(assigns) do
    Phoenix.ChannelTest.socket(EngineWeb.SessionSocket, nil, assigns)
  end

  test "sessão que não existe no Registry recusa o join, mesmo com ticket válido" do
    session_id = Ecto.UUID.generate()
    project_id = Ecto.UUID.generate()

    ticket = "ticket-sessao-inexistente"
    insert_ticket!(ticket, %{session_id: session_id, project_id: project_id})

    socket = socket_com_assigns(%{ticket: ticket, project_id: project_id})

    assert {:error, %{reason: reason}} =
             Phoenix.ChannelTest.subscribe_and_join(socket, "session:#{session_id}", %{})

    assert reason =~ "não encontrada"
  end

  test "ticket do MESMO projeto consegue entrar, e o ticket é consumido" do
    session_id = Ecto.UUID.generate()
    project_id = Ecto.UUID.generate()

    {:ok, _pid} = SessionSupervisor.start_session(session_id, project_id)
    on_exit(fn -> stop_session(session_id) end)

    ticket = "ticket-mesmo-projeto"
    linha = insert_ticket!(ticket, %{session_id: session_id, project_id: project_id})

    socket = socket_com_assigns(%{ticket: ticket, project_id: project_id})

    assert {:ok, _reply, joined} =
             Phoenix.ChannelTest.subscribe_and_join(socket, "session:#{session_id}", %{})

    assert joined.assigns.session_id == session_id
    assert Engine.Repo.get!(SocketTicket, linha.id).consumed_at != nil
  end

  test "REUSO: o mesmo ticket não entra duas vezes" do
    session_id = Ecto.UUID.generate()
    project_id = Ecto.UUID.generate()

    {:ok, _pid} = SessionSupervisor.start_session(session_id, project_id)
    on_exit(fn -> stop_session(session_id) end)

    ticket = "ticket-reuso-canal"
    insert_ticket!(ticket, %{session_id: session_id, project_id: project_id})

    socket1 = socket_com_assigns(%{ticket: ticket, project_id: project_id})
    assert {:ok, _reply, _joined} =
             Phoenix.ChannelTest.subscribe_and_join(socket1, "session:#{session_id}", %{})

    socket2 = socket_com_assigns(%{ticket: ticket, project_id: project_id})

    assert {:error, %{reason: "unauthorized"}} =
             Phoenix.ChannelTest.subscribe_and_join(socket2, "session:#{session_id}", %{})
  end

  test "TICKET DE OUTRO PROJETO: project_id do assign não bate com o da sessão — join falha" do
    session_id = Ecto.UUID.generate()
    project_id_real = Ecto.UUID.generate()
    project_id_do_ticket = Ecto.UUID.generate()

    {:ok, _pid} = SessionSupervisor.start_session(session_id, project_id_real)
    on_exit(fn -> stop_session(session_id) end)

    # session_id BATE (o ticket foi emitido pra esta sessão), mas o project_id
    # do ticket é de outro projeto — isola a checagem de project_id da checagem
    # de session_id que `SocketTicket.consumir/2` já faz sozinha.
    ticket = "ticket-projeto-errado"
    linha = insert_ticket!(ticket, %{session_id: session_id, project_id: project_id_do_ticket})

    socket = socket_com_assigns(%{ticket: ticket, project_id: project_id_do_ticket})

    assert {:error, %{reason: "unauthorized"}} =
             Phoenix.ChannelTest.subscribe_and_join(socket, "session:#{session_id}", %{})

    # A checagem de projeto barra ANTES de tentar consumir — o ticket segue
    # vivo, não foi queimado por uma tentativa que nem chegou a validá-lo.
    assert Engine.Repo.get!(SocketTicket, linha.id).consumed_at == nil
  end
end
