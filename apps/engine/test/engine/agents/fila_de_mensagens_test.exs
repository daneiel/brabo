defmodule Engine.Agents.FilaDeMensagensTest do
  @moduledoc """
  RN-673 (ADR 0191): a mensagem que chega com turno em curso entra numa fila
  persistida no event log e é lida no fim do turno — N mensagens = 1 turno,
  cada uma cancelável enquanto pendente, teto de 10.

  As partes puras (derivação da fila, texto do turno, o que a reidratação
  pula) e o comportamento pelo `CriativoServer` de verdade, com callbacks
  exercitados no processo de teste — o mesmo padrão de
  `turno_assincrono_test.exs`. A fila é de `TurnoAssincrono`, então o que vale
  para o Criativo vale para os sete: os servidores só fornecem a montagem do
  turno (`turno_de_mensagem/2`).
  """
  use Engine.DataCase, async: false

  alias Engine.Agents.{
    CriativoServer,
    DevLeadServer,
    FilaDeMensagens,
    Reidratacao,
    TurnoAssincrono
  }

  alias Engine.Sessions.FakeEngineApiClient

  setup do
    root =
      Path.join(
        System.tmp_dir!(),
        "brabo-fila-#{System.os_time(:microsecond)}-#{System.unique_integer([:positive])}"
      )

    Application.put_env(:engine, :project_workspaces_root, root)
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      File.rm_rf!(root)
      Application.delete_env(:engine, :project_workspaces_root)
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :test_pid)
    end)

    project_id = Ecto.UUID.generate()
    session_id = Ecto.UUID.generate()
    {:ok, state} = CriativoServer.init({session_id, project_id})
    %{state: state, session_id: session_id, project_id: project_id}
  end

  defp enfileirada(seq, agente, id, texto),
    do: %{
      "seq" => seq,
      "type" => "chat.message_queued",
      "actor" => %{"kind" => "agent", "id" => agente},
      "payload" => %{"mensagemId" => id, "texto" => texto, "idioma" => "pt-BR"}
    }

  defp mensagem(state, texto, id) do
    CriativoServer.handle_call({:user_message, texto, nil, id}, {self(), make_ref()}, state)
  end

  # Sobe o primeiro turno PRESO no portão: ele só termina quando o teste manda.
  defp turno_no_portao(state) do
    Process.put(:fake_llm_turn_stream_gate, true)
    assert {:reply, :ok, em_curso} = mensagem(state, "primeira", "m0")
    assert_receive {:turno_no_portao, task_pid}, 1_000
    {em_curso, task_pid}
  end

  defp fechar_turno(%{turno_assincrono: %{task: %Task{ref: ref}}} = state, task_pid) do
    send(task_pid, :abrir_portao)
    assert_receive {^ref, resultado}, 1_000
    {:noreply, fechado} = CriativoServer.handle_info({ref, resultado}, state)
    fechado
  end

  describe "a derivação da fila no log (pura)" do
    test "pendente = enfileirada e nem entregue nem cancelada, na ordem do seq, só do agente" do
      eventos = [
        enfileirada(5, "criativo", "m3", "c"),
        enfileirada(1, "criativo", "m1", "a"),
        enfileirada(2, "criativo", "m2", "b"),
        enfileirada(3, "po", "m9", "de outro agente"),
        %{
          "seq" => 4,
          "type" => "chat.message_delivered",
          "actor" => %{"id" => "criativo"},
          "payload" => %{"mensagemIds" => ["m1"]}
        },
        %{
          "seq" => 6,
          "type" => "chat.message_cancelled",
          "actor" => %{"kind" => "user", "id" => "u1"},
          "payload" => %{"mensagemId" => "m2"}
        }
      ]

      assert [%{id: "m3", texto: "c", idioma: "pt-BR"}] =
               FilaDeMensagens.pendentes(eventos, "criativo")

      assert [%{id: "m9"}] = FilaDeMensagens.pendentes(eventos, "po")
    end

    test "uma mensagem é ela mesma; várias viram UM texto numerado, na ordem" do
      assert FilaDeMensagens.texto_do_turno([%{id: "a", texto: "só esta", idioma: nil}]) ==
               "só esta"

      texto =
        FilaDeMensagens.texto_do_turno([
          %{id: "a", texto: "primeiro", idioma: nil},
          %{id: "b", texto: "segundo", idioma: nil}
        ])

      assert texto =~ "2 mensagens"
      assert texto =~ "[1] primeiro"
      assert texto =~ "[2] segundo"
      assert :binary.match(texto, "[1]") < :binary.match(texto, "[2]")
    end

    test "a reidratação pula a cancelada e a pendente DESTE agente, e mantém as outras" do
      eventos = [
        %{"seq" => 1, "id" => "m1", "type" => "chat.message", "payload" => %{"text" => "lida"}},
        %{
          "seq" => 2,
          "id" => "m2",
          "type" => "chat.message",
          "payload" => %{"text" => "pendente"}
        },
        %{
          "seq" => 3,
          "id" => "m3",
          "type" => "chat.message",
          "payload" => %{"text" => "cancelada"}
        },
        enfileirada(4, "criativo", "m2", "pendente"),
        enfileirada(5, "criativo", "m3", "cancelada"),
        %{
          "seq" => 6,
          "type" => "chat.message_cancelled",
          "actor" => %{"kind" => "user", "id" => "u1"},
          "payload" => %{"mensagemId" => "m3"}
        }
      ]

      conteudos = eventos |> Reidratacao.mensagens("criativo") |> Enum.map(& &1["content"])
      assert conteudos == ["lida"]

      # Para outro agente a pendente do Criativo é conversa da sessão como
      # qualquer outra; a cancelada nunca foi dita a ninguém.
      conteudos_po = eventos |> Reidratacao.mensagens("po") |> Enum.map(& &1["content"])
      assert conteudos_po == ["lida", "pendente"]
    end
  end

  describe "mensagem com turno em curso" do
    test "entra na fila: 202-enfileirada, chat.message_queued no log, nenhuma recusa", %{
      state: state,
      session_id: session_id
    } do
      Process.put(:fake_llm_turn_stream_hang, true)
      assert {:reply, :ok, em_curso} = mensagem(state, "primeira", "m0")
      assert_receive :turno_pendurado, 1_000

      assert {:reply, {:ok, :enfileirada, 1}, com_fila} = mensagem(em_curso, "Continue", "m1")

      assert_received {:event_appended, _, ^session_id,
                       %{type: "chat.message_queued", actorId: "criativo", payload: payload}}

      assert payload.mensagemId == "m1"
      assert payload.texto == "Continue"
      assert payload.posicao == 1

      refute_received {:event_appended, _, ^session_id, %{type: "agent.error"}}
      # Não sobe uma segunda task, e não toca o histórico do turno em curso.
      assert com_fila.turno_assincrono == em_curso.turno_assincrono
      assert [%{id: "m1", texto: "Continue"}] = com_fila.fila_de_mensagens

      _ = TurnoAssincrono.cancelar(com_fila)
    end

    test "N mensagens = 1 turno: no fim do turno as pendentes são lidas juntas, na ordem", %{
      state: state,
      session_id: session_id
    } do
      {em_curso, portao} = turno_no_portao(state)
      assert_receive {:llm_turn_stream, "criativo", _primeiro_turno, _}, 1_000

      {:reply, {:ok, :enfileirada, 1}, s1} = mensagem(em_curso, "faltou o prazo", "m1")
      {:reply, {:ok, :enfileirada, 2}, s2} = mensagem(s1, "e o orçamento", "m2")

      Process.delete(:fake_llm_turn_stream_gate)
      fechado = fechar_turno(s2, portao)

      # O fim do turno AGENDA a entrega (uma mensagem a si mesmo), em vez de
      # subir o turno da fila dentro do mesmo `handle_info`.
      assert fechado.turno_assincrono == nil
      assert_received :entregar_fila_de_mensagens

      {:noreply, com_turno_da_fila} =
        CriativoServer.handle_info(:entregar_fila_de_mensagens, fechado)

      assert_received {:event_appended, _, ^session_id,
                       %{type: "chat.message_delivered", payload: %{mensagemIds: ["m1", "m2"]}}}

      assert %{turno_assincrono: %{task: %Task{}}, fila_de_mensagens: []} = com_turno_da_fila

      assert_receive {:llm_turn_stream, "criativo", wire, _}, 1_000
      # A última fala do usuário (a orientação de idioma da RN-622, quando há,
      # é uma mensagem de sistema DEPOIS dela).
      ultima = wire |> Enum.filter(&(&1["role"] == "user")) |> List.last()
      assert ultima["content"] =~ "[1] faltou o prazo"
      assert ultima["content"] =~ "[2] e o orçamento"

      # UM turno só: nenhuma terceira chamada ao modelo para a segunda mensagem.
      %{turno_assincrono: %{task: %Task{ref: ref}}} = com_turno_da_fila
      assert_receive {^ref, resultado}, 1_000
      {:noreply, final} = CriativoServer.handle_info({ref, resultado}, com_turno_da_fila)
      refute_received :entregar_fila_de_mensagens
      refute_received {:llm_turn_stream, "criativo", _, _}
      assert final.turno_assincrono == nil
    end

    test "a mensagem que chega entre o fim do turno e a entrega entra no FIM da fila", %{
      state: state,
      session_id: session_id
    } do
      {em_curso, portao} = turno_no_portao(state)
      {:reply, {:ok, :enfileirada, 1}, s1} = mensagem(em_curso, "antes", "m1")
      Process.delete(:fake_llm_turn_stream_gate)
      fechado = fechar_turno(s1, portao)
      assert_received :entregar_fila_de_mensagens

      # A nova chega ANTES de o processo atender a entrega agendada: não passa
      # na frente da que esperava.
      assert {:reply, :ok, entregue} = mensagem(fechado, "depois", "m2")

      assert_received {:event_appended, _, ^session_id,
                       %{type: "chat.message_delivered", payload: %{mensagemIds: ["m1", "m2"]}}}

      # A entrega agendada encontra o turno de pé e não faz nada.
      {:noreply, mesmo} = CriativoServer.handle_info(:entregar_fila_de_mensagens, entregue)
      assert mesmo.turno_assincrono == entregue.turno_assincrono
      _ = TurnoAssincrono.cancelar(mesmo)
    end

    test "teto de 10: a 11ª é recusada com nome, durável, e a fila não muda", %{
      state: state,
      session_id: session_id
    } do
      Process.put(:fake_llm_turn_stream_hang, true)
      {:reply, :ok, em_curso} = mensagem(state, "primeira", "m0")
      assert_receive :turno_pendurado, 1_000

      cheia =
        Enum.reduce(1..FilaDeMensagens.teto(), em_curso, fn i, acc ->
          {:reply, {:ok, :enfileirada, ^i}, novo} = mensagem(acc, "m#{i}", "m#{i}")
          novo
        end)

      assert length(cheia.fila_de_mensagens) == 10

      assert {:reply, {:error, :fila_de_mensagens_cheia}, ^cheia} =
               mensagem(cheia, "uma a mais", "m11")

      assert_received {:event_appended, _, ^session_id,
                       %{type: "agent.error", payload: %{reason: "fila_de_mensagens_cheia"} = p}}

      assert p.origem == "politica"
      assert p.mensagem =~ "10"

      _ = TurnoAssincrono.cancelar(cheia)
    end
  end

  describe "cancelar uma mensagem pendente" do
    test "some da fila e grava chat.message_cancelled em nome de quem cancelou", %{
      state: state,
      session_id: session_id
    } do
      Process.put(:fake_llm_turn_stream_hang, true)
      {:reply, :ok, em_curso} = mensagem(state, "primeira", "m0")
      assert_receive :turno_pendurado, 1_000
      {:reply, {:ok, :enfileirada, 1}, s1} = mensagem(em_curso, "a", "m1")
      {:reply, {:ok, :enfileirada, 2}, s2} = mensagem(s1, "b", "m2")

      assert {:reply, :ok, s3} =
               CriativoServer.handle_call(
                 {:cancelar_mensagem, "m1", "u-1"},
                 {self(), make_ref()},
                 s2
               )

      assert [%{id: "m2"}] = s3.fila_de_mensagens

      assert_received {:event_appended, _, ^session_id,
                       %{
                         type: "chat.message_cancelled",
                         actorKind: "user",
                         actorId: "u-1",
                         payload: %{mensagemId: "m1", agente: "criativo"}
                       }}

      _ = TurnoAssincrono.cancelar(s3)
    end

    test "mensagem fora da fila (já lida ou já cancelada) é recusada com nome, sem evento", %{
      state: state,
      session_id: session_id
    } do
      assert {:reply, {:error, :mensagem_fora_da_fila}, ^state} =
               CriativoServer.handle_call(
                 {:cancelar_mensagem, "nunca-enfileirada", "u-1"},
                 {self(), make_ref()},
                 state
               )

      refute_received {:event_appended, _, ^session_id, %{type: "chat.message_cancelled"}}
    end
  end

  describe "a fila sobrevive ao restart" do
    test "o init reconstrói a fila do log, tira a pendente do histórico e agenda a entrega" do
      project_id = Ecto.UUID.generate()
      session_id = Ecto.UUID.generate()

      Process.put(:fake_events, [
        %{"id" => "m1", "type" => "chat.message", "payload" => %{"text" => "ficou esperando"}},
        enfileirada(2, "criativo", "m1", "ficou esperando")
      ])

      {:ok, state} = CriativoServer.init({session_id, project_id})

      assert [%{id: "m1", texto: "ficou esperando"}] = state.fila_de_mensagens
      refute Enum.any?(state.messages, &(&1["content"] == "ficou esperando"))
      assert_received :entregar_fila_de_mensagens

      Process.put(:fake_events, [])
      {:noreply, entregue} = CriativoServer.handle_info(:entregar_fila_de_mensagens, state)

      assert_received {:event_appended, _, ^session_id,
                       %{type: "chat.message_delivered", payload: %{mensagemIds: ["m1"]}}}

      assert %{turno_assincrono: %{task: %Task{ref: ref}}} = entregue
      assert_receive {^ref, _}, 1_000
    end
  end

  describe "turno suspenso em aprovação (Dev Lead, RN-284)" do
    test "a mensagem nova segue recusada, e a fila não é entregue enquanto suspenso" do
      project_id = Ecto.UUID.generate()
      session_id = Ecto.UUID.generate()
      {:ok, state} = DevLeadServer.init({session_id, project_id})

      suspenso =
        state
        |> Map.put(:aguardando_aprovacao, %{action_id: "a1"})
        |> Map.put(:fila_de_mensagens, [%{id: "m1", texto: "esperando", idioma: nil}])

      assert {:reply, {:error, :aguardando_aprovacao}, _} =
               DevLeadServer.handle_call(
                 {:user_message, "e aí?", nil, "m2"},
                 {self(), make_ref()},
                 suspenso
               )

      assert {:noreply, mesmo} = DevLeadServer.handle_info(:entregar_fila_de_mensagens, suspenso)
      assert mesmo.turno_assincrono == nil
      assert [%{id: "m1"}] = mesmo.fila_de_mensagens
      refute_received {:event_appended, _, ^session_id, %{type: "chat.message_delivered"}}
    end
  end
end
