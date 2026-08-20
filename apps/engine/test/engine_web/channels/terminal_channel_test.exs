defmodule EngineWeb.TerminalChannelTest do
  @moduledoc """
  Join do canal `terminal:<projectId>` — dois papéis (`:runner`/`:web`)
  compartilhando o mesmo tópico.

  `async: false`: `Engine.Runners.Registry` usa `:global`, que é global ao
  node de teste inteiro (mesmo motivo de `EngineWeb.SessionChannelTest`).
  """

  use EngineWeb.ChannelCase, async: false

  alias Engine.Runners.{Registry, SocketTicket}

  setup do
    Application.put_env(:engine, :engine_api_client, Engine.Sessions.FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :test_pid)
    end)

    :ok
  end

  defp socket_com_assigns(assigns) do
    Phoenix.ChannelTest.socket(EngineWeb.RunnerSocket, nil, assigns)
  end

  defp emitir_e_conectar!(project_id, kind, user_id \\ nil) do
    {:ok, %{ticket: bruto}} =
      SocketTicket.emitir(project_id, user_id || Ecto.UUID.generate(), kind)

    socket_com_assigns(%{ticket: bruto, project_id: project_id, user_id: user_id, kind: kind})
  end

  test "ticket válido com kind \"runner\" entra e registra a presença" do
    project_id = Ecto.UUID.generate()
    socket = emitir_e_conectar!(project_id, "runner")

    refute Registry.connected?(project_id)

    assert {:ok, _reply, joined} =
             Phoenix.ChannelTest.subscribe_and_join(socket, "terminal:#{project_id}", %{})

    assert joined.assigns.role == :runner
    assert Registry.connected?(project_id)
  end

  test "ticket válido com kind \"terminal\" entra com papel :web, sem exigir exclusividade" do
    project_id = Ecto.UUID.generate()
    socket1 = emitir_e_conectar!(project_id, "terminal")
    socket2 = emitir_e_conectar!(project_id, "terminal")

    assert {:ok, _reply, joined1} =
             Phoenix.ChannelTest.subscribe_and_join(socket1, "terminal:#{project_id}", %{})

    assert {:ok, _reply, joined2} =
             Phoenix.ChannelTest.subscribe_and_join(socket2, "terminal:#{project_id}", %{})

    assert joined1.assigns.role == :web
    assert joined2.assigns.role == :web
    # Vários :web não contam como runner conectado.
    refute Registry.connected?(project_id)
  end

  test "REUSO: o mesmo ticket não entra duas vezes" do
    project_id = Ecto.UUID.generate()
    {:ok, %{ticket: bruto}} = SocketTicket.emitir(project_id, Ecto.UUID.generate(), "runner")

    socket1 = socket_com_assigns(%{ticket: bruto, project_id: project_id, kind: "runner"})

    assert {:ok, _reply, _joined} =
             Phoenix.ChannelTest.subscribe_and_join(socket1, "terminal:#{project_id}", %{})

    socket2 = socket_com_assigns(%{ticket: bruto, project_id: project_id, kind: "runner"})

    assert {:error, %{reason: "unauthorized"}} =
             Phoenix.ChannelTest.subscribe_and_join(socket2, "terminal:#{project_id}", %{})
  end

  test "TICKET DE OUTRO PROJETO: project_id do assign não bate com o do tópico pedido — join falha" do
    project_id_real = Ecto.UUID.generate()
    project_id_do_ticket = Ecto.UUID.generate()

    {:ok, %{ticket: bruto}} =
      SocketTicket.emitir(project_id_do_ticket, Ecto.UUID.generate(), "terminal")

    socket =
      socket_com_assigns(%{ticket: bruto, project_id: project_id_do_ticket, kind: "terminal"})

    assert {:error, %{reason: "unauthorized"}} =
             Phoenix.ChannelTest.subscribe_and_join(socket, "terminal:#{project_id_real}", %{})
  end

  test "segundo join com role :runner no MESMO projeto é recusado" do
    project_id = Ecto.UUID.generate()

    socket1 = emitir_e_conectar!(project_id, "runner")

    assert {:ok, _reply, _joined} =
             Phoenix.ChannelTest.subscribe_and_join(socket1, "terminal:#{project_id}", %{})

    socket2 = emitir_e_conectar!(project_id, "runner")

    assert {:error, %{reason: motivo}} =
             Phoenix.ChannelTest.subscribe_and_join(socket2, "terminal:#{project_id}", %{})

    assert motivo =~ "já existe um runner"
  end

  test "um segundo runner consegue conectar depois que o primeiro cai" do
    project_id = Ecto.UUID.generate()

    socket1 = emitir_e_conectar!(project_id, "runner")

    {:ok, _reply, joined1} =
      Phoenix.ChannelTest.subscribe_and_join(socket1, "terminal:#{project_id}", %{})

    assert Registry.connected?(project_id)

    Process.unlink(joined1.channel_pid)
    ref = Process.monitor(joined1.channel_pid)
    Process.exit(joined1.channel_pid, :shutdown)
    assert_receive {:DOWN, ^ref, :process, _, _}, 1_000

    # `:global` desregistra sozinho quando o dono morre (moduledoc do Registry).
    wait_until(fn -> not Registry.connected?(project_id) end)

    socket2 = emitir_e_conectar!(project_id, "runner")

    assert {:ok, _reply, _joined2} =
             Phoenix.ChannelTest.subscribe_and_join(socket2, "terminal:#{project_id}", %{})
  end

  test "pty_open sem runner conectado devolve pty_error pra web, nunca fica sem resposta" do
    project_id = Ecto.UUID.generate()
    socket = emitir_e_conectar!(project_id, "terminal")

    {:ok, _reply, joined} =
      Phoenix.ChannelTest.subscribe_and_join(socket, "terminal:#{project_id}", %{})

    refute Registry.connected?(project_id)

    push(joined, "pty_open", %{"sessionRef" => "sess-1", "cols" => 80, "rows" => 24})
    assert_push "pty_error", %{sessionRef: "sess-1", message: mensagem}
    assert mensagem =~ "Nenhum runner conectado"
  end

  defp wait_until(fun, tentativas \\ 50)

  defp wait_until(_fun, 0), do: flunk("condição não ficou verdadeira a tempo")

  defp wait_until(fun, tentativas) do
    if fun.() do
      :ok
    else
      Process.sleep(20)
      wait_until(fun, tentativas - 1)
    end
  end
end
