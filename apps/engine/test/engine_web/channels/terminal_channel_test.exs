defmodule EngineWeb.TerminalChannelTest do
  @moduledoc """
  Join do canal `terminal:<projectId>` — dois papéis (`:runner`/`:web`)
  compartilhando o mesmo tópico.

  `async: false`: `Engine.Runners.Registry` usa `:global`, que é global ao
  node de teste inteiro (mesmo motivo de `EngineWeb.SessionChannelTest`).
  """

  use EngineWeb.ChannelCase, async: false

  alias Engine.Runners.{Registry, Revogacao, SocketTicket}

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

  # container_start/container_stop/container_remove (ADR 0137) — MESMO
  # mecanismo de dispatch_exec/exec_result (`Engine.Runners.RunnerRouterTest`
  # já cobre o roundtrip completo via `RunnerRouter`); aqui o que importa é
  # só que o CANAL empurra o evento certo com `ref` embutido e que
  # `handle_in("container_*_result", ...)` devolve pro `from` — testado
  # diretamente com `send/2`/`handle_info`, sem passar por `RunnerRouter`.
  describe "container_start/container_stop/container_remove (ADR 0137)" do
    test "dispatch_container_start empurra \"container_start\" com ref e spec pro runner" do
      project_id = Ecto.UUID.generate()
      socket = emitir_e_conectar!(project_id, "runner")

      {:ok, _reply, joined} =
        Phoenix.ChannelTest.subscribe_and_join(socket, "terminal:#{project_id}", %{})

      spec = %{"workspaceDirName" => "proj-abc12345", "imagem" => "node:22"}
      send(joined.channel_pid, {:dispatch_container_start, "ref-1", spec, self(), 5_000})

      assert_push "container_start", %{ref: "ref-1", spec: ^spec}
    end

    test "container_start_result responde pro from com :runner_container_start_result" do
      project_id = Ecto.UUID.generate()
      socket = emitir_e_conectar!(project_id, "runner")

      {:ok, _reply, joined} =
        Phoenix.ChannelTest.subscribe_and_join(socket, "terminal:#{project_id}", %{})

      send(joined.channel_pid, {:dispatch_container_start, "ref-2", %{}, self(), 5_000})
      assert_push "container_start", %{ref: "ref-2"}

      push(joined, "container_start_result", %{
        "ref" => "ref-2",
        "sucesso" => true,
        "containerId" => "c-1"
      })

      assert_receive {:runner_container_start_result, "ref-2",
                      %{"sucesso" => true, "containerId" => "c-1"}}
    end

    test "dispatch_container_stop/container_stop_result — mesmo roundtrip, workspaceDirName" do
      project_id = Ecto.UUID.generate()
      socket = emitir_e_conectar!(project_id, "runner")

      {:ok, _reply, joined} =
        Phoenix.ChannelTest.subscribe_and_join(socket, "terminal:#{project_id}", %{})

      send(
        joined.channel_pid,
        {:dispatch_container_stop, "ref-3", "proj-abc12345", self(), 5_000}
      )

      assert_push "container_stop", %{ref: "ref-3", workspaceDirName: "proj-abc12345"}

      push(joined, "container_stop_result", %{"ref" => "ref-3", "sucesso" => true})

      assert_receive {:runner_container_stop_result, "ref-3", %{"sucesso" => true}}
    end

    test "dispatch_container_remove/container_remove_result — mesmo roundtrip" do
      project_id = Ecto.UUID.generate()
      socket = emitir_e_conectar!(project_id, "runner")

      {:ok, _reply, joined} =
        Phoenix.ChannelTest.subscribe_and_join(socket, "terminal:#{project_id}", %{})

      send(
        joined.channel_pid,
        {:dispatch_container_remove, "ref-4", "proj-abc12345", self(), 5_000}
      )

      assert_push "container_remove", %{ref: "ref-4", workspaceDirName: "proj-abc12345"}

      push(joined, "container_remove_result", %{"ref" => "ref-4", "sucesso" => true})

      assert_receive {:runner_container_remove_result, "ref-4", %{"sucesso" => true}}
    end

    test "container_start_result com ref desconhecido é descartado — canal segue vivo" do
      project_id = Ecto.UUID.generate()
      socket = emitir_e_conectar!(project_id, "runner")

      {:ok, _reply, joined} =
        Phoenix.ChannelTest.subscribe_and_join(socket, "terminal:#{project_id}", %{})

      push(joined, "container_start_result", %{"ref" => "ref-desconhecido", "sucesso" => true})

      refute_receive {:runner_container_start_result, _, _}, 200
      assert Process.alive?(joined.channel_pid)
    end
  end

  # ADR 0147 ponto 1 / RN-514 — o `join` deixou de ser mudo. O vocabulário e
  # as três perguntas em si são cobertos por `Engine.Runners.CapacidadesTest`
  # (função pura); aqui o que importa é o que o CANAL faz com a resposta:
  # o que ele guarda em `socket.assigns`, quando recusa a entrada, e o que
  # acontece com uma mensagem cuja capacidade não foi concedida.
  describe "capacidades declaradas no join (ADR 0147 ponto 1, RN-514)" do
    test "runner que declara {exec, pty} recebe os dois em socket.assigns" do
      project_id = Ecto.UUID.generate()
      socket = emitir_e_conectar!(project_id, "runner")

      assert {:ok, _reply, joined} =
               Phoenix.ChannelTest.subscribe_and_join(socket, "terminal:#{project_id}", %{
                 "capacidades" => ["exec", "pty"]
               })

      assert joined.assigns.capacidades == MapSet.new(["exec", "pty"])
    end

    test "join SEM params é binário LEGADO — concede {exec, pty}, nunca recusa" do
      project_id = Ecto.UUID.generate()
      socket = emitir_e_conectar!(project_id, "runner")

      assert {:ok, _reply, joined} =
               Phoenix.ChannelTest.subscribe_and_join(socket, "terminal:#{project_id}", %{})

      assert joined.assigns.capacidades == MapSet.new(["exec", "pty"])
    end

    test "capacidade DESCONHECIDA é ignorada e o join passa — runner mais novo que o engine entra" do
      project_id = Ecto.UUID.generate()
      socket = emitir_e_conectar!(project_id, "runner")

      assert {:ok, _reply, joined} =
               Phoenix.ChannelTest.subscribe_and_join(socket, "terminal:#{project_id}", %{
                 "capacidades" => ["exec", "pty", "capacidade-do-futuro"]
               })

      assert joined.assigns.capacidades == MapSet.new(["exec", "pty"])
      assert Registry.connected?(project_id)
    end

    test "o socket :web NÃO recebe conjunto de capacidades — nenhuma checagem se aplica a ele" do
      project_id = Ecto.UUID.generate()
      socket = emitir_e_conectar!(project_id, "terminal")

      {:ok, _reply, joined} =
        Phoenix.ChannelTest.subscribe_and_join(socket, "terminal:#{project_id}", %{
          "capacidades" => ["exec", "pty"]
        })

      assert joined.assigns[:capacidades] == nil
    end

    test "projeto `runner` cujo runner NÃO declara `exec`: join recusado NOMEANDO a que falta" do
      project_id = Ecto.UUID.generate()
      inserir_projeto!(project_id, "runner")
      socket = emitir_e_conectar!(project_id, "runner")

      assert {:error, %{reason: motivo}} =
               Phoenix.ChannelTest.subscribe_and_join(socket, "terminal:#{project_id}", %{
                 "capacidades" => ["pty"]
               })

      assert motivo =~ "`exec`"
      assert motivo =~ "desatualizado"
      # Recusou ANTES de registrar a presença — nunca deixa o Registry
      # afirmando um runner que não entrou.
      refute Registry.connected?(project_id)
    end

    test "MESMO projeto `runner`, runner declarando `exec`: entra normalmente" do
      project_id = Ecto.UUID.generate()
      inserir_projeto!(project_id, "runner")
      socket = emitir_e_conectar!(project_id, "runner")

      assert {:ok, _reply, joined} =
               Phoenix.ChannelTest.subscribe_and_join(socket, "terminal:#{project_id}", %{
                 "capacidades" => ["exec", "pty"]
               })

      assert joined.assigns.capacidades == MapSet.new(["exec", "pty"])
    end

    test "projeto `container` não exige nada — runner que só declara `pty` entra" do
      project_id = Ecto.UUID.generate()
      inserir_projeto!(project_id, "container")
      socket = emitir_e_conectar!(project_id, "runner")

      assert {:ok, _reply, joined} =
               Phoenix.ChannelTest.subscribe_and_join(socket, "terminal:#{project_id}", %{
                 "capacidades" => ["pty"]
               })

      assert joined.assigns.capacidades == MapSet.new(["pty"])
    end

    test "exec para runner SEM a capacidade `exec` responde NOMEADO — nunca some" do
      project_id = Ecto.UUID.generate()
      socket = emitir_e_conectar!(project_id, "runner")

      {:ok, _reply, joined} =
        Phoenix.ChannelTest.subscribe_and_join(socket, "terminal:#{project_id}", %{
          "capacidades" => ["pty"]
        })

      send(joined.channel_pid, {:dispatch_exec, "ref-x", "echo oi", "/proj", nil, self(), 5_000})

      # O `from` (RunnerRouter, no caminho real) recebe o MESMO formato de
      # `exec_result` — com a causa, em vez de esperar até o timeout dele.
      assert_receive {:runner_exec_result, "ref-x", payload}
      assert payload["exitCode"] == 126
      assert payload["timedOut"] == false
      assert payload["output"] =~ "`exec`"

      # E nada foi empurrado pro runner.
      refute_push "exec", %{}
    end

    test "pty_open para runner SEM a capacidade `pty`: a web recebe pty_error, o runner não recebe nada" do
      project_id = Ecto.UUID.generate()

      socket_runner = emitir_e_conectar!(project_id, "runner")

      {:ok, _reply, _joined_runner} =
        Phoenix.ChannelTest.subscribe_and_join(socket_runner, "terminal:#{project_id}", %{
          "capacidades" => ["exec"]
        })

      socket_web = emitir_e_conectar!(project_id, "terminal")

      {:ok, _reply, joined_web} =
        Phoenix.ChannelTest.subscribe_and_join(socket_web, "terminal:#{project_id}", %{})

      push(joined_web, "pty_open", %{"sessionRef" => "sess-cap", "cols" => 80, "rows" => 24})

      assert_push "pty_error", %{sessionRef: "sess-cap", message: mensagem}
      assert mensagem =~ "`pty`"
      assert mensagem =~ "`pty_open`"

      # O relay não aconteceu: o runner nunca recebeu `pty_open`.
      refute_push "pty_open", %{}
    end

    test "com a capacidade `pty` concedida, o relay segue exatamente como sempre foi" do
      project_id = Ecto.UUID.generate()

      socket_runner = emitir_e_conectar!(project_id, "runner")

      {:ok, _reply, _joined_runner} =
        Phoenix.ChannelTest.subscribe_and_join(socket_runner, "terminal:#{project_id}", %{
          "capacidades" => ["exec", "pty"]
        })

      socket_web = emitir_e_conectar!(project_id, "terminal")

      {:ok, _reply, joined_web} =
        Phoenix.ChannelTest.subscribe_and_join(socket_web, "terminal:#{project_id}", %{})

      push(joined_web, "pty_open", %{"sessionRef" => "sess-ok", "cols" => 80, "rows" => 24})

      assert_push "pty_open", %{"sessionRef" => "sess-ok"}
    end
  end

  # ADR 0147 ponto 4 / RN-516 — o DESTINO do espelho viaja na CONCESSÃO do
  # join, e o runner nunca o guarda em configuração própria. As três coisas
  # que este describe prova: o destino chega na resposta do join; destino
  # declarado EXIGE a capacidade `espelho` (o primeiro caso REAL do mecanismo
  # de recusa da RN-514); e `mirror_sync` é empurrado sem esperar resposta.
  describe "o destino do espelho na concessão do join (ADR 0147 ponto 4, RN-516)" do
    test "projeto COM destino: o runner que declara `espelho` recebe o destino na resposta" do
      project_id = Ecto.UUID.generate()
      inserir_projeto!(project_id, "runner", mirror_path: "/home/voce/espelhos/proj")
      socket = emitir_e_conectar!(project_id, "runner")

      assert {:ok, resposta, joined} =
               Phoenix.ChannelTest.subscribe_and_join(socket, "terminal:#{project_id}", %{
                 "capacidades" => ["exec", "pty", "espelho"]
               })

      assert resposta == %{espelho: %{destino: "/home/voce/espelhos/proj"}}
      assert MapSet.member?(joined.assigns.capacidades, "espelho")
    end

    test "projeto COM destino e runner SEM `espelho`: join RECUSADO nomeando a capacidade" do
      project_id = Ecto.UUID.generate()
      inserir_projeto!(project_id, "mounted", mirror_path: "/home/voce/espelhos/proj")
      socket = emitir_e_conectar!(project_id, "runner")

      assert {:error, %{reason: motivo}} =
               Phoenix.ChannelTest.subscribe_and_join(socket, "terminal:#{project_id}", %{
                 "capacidades" => ["exec", "pty"]
               })

      assert motivo =~ "`espelho`"
      assert motivo =~ "desatualizado"
      # Recusou ANTES de registrar a presença, como toda recusa por capacidade.
      refute Registry.connected?(project_id)
    end

    test "binário LEGADO (params vazios) num projeto com destino também é recusado" do
      project_id = Ecto.UUID.generate()
      inserir_projeto!(project_id, "mounted", mirror_path: "/home/voce/espelhos/proj")
      socket = emitir_e_conectar!(project_id, "runner")

      assert {:error, %{reason: motivo}} =
               Phoenix.ChannelTest.subscribe_and_join(socket, "terminal:#{project_id}", %{})

      assert motivo =~ "`espelho`"
    end

    test "projeto SEM destino: resposta VAZIA, e nada muda para quem declara `espelho`" do
      project_id = Ecto.UUID.generate()
      inserir_projeto!(project_id, "runner")
      socket = emitir_e_conectar!(project_id, "runner")

      assert {:ok, resposta, joined} =
               Phoenix.ChannelTest.subscribe_and_join(socket, "terminal:#{project_id}", %{
                 "capacidades" => ["exec", "pty", "espelho"]
               })

      assert resposta == %{}
      assert MapSet.member?(joined.assigns.capacidades, "espelho")
    end

    test "mirror_sync é empurrado pro runner com destino e momento, sem esperar resposta" do
      project_id = Ecto.UUID.generate()
      inserir_projeto!(project_id, "runner", mirror_path: "/home/voce/espelhos/proj")
      socket = emitir_e_conectar!(project_id, "runner")

      {:ok, _resposta, joined} =
        Phoenix.ChannelTest.subscribe_and_join(socket, "terminal:#{project_id}", %{
          "capacidades" => ["exec", "pty", "espelho"]
        })

      send(
        joined.channel_pid,
        {:dispatch_mirror_sync, "ref-espelho", "/home/voce/espelhos/proj", "commit"}
      )

      assert_push "mirror_sync", %{
        ref: "ref-espelho",
        destino: "/home/voce/espelhos/proj",
        momento: "commit"
      }
    end

    test "mirror_sync para runner SEM a capacidade `espelho` NÃO é empurrado" do
      # Só alcançável quando o destino é declarado DEPOIS do join — mas a
      # mensagem nunca vai a um handler que não existe do outro lado, que é o
      # defeito silencioso que o ADR 0147 nomeia no Context.
      project_id = Ecto.UUID.generate()
      inserir_projeto!(project_id, "runner")
      socket = emitir_e_conectar!(project_id, "runner")

      {:ok, _resposta, joined} =
        Phoenix.ChannelTest.subscribe_and_join(socket, "terminal:#{project_id}", %{
          "capacidades" => ["exec", "pty"]
        })

      send(
        joined.channel_pid,
        {:dispatch_mirror_sync, "ref-x", "/home/voce/espelhos/proj", "commit"}
      )

      refute_push "mirror_sync", %{}
    end
  end

  # RN-517 (ADR 0147 ponto 7) — o desfecho da rodada volta pelo canal e o
  # engine REPASSA pra api. Ele nunca escreve a tabela: um segundo caminho de
  # escrita seria a segunda fonte da mesma verdade.
  describe "mirror_sync_result (ADR 0147 ponto 7, RN-517)" do
    test "vindo do :runner, repassa pra api traduzindo o vocabulário do protocolo" do
      project_id = Ecto.UUID.generate()
      inserir_projeto!(project_id, "runner", mirror_path: "/home/voce/espelhos/proj")
      socket = emitir_e_conectar!(project_id, "runner")

      {:ok, _resposta, joined} =
        Phoenix.ChannelTest.subscribe_and_join(socket, "terminal:#{project_id}", %{
          "capacidades" => ["exec", "pty", "espelho"]
        })

      push(joined, "mirror_sync_result", %{
        "ref" => "m1",
        "sucesso" => true,
        "destino" => "/home/voce/espelhos/proj",
        "copiados" => 412,
        "pulados" => 3,
        "recusados" => 0
      })

      assert_receive {:report_mirror_sync, ^project_id, resultado}

      assert resultado == %{
               ok: true,
               destination: "/home/voce/espelhos/proj",
               filesCopied: 412,
               filesSkipped: 3,
               filesRefused: 0
             }
    end

    test "copiar ZERO chega como sucesso com filesCopied: 0, nunca omitido" do
      project_id = Ecto.UUID.generate()
      inserir_projeto!(project_id, "runner", mirror_path: "/home/voce/espelhos/proj")
      socket = emitir_e_conectar!(project_id, "runner")

      {:ok, _resposta, joined} =
        Phoenix.ChannelTest.subscribe_and_join(socket, "terminal:#{project_id}", %{
          "capacidades" => ["exec", "pty", "espelho"]
        })

      push(joined, "mirror_sync_result", %{
        "ref" => "m2",
        "sucesso" => true,
        "destino" => "/home/voce/espelhos/proj",
        "copiados" => 0,
        "pulados" => 0,
        "recusados" => 0
      })

      assert_receive {:report_mirror_sync, ^project_id, %{ok: true, filesCopied: 0}}
    end

    test "falha chega com ok: false e o erro NOMEADO" do
      project_id = Ecto.UUID.generate()
      inserir_projeto!(project_id, "runner", mirror_path: "/home/voce/espelhos/proj")
      socket = emitir_e_conectar!(project_id, "runner")

      {:ok, _resposta, joined} =
        Phoenix.ChannelTest.subscribe_and_join(socket, "terminal:#{project_id}", %{
          "capacidades" => ["exec", "pty", "espelho"]
        })

      push(joined, "mirror_sync_result", %{
        "ref" => "m3",
        "sucesso" => false,
        "erro" => "o espelho não conseguiu listar o trabalho com o git"
      })

      assert_receive {:report_mirror_sync, ^project_id, resultado}
      assert resultado.ok == false
      assert resultado.error =~ "git"
      # Campo que não veio é OMITIDO, nunca `nil`: o DTO da api distingue
      # ausente de nulo, e um nulo explícito seria recusado na validação.
      refute Map.has_key?(resultado, :destination)
      refute Map.has_key?(resultado, :filesCopied)
    end

    test "payload sem `sucesso` booleano vira ok: false — nunca sucesso por omissão" do
      project_id = Ecto.UUID.generate()
      inserir_projeto!(project_id, "runner", mirror_path: "/home/voce/espelhos/proj")
      socket = emitir_e_conectar!(project_id, "runner")

      {:ok, _resposta, joined} =
        Phoenix.ChannelTest.subscribe_and_join(socket, "terminal:#{project_id}", %{
          "capacidades" => ["exec", "pty", "espelho"]
        })

      push(joined, "mirror_sync_result", %{"ref" => "m4"})

      assert_receive {:report_mirror_sync, ^project_id, %{ok: false}}
    end

    test "vindo de :web, é IGNORADO — nunca chama a api" do
      project_id = Ecto.UUID.generate()
      inserir_projeto!(project_id, "runner", mirror_path: "/home/voce/espelhos/proj")
      socket = emitir_e_conectar!(project_id, "terminal")

      {:ok, _resposta, joined} =
        Phoenix.ChannelTest.subscribe_and_join(socket, "terminal:#{project_id}", %{})

      push(joined, "mirror_sync_result", %{"ref" => "m5", "sucesso" => true})

      refute_receive {:report_mirror_sync, _, _}, 200
    end

    test "api que RECUSA o reporte não derruba o canal — telemetria não derruba o que mede" do
      project_id = Ecto.UUID.generate()
      inserir_projeto!(project_id, "runner", mirror_path: "/home/voce/espelhos/proj")
      socket = emitir_e_conectar!(project_id, "runner")

      {:ok, _resposta, joined} =
        Phoenix.ChannelTest.subscribe_and_join(socket, "terminal:#{project_id}", %{
          "capacidades" => ["exec", "pty", "espelho"]
        })

      # Scriptado por application env, e não pelo dicionário de processo: quem
      # chama o cliente é o processo do CANAL.
      Application.put_env(:engine, :fake_report_mirror_sync, {:error, :timeout})
      on_exit(fn -> Application.delete_env(:engine, :fake_report_mirror_sync) end)

      push(joined, "mirror_sync_result", %{"ref" => "m6", "sucesso" => false, "erro" => "x"})
      assert_receive {:report_mirror_sync, ^project_id, _}

      # O canal segue vivo e continua tratando — a recusa da api virou log e
      # nada mais.
      push(joined, "mirror_sync_result", %{"ref" => "m7", "sucesso" => true, "destino" => "/d"})
      assert_receive {:report_mirror_sync, ^project_id, _}
      assert Process.alive?(joined.channel_pid)
    end
  end

  # `projects` é gerenciada pela api (Drizzle, schema "public") — o engine só
  # a lê. Mesmo fixture SQL cru de `workspace_runner_test.exs`.
  defp inserir_projeto!(project_id, execution_mode, opts \\ []) do
    caminho = if execution_mode == "container", do: nil, else: "/home/voce/projetos/proj"

    Engine.Repo.query!(
      "INSERT INTO public.projects " <>
        "(id, name, slug, workspace_dir_name, execution_mode, workspace_path, mirror_path) " <>
        "VALUES ($1, 'proj', 'proj', 'proj-abc12345', $2, $3, $4)",
      [
        Ecto.UUID.dump!(project_id),
        execution_mode,
        caminho,
        Keyword.get(opts, :mirror_path)
      ]
    )
  end

  describe "revogação alcança a conexão viva (RN-520, ADR 0147 ponto 6)" do
    test "runner DAQUELE usuário: o canal para, e a presença no Registry é liberada" do
      project_id = Ecto.UUID.generate()
      dono = Ecto.UUID.generate()
      socket = emitir_e_conectar!(project_id, "runner", dono)

      assert {:ok, _reply, joined} =
               Phoenix.ChannelTest.subscribe_and_join(socket, "terminal:#{project_id}", %{})

      assert Registry.connected?(project_id)

      # `Phoenix.ChannelTest` LINKA o canal ao processo de teste, e o
      # `{:shutdown, :credencial_revogada}` se propagaria por esse link
      # matando o próprio teste. Em produção não há link nenhum: o transporte
      # MONITORA o canal. Desligar o link aqui é o que faz o teste observar o
      # mesmo desfecho que a produção observa.
      Process.unlink(joined.channel_pid)
      Process.monitor(joined.channel_pid)

      # É a corrente inteira: `Revogacao.derrubar/2` acha o pid pelo Registry,
      # manda a mensagem e espera a resposta do canal DE VERDADE.
      assert {:ok, :derrubado} = Revogacao.derrubar(project_id, dono)

      assert_receive {:DOWN, _ref, :process, _pid, _motivo}, 1_000
      wait_until(fn -> not Registry.connected?(project_id) end)
    end

    test "runner de OUTRO usuário no mesmo projeto fica de pé, e o pedinte é informado disso" do
      project_id = Ecto.UUID.generate()
      socket = emitir_e_conectar!(project_id, "runner", Ecto.UUID.generate())

      assert {:ok, _reply, joined} =
               Phoenix.ChannelTest.subscribe_and_join(socket, "terminal:#{project_id}", %{})

      assert {:ok, :de_outro_dono} = Revogacao.derrubar(project_id, Ecto.UUID.generate())

      assert Process.alive?(joined.channel_pid)
      assert Registry.connected?(project_id)
    end

    test "sem runner conectado: :sem_runner, e nada é derrubado — é o caso da chave órfã" do
      project_id = Ecto.UUID.generate()

      assert {:ok, :sem_runner} = Revogacao.derrubar(project_id, Ecto.UUID.generate())
    end

    test "socket :web NUNCA é o alvo: ele não ocupa o Registry, então nem chega a ser perguntado" do
      project_id = Ecto.UUID.generate()
      dono = Ecto.UUID.generate()
      socket = emitir_e_conectar!(project_id, "terminal", dono)

      assert {:ok, _reply, joined} =
               Phoenix.ChannelTest.subscribe_and_join(socket, "terminal:#{project_id}", %{})

      assert {:ok, :sem_runner} = Revogacao.derrubar(project_id, dono)

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
