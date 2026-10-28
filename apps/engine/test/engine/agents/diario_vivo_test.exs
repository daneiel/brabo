defmodule Engine.Agents.DiarioVivoTest do
  @moduledoc """
  AT-582 (ADR 0226), fundação: a ferramenta `registrar_plano`, o `Diario`
  (projeção do log), a mensagem efêmera `RetomadaDoTurno`, a retomada 1× do
  boot (`TurnoOrfao.varrer/2`) e a `Reidratacao` que lê só o último plano.
  """
  use Engine.DataCase, async: false

  alias Engine.Agents.{Diario, Reidratacao, TurnoAssincrono, TurnoOrfao, CriativoServer}
  alias Engine.Harness.RetomadaDoTurno
  alias Engine.Harness.Tools.RegistrarPlano
  alias Engine.Sessions.FakeEngineApiClient

  setup do
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :project_workspaces_root, System.tmp_dir!())
    Application.put_env(:engine, :test_pid, self())
    me = self()
    Application.put_env(:engine, :acordar_agente, fn a, s, p -> send(me, {:acordou, a, s, p}) end)

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :project_workspaces_root)
      Application.delete_env(:engine, :test_pid)
      Application.delete_env(:engine, :acordar_agente)
    end)

    :ok
  end

  defp agora(menos_segundos \\ 0),
    do: DateTime.utc_now() |> DateTime.add(-menos_segundos, :second) |> DateTime.to_iso8601()

  defp ev(tipo, agente, payload \\ %{}, quando \\ nil) do
    base = %{
      "type" => tipo,
      "actor" => %{"kind" => "agent", "id" => agente},
      "payload" => payload
    }

    if quando, do: Map.put(base, "createdAt", quando), else: base
  end

  defp working(agente, quando \\ nil),
    do: ev("agent.status", agente, %{"status" => "working"}, quando)

  defp gravados(acc \\ []) do
    receive do
      {:event_appended, _, _, e} -> gravados([e | acc])
    after
      0 -> Enum.reverse(acc)
    end
  end

  @projeto "6f1b2c3d-1111-4222-8333-944455556666"

  defp com_seq(eventos),
    do: eventos |> Enum.with_index(1) |> Enum.map(fn {e, i} -> Map.put(e, "seq", i) end)

  @passo %{"texto" => "ler o brief", "estado" => "feito"}
  @ctx %{project_id: "p", session_id: "s", agent: "po"}

  describe "registrar_plano" do
    test "caminho feliz: grava agent.plan com o plano inteiro" do
      args = %{"objetivo" => "entregar as histórias", "passos" => [@passo]}
      assert {:ok, "plano registrado (1 passos)"} = RegistrarPlano.run(args, @ctx)

      assert [%{type: "agent.plan", actorId: "po", actorKind: "agent", payload: p}] = gravados()
      assert p.objetivo == "entregar as histórias"
      assert p.passos == [%{texto: "ler o brief", estado: "feito"}]
    end

    test "acima do teto de passos: recusa nomeando o limite e não grava" do
      passos = for _ <- 1..13, do: @passo
      assert {:error, msg} = RegistrarPlano.run(%{"objetivo" => "x", "passos" => passos}, @ctx)
      assert msg =~ "limite de 12 passos"
      assert gravados() == []
    end

    test "texto do passo e objetivo acima do teto: recusa nomeando o limite" do
      longo = String.duplicate("a", 161)
      p = [%{"texto" => longo, "estado" => "pendente"}]
      assert {:error, m1} = RegistrarPlano.run(%{"objetivo" => "x", "passos" => p}, @ctx)
      assert m1 =~ "limite de 160"

      assert {:error, m2} =
               RegistrarPlano.run(
                 %{"objetivo" => String.duplicate("o", 201), "passos" => [@passo]},
                 @ctx
               )

      assert m2 =~ "limite de 200"
      assert gravados() == []
    end

    test "estado fora do enum e argumentos faltando são recusados" do
      assert {:error, m} =
               RegistrarPlano.run(
                 %{"objetivo" => "x", "passos" => [%{"texto" => "a", "estado" => "talvez"}]},
                 @ctx
               )

      assert m =~ "talvez"
      assert {:error, _} = RegistrarPlano.run(%{}, @ctx)
    end
  end

  describe "Diario.de_eventos/2" do
    test "projeta plano, efeitos, sem desfecho, pendentes e a última atividade" do
      eventos = [
        ev("chat.message", "usuario"),
        working("po", agora(60)),
        ev("agent.plan", "po", %{"objetivo" => "antigo", "passos" => []}),
        ev("agent.plan", "po", %{"objetivo" => "novo", "passos" => []}),
        ev("tool.call", "po", %{"tool" => "create_story"}),
        ev("tool.result", "po", %{"tool" => "create_story", "ok" => true}),
        ev("tool.call", "po", %{"tool" => "registrar_plano"}),
        ev("tool.call", "po", %{"tool" => "create_task"}),
        ev("proposed_action.created", "po", %{
          "actionId" => "a1",
          "actionType" => "git_push",
          "status" => "pending"
        }),
        ev("proposed_action.created", "po", %{
          "actionId" => "a2",
          "actionType" => "pr_open",
          "status" => "pending"
        }),
        ev("proposed_action.executed", "sistema", %{"actionId" => "a2"}, agora(5))
      ]

      d = Diario.de_eventos(com_seq(eventos), "po")
      assert d.plano["objetivo"] == "novo"
      assert d.efeitos == ["ferramenta `create_story`: ok", "ação a2 executada"]
      assert d.sem_desfecho == ["create_task"]
      assert d.pendentes == ["git_push a1"]
      assert d.retomada_usada == false
      assert d.retomar_de == 2
      assert %DateTime{} = d.ultima_atividade
    end

    test "retomada_usada: working logo depois de um agent.turn_resumed" do
      eventos = [working("po"), ev("agent.turn_resumed", "po"), working("po")]

      assert %{retomada_usada: true, retomada_pendente: false} =
               Diario.de_eventos(com_seq(eventos), "po")
    end

    test "retomada_pendente: turn_resumed é o último marco; o escopo é o do working retomado" do
      eventos = [
        working("po"),
        ev("agent.plan", "po", %{"objetivo" => "x", "passos" => []}),
        ev("agent.turn_resumed", "po", %{}, agora(10))
      ]

      d = Diario.de_eventos(com_seq(eventos), "po")
      assert d.retomada_pendente and d.retomar_de == 1
      assert d.plano["objetivo"] == "x"
      assert Diario.retomada_pendente?(d, DateTime.utc_now())
      refute Diario.retomada_pendente?(d, DateTime.add(DateTime.utc_now(), 1_000, :second))
    end
  end

  describe "RetomadaDoTurno" do
    test "texto: plano, confirmado, sem desfecho e pendentes, dentro do teto" do
      d = %{
        plano: %{
          "objetivo" => "fechar o backlog",
          "passos" => [%{"texto" => "criar histórias", "estado" => "em_curso"}]
        },
        efeitos: ["ferramenta `create_story`: ok"],
        sem_desfecho: ["create_task"],
        pendentes: ["git_push a1"]
      }

      t = RetomadaDoTurno.texto(d)
      assert t =~ "1. [em_curso] criar histórias"
      assert t =~ "não repita"
      assert t =~ "create_task"
      assert t =~ "git_push a1"
      assert t =~ "Merge em branch protegida"

      enorme = %{d | efeitos: for(i <- 1..400, do: "efeito número #{i}")}
      assert String.length(RetomadaDoTurno.texto(enorme)) <= RetomadaDoTurno.teto_de_caracteres()
    end

    test "com_retomada/anexar: a mensagem entra no fim e sai com o escopo" do
      msgs = [%{"role" => "user", "content" => "oi"}]
      assert RetomadaDoTurno.anexar(msgs, "po") == msgs

      RetomadaDoTurno.com_retomada("você estava em X", fn ->
        assert [_, %{"role" => "system", "content" => "você estava em X"}] =
                 RetomadaDoTurno.anexar(msgs, "po")
      end)

      assert RetomadaDoTurno.anexar(msgs, "po") == msgs

      RetomadaDoTurno.com_retomada(%{retomada: "do ctx"}, fn ->
        assert length(RetomadaDoTurno.anexar(msgs, "dev-api")) == 2
      end)
    end
  end

  describe "TurnoOrfao.varrer/2: retomada automática 1× no boot" do
    test "recente e nunca retomado: grava erro, idle, turn_resumed e acorda o agente" do
      Process.put(:fake_events, [working("po", agora(120))])
      sid = Ecto.UUID.generate()

      assert ["po"] = TurnoOrfao.varrer("p1", sid)

      assert [erro, idle, retomada] = gravados()
      assert erro.payload.retomada == "automatica"
      assert erro.payload.mensagem =~ "vou retomá-lo uma vez"
      assert idle.payload == %{status: "idle"}
      assert retomada.type == "agent.turn_resumed"
      assert retomada.payload.automatica == true
      assert retomada.payload.retomaDe == 1
      assert_received {:acordou, "po", ^sid, "p1"}
    end

    test "fora da janela: só fecha, não retoma" do
      Process.put(:fake_events, [working("po", agora(901))])
      assert ["po"] = TurnoOrfao.varrer("p1", Ecto.UUID.generate())
      assert [erro, _idle] = gravados()
      refute Map.has_key?(erro.payload, :retomada)
      refute_received {:acordou, _, _, _}
    end

    test "uma segunda vez não: o working que já veio de uma retomada só fecha" do
      Process.put(:fake_events, [
        working("po", agora(300)),
        ev("agent.turn_resumed", "po", %{}, agora(200)),
        working("po", agora(100))
      ])

      assert ["po"] = TurnoOrfao.varrer("p1", Ecto.UUID.generate())
      assert [%{type: "agent.error"}, %{type: "agent.status"}] = gravados()
      refute_received {:acordou, _, _, _}
    end

    test "sem horário no log: não é recente, só fecha" do
      Process.put(:fake_events, [working("po")])
      assert ["po"] = TurnoOrfao.varrer("p1", Ecto.UUID.generate())
      assert [_, _] = gravados()
      refute_received {:acordou, _, _, _}
    end

    test "processo vivo neste nó: nem fecha nem retoma" do
      sid = Ecto.UUID.generate()
      {:ok, _} = Registry.register(Engine.Sessions.Registry, "po:" <> sid, nil)
      Process.put(:fake_events, [working("po", agora(10))])

      assert [] = TurnoOrfao.varrer("p1", sid)
      assert gravados() == []
      refute_received {:acordou, _, _, _}
    end

    test "processo vivo noutro nó do cluster: nem fecha nem retoma" do
      if not Node.alive?(),
        do: {:ok, _} = :net_kernel.start([:"diario_teste@127.0.0.1", :longnames])

      {:ok, peer, no} = :peer.start(%{name: :diario_par, host: ~c"127.0.0.1"})
      for path <- :code.get_path(), do: :erpc.call(no, :code, :add_path, [path])
      sid = Ecto.UUID.generate()
      :ok = :erpc.call(no, Engine.RegistryDePar, :subir, ["po:" <> sid])
      Process.sleep(200)
      true = Node.connect(no)

      on_exit(fn ->
        try do
          :peer.stop(peer)
        catch
          :exit, _ -> :ok
        end
      end)

      Process.put(:fake_events, [working("po", agora(10))])
      assert [] = TurnoOrfao.varrer("p1", sid)
      assert gravados() == []
      refute_received {:acordou, _, _, _}
    end

    test "fechar_ao_subir (init) continua só fechando, mesmo recente" do
      Process.put(:fake_events, [working("po", agora(10))])
      assert ["po"] = TurnoOrfao.fechar_ao_subir("p1", Ecto.UUID.generate(), "po")
      assert [_, _] = gravados()
      refute_received {:acordou, _, _, _}
    end
  end

  describe "TurnoAssincrono: retomada no init" do
    setup do
      sid = Ecto.UUID.generate()
      {:ok, state} = CriativoServer.init({sid, @projeto})
      %{state: state, sid: sid}
    end

    test "retomada_ao_subir agenda a mensagem só com turn_resumed pendente na janela", %{sid: sid} do
      Process.put(:fake_events, [
        working("criativo"),
        ev("agent.turn_resumed", "criativo", %{}, agora(10))
      ])

      assert TurnoAssincrono.retomada_ao_subir(@projeto, sid, "criativo")
      assert_received :retomar_turno_interrompido
    end

    test "fora da janela, ou já com working depois: não agenda", %{sid: sid} do
      Process.put(:fake_events, [
        working("criativo"),
        ev("agent.turn_resumed", "criativo", %{}, agora(2_000))
      ])

      refute TurnoAssincrono.retomada_ao_subir(@projeto, sid, "criativo")

      Process.put(:fake_events, [
        ev("agent.turn_resumed", "criativo", %{}, agora(10)),
        working("criativo")
      ])

      refute TurnoAssincrono.retomada_ao_subir(@projeto, sid, "criativo")
      refute_received :retomar_turno_interrompido
    end

    test "a mensagem sobe o turno com a retomada efêmera e sem mensagem falsa do usuário",
         %{state: state, sid: sid} do
      Process.put(:fake_events, [
        working("criativo"),
        ev("agent.plan", "criativo", %{
          "objetivo" => "fechar o brief",
          "passos" => [%{"texto" => "perguntar", "estado" => "em_curso"}]
        }),
        ev("agent.turn_resumed", "criativo", %{}, agora(5))
      ])

      me = self()

      montar = fn st ->
        fn ->
          send(me, {:texto_da_retomada, RetomadaDoTurno.anexar([], "criativo")})
          st
        end
      end

      state = %{state | session_id: sid} |> Map.put(:montar_turno_de_retomada, montar)
      assert {:ok, novo} = TurnoAssincrono.tratar_resultado(:retomar_turno_interrompido, state)
      assert %{task: _} = novo.turno_assincrono

      assert_receive {:texto_da_retomada, [%{"role" => "system", "content" => c}]}, 1_000
      assert c =~ "fechar o brief"
      assert RetomadaDoTurno.anexar([], "criativo") == []
    end

    test "sem a função de montar, ou com turno de pé: no-op", %{state: state, sid: sid} do
      Process.put(:fake_events, [
        working("criativo"),
        ev("agent.turn_resumed", "criativo", %{}, agora(5))
      ])

      # o init dos servidores já guarda a função: aqui ela é tirada para provar o no-op
      state = %{state | session_id: sid} |> Map.delete(:montar_turno_de_retomada)
      assert {:ok, ^state} = TurnoAssincrono.tratar_resultado(:retomar_turno_interrompido, state)
    end
  end

  describe "Reidratacao" do
    test "mostra só o último agent.plan e pula as notas de registrar_plano" do
      eventos = [
        ev("agent.plan", "po", %{"objetivo" => "v1", "passos" => []}),
        ev("tool.call", "po", %{"tool" => "registrar_plano", "args" => %{}}),
        ev("tool.result", "po", %{"tool" => "registrar_plano", "ok" => true}),
        ev("agent.plan", "po", %{
          "objetivo" => "v2",
          "passos" => [%{"texto" => "um", "estado" => "feito"}]
        }),
        ev("tool.call", "po", %{"tool" => "create_story", "args" => %{}})
      ]

      msgs = Reidratacao.mensagens(eventos, "po")
      textos = Enum.map(msgs, & &1["content"])
      assert Enum.any?(textos, &(&1 =~ "Meu plano: v2" and &1 =~ "[feito] um"))
      refute Enum.any?(textos, &(&1 =~ "v1"))
      refute Enum.any?(textos, &(&1 =~ "registrar_plano"))
      assert Enum.any?(textos, &(&1 =~ "create_story"))
    end
  end

  describe "marco por opção e retomada usada (integração)" do
    test "dev: escopo pelo dev.working da tarefa; retomada via cause" do
      evs =
        com_seq([
          ev("dev.working", "dev-a", %{"taskId" => "t1"}),
          ev("tool.call", "dev-a", %{"tool" => "write_file"})
        ])

      opts = [marco: {:dev_working, "t1"}]
      assert Diario.de_eventos(evs, "dev-a", opts).retomar_de == 1
      assert Diario.de_eventos(evs, "dev-a").retomar_de == nil
      refute Diario.retomada_usada?(evs, "dev-a", opts)

      usados =
        evs ++ com_seq([ev("dev.working", "dev-a", %{"taskId" => "t1", "cause" => "retomada"})])

      assert Diario.retomada_usada?(usados, "dev-a", opts)
      refute Diario.retomada_usada?(usados, "dev-a", marco: {:dev_working, "t2"})
    end

    test "gate: só o turn_resumed marca o escopo" do
      evs =
        com_seq([
          ev("agent.plan", "appsec", %{"objetivo" => "x", "passos" => [@passo]}),
          ev("agent.turn_resumed", "appsec", %{}, agora())
        ])

      d = Diario.de_eventos(evs, "appsec", marco: :turn_resumed)
      assert d.retomada_pendente
      assert d.plano["objetivo"] == "x"
      refute Diario.de_eventos(evs, "appsec").plano
    end
  end
end
