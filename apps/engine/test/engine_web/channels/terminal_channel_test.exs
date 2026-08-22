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

  describe "fs_list_dir/fs_home_dir (navegação de pasta local)" do
    test "fs_list_dir sem runner conectado devolve fs_list_dir_reply com erro, nunca fica sem resposta" do
      project_id = Ecto.UUID.generate()
      socket = emitir_e_conectar!(project_id, "terminal")

      {:ok, _reply, joined} =
        Phoenix.ChannelTest.subscribe_and_join(socket, "terminal:#{project_id}", %{})

      refute Registry.connected?(project_id)

      push(joined, "fs_list_dir", %{"ref" => "req-1", "path" => "/home/user"})

      assert_push "fs_list_dir_reply", %{
        ref: "req-1",
        path: "/home/user",
        entradas: [],
        erro: mensagem
      }

      assert mensagem =~ "Nenhum runner conectado"
    end

    test "fs_home_dir sem runner conectado devolve fs_home_dir_reply com erro, nunca fica sem resposta" do
      project_id = Ecto.UUID.generate()
      socket = emitir_e_conectar!(project_id, "terminal")

      {:ok, _reply, joined} =
        Phoenix.ChannelTest.subscribe_and_join(socket, "terminal:#{project_id}", %{})

      push(joined, "fs_home_dir", %{"ref" => "req-2"})

      assert_push "fs_home_dir_reply", %{ref: "req-2", erro: mensagem}
      assert mensagem =~ "Nenhum runner conectado"
    end

    test "fs_list_dir da web faz RELAY puro pro runner, e a resposta do runner chega só pra :web" do
      project_id = Ecto.UUID.generate()

      socket_runner = emitir_e_conectar!(project_id, "runner")

      {:ok, _reply, joined_runner} =
        Phoenix.ChannelTest.subscribe_and_join(socket_runner, "terminal:#{project_id}", %{})

      socket_web = emitir_e_conectar!(project_id, "terminal")

      {:ok, _reply, joined_web} =
        Phoenix.ChannelTest.subscribe_and_join(socket_web, "terminal:#{project_id}", %{})

      push(joined_web, "fs_list_dir", %{"ref" => "req-3", "path" => "/home/user/projetos"})

      # relay puro: o engine nunca interpreta o path, só repassa pro runner.
      assert_push "fs_list_dir", %{"ref" => "req-3", "path" => "/home/user/projetos"}

      push(joined_runner, "fs_list_dir_reply", %{
        "ref" => "req-3",
        "path" => "/home/user/projetos",
        "entradas" => [%{"nome" => "loja", "isDir" => true}]
      })

      assert_push "fs_list_dir_reply", %{
        "ref" => "req-3",
        "entradas" => [%{"nome" => "loja", "isDir" => true}]
      }
    end

    test "fs_home_dir da web faz RELAY puro pro runner, e a resposta do runner chega só pra :web" do
      project_id = Ecto.UUID.generate()

      socket_runner = emitir_e_conectar!(project_id, "runner")

      {:ok, _reply, joined_runner} =
        Phoenix.ChannelTest.subscribe_and_join(socket_runner, "terminal:#{project_id}", %{})

      socket_web = emitir_e_conectar!(project_id, "terminal")

      {:ok, _reply, joined_web} =
        Phoenix.ChannelTest.subscribe_and_join(socket_web, "terminal:#{project_id}", %{})

      push(joined_web, "fs_home_dir", %{"ref" => "req-4"})

      assert_push "fs_home_dir", %{"ref" => "req-4"}

      push(joined_runner, "fs_home_dir_reply", %{"ref" => "req-4", "path" => "/home/user"})

      assert_push "fs_home_dir_reply", %{"ref" => "req-4", "path" => "/home/user"}
    end

    test "fs_list_dir vindo do :runner (papel errado) é ignorado — só :web pode pedir" do
      project_id = Ecto.UUID.generate()
      socket = emitir_e_conectar!(project_id, "runner")

      {:ok, _reply, joined} =
        Phoenix.ChannelTest.subscribe_and_join(socket, "terminal:#{project_id}", %{})

      push(joined, "fs_list_dir", %{"ref" => "req-5", "path" => "/etc"})

      refute_push "fs_list_dir_reply", %{}
    end
  end

  # RN-423 (ADR 0104) — só o :runner pode originar `workspace_confirm`.
  describe "workspace_confirm" do
    test "vindo do :runner, repassa pra api via EngineApiClient.confirm_workspace/4" do
      project_id = Ecto.UUID.generate()
      user_id = Ecto.UUID.generate()
      socket = emitir_e_conectar!(project_id, "runner", user_id)

      {:ok, _reply, joined} =
        Phoenix.ChannelTest.subscribe_and_join(socket, "terminal:#{project_id}", %{})

      push(joined, "workspace_confirm", %{"path" => "/home/voce/projetos/loja"})

      assert_receive {:confirm_workspace, ^project_id, _session_id, "/home/voce/projetos/loja",
                      ^user_id}
    end

    test "vindo de :web, é IGNORADO — nunca chama a api" do
      project_id = Ecto.UUID.generate()
      socket = emitir_e_conectar!(project_id, "terminal")

      {:ok, _reply, joined} =
        Phoenix.ChannelTest.subscribe_and_join(socket, "terminal:#{project_id}", %{})

      push(joined, "workspace_confirm", %{"path" => "/home/voce/projetos/loja"})

      refute_receive {:confirm_workspace, _, _, _, _}, 200
    end

    # A recusa léxica em si (caminho fora de escopo, etc.) já tem cobertura
    # no lado api (`confirm-project-workspace.use-case.spec.ts`); aqui o que
    # importa é só que o canal segue vivo depois de repassar — o handler
    # não propaga o `{:error, _}` como falha do `handle_in/3` de propósito
    # (só loga), então nenhum teste cross-processo é necessário pra provar
    # isso: basta que o canal continue respondendo a outro evento.
    test "depois de repassar, o canal segue vivo e responde a outros eventos" do
      project_id = Ecto.UUID.generate()
      socket = emitir_e_conectar!(project_id, "runner")

      {:ok, _reply, joined} =
        Phoenix.ChannelTest.subscribe_and_join(socket, "terminal:#{project_id}", %{})

      push(joined, "workspace_confirm", %{"path" => "/home/voce/projetos/loja"})
      assert_receive {:confirm_workspace, ^project_id, _session_id, _path, _user_id}

      # O processo do canal não derrubou — outro `workspace_confirm` (o
      # único evento que este papel pode originar) continua sendo tratado.
      push(joined, "workspace_confirm", %{"path" => "/home/voce/projetos/loja"})
      assert_receive {:confirm_workspace, ^project_id, _session_id, _path, _user_id}
      assert Process.alive?(joined.channel_pid)
    end
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
