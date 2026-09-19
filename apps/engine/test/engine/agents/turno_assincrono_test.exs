defmodule Engine.Agents.TurnoAssincronoTest do
  @moduledoc """
  RN-122: o turno de um agente conversacional passou a rodar numa Task
  supervisionada, fora do `handle_call`/`handle_cast` que antes bloqueava o
  processo inteiro — é o que permite `:cancel` chegar e ser atendido.

  Estes testes usam o `CriativoServer` de verdade (mesmo padrão dos outros
  `*_server_test.exs`: callbacks exercitados direto no processo de teste),
  mas o ponto central daqui NÃO é o Criativo — é provar que a TASK sobe de
  verdade sob `Engine.TaskSupervisor` (o supervisor real da aplicação, não
  um fake) e que `Task.shutdown/2` MATA o processo dela, não só ignora o
  resultado. `:fake_llm_turn_stream_hang` (`FakeEngineApiClient`) prende o
  turno num `Process.sleep(:infinity)` — só uma morte de verdade o encerra.
  """
  use Engine.DataCase, async: false

  alias Engine.Agents.{CriativoServer, TurnoAssincrono}
  alias Engine.Sessions.FakeEngineApiClient

  setup do
    root =
      Path.join(
        System.tmp_dir!(),
        "brabo-turno-#{System.os_time(:microsecond)}-#{System.unique_integer([:positive])}"
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
    %{state: state, session_id: session_id}
  end

  # Sobe um turno que PRENDE de verdade (hang) e devolve o state com a task
  # em curso — usado pelos testes que precisam de um "meio" real para
  # cancelar. `from` pode ser um `{pid, tag}` de teste (default) ou `nil`
  # (simulando kickoff/cast).
  defp turno_pendurado(state, from \\ nil) do
    from = from || {self(), make_ref()}
    Process.put(:fake_llm_turn_stream_hang, true)

    # ADR 0163 (RN-578): o aceite volta NA HORA, com o turno ainda rodando.
    assert {:reply, :ok, state_with_task} =
             CriativoServer.handle_call({:user_message, "oi"}, from, state)

    # Prova que o turno REALMENTE chegou a chamar `llm_turn_stream` dentro da
    # task — não é uma asserção sobre uma mock que nunca roda nada.
    assert_receive :turno_pendurado, 1_000

    {state_with_task, from}
  end

  describe "o aceite sai ANTES do turno terminar (ADR 0163, RN-578)" do
    # O defeito medido numa instalação real: três cliques de 97,3 s, 97,3 s e
    # 51,8 s, cada um esperando o turno inteiro do agente que disparou.
    test "com `from`, responde :ok com a task AINDA viva", %{state: state} do
      Process.put(:fake_llm_turn_stream_hang, true)
      from = {self(), make_ref()}

      assert {:reply, :ok, state_with_task} =
               CriativoServer.handle_call({:user_message, "oi"}, from, state)

      assert_receive :turno_pendurado, 1_000
      assert Process.alive?(state_with_task.turno_assincrono.task.pid)

      _ = TurnoAssincrono.cancelar(state_with_task)
    end

    # A ORDEM é contrato: a tela, depois do aceite, lê o log e fecha a faixa
    # quando o `agent.status` mais recente do agente não é `working`. Se o
    # `working` do turno novo fosse gravado DEPOIS do aceite, o `idle` do
    # turno anterior seria o mais recente e a tela fecharia um turno que
    # acabou de começar.
    test "o agent.status working já está gravado quando o aceite volta", %{
      state: state,
      session_id: session_id
    } do
      from = {self(), make_ref()}

      assert {:reply, :ok, state_with_task} =
               TurnoAssincrono.iniciar(state, from, fn ->
                 Process.sleep(:infinity)
               end)

      assert_received {:event_appended, _, ^session_id,
                       %{type: "agent.status", payload: %{status: "working"}}}

      _ = TurnoAssincrono.cancelar(state_with_task)
    end

    test "sem `from` (kickoff), continua :noreply", %{state: state} do
      assert {:noreply, state_with_task} = TurnoAssincrono.iniciar(state, nil, fn -> state end)
      %{task: %Task{ref: ref}} = state_with_task.turno_assincrono
      assert_receive {^ref, _}, 1_000
    end
  end

  describe "cancelar/1 mata a task DE VERDADE" do
    test "o processo da task morre, e não continua consumindo em segundo plano", %{
      state: state,
      session_id: session_id
    } do
      {state_with_task, {_pid, tag}} = turno_pendurado(state)

      task_pid = state_with_task.turno_assincrono.task.pid
      assert Process.alive?(task_pid), "a task precisa estar viva ANTES do cancelamento"

      cancelado = TurnoAssincrono.cancelar(state_with_task)

      # O CENTRO deste teste: a task morreu de verdade. Não "parou de
      # importar o resultado dela" — o PROCESSO acabou. Um `Process.sleep(
      # :infinity)` só termina por sinal de kill; se isto passar, é porque
      # `Task.shutdown/2, :brutal_kill` matou o processo, não só descartou a
      # referência.
      refute Process.alive?(task_pid),
             "a task tinha que estar morta — cancelar não pode deixar o turno vivo em segundo plano"

      assert cancelado.turno_assincrono == nil

      # Ninguém é respondido no cancelamento: quem fez o `GenServer.call` já
      # recebeu o aceite no início (ADR 0163). Um segundo `reply` ao mesmo
      # `from` seria mensagem órfã na caixa de quem chamou.
      refute_received {^tag, _}

      # O evento TERMINAL foi gravado: sem ele, `GetSessionPendingWorkUseCase`
      # veria `agent.activated` sem `agent.response`/`agent.error` posterior e
      # a sessão ficaria pendurada pro sinal de pendência.
      assert_received {:event_appended, _, ^session_id, %{type: "agent.error", payload: payload}}
      assert payload.origem == "politica"
      assert payload.reason == "cancelado_pelo_usuario"
      assert payload.mensagem =~ "cancelad"
    end

    test "broadcast de fim de turno (agent.done/idle) acontece mesmo cancelado", %{state: state} do
      Phoenix.PubSub.subscribe(Engine.PubSub, "session:" <> state.session_id)
      {state_with_task, _from} = turno_pendurado(state)

      _ = TurnoAssincrono.cancelar(state_with_task)

      assert_received %Phoenix.Socket.Broadcast{event: "agent.done"}
      assert_received %Phoenix.Socket.Broadcast{event: "agent.status", payload: %{status: "idle"}}
      assert_received %Phoenix.Socket.Broadcast{event: "agent.error"}
    end
  end

  # RN-581: a sessão fechou e o agente está sendo parado. Diferente de
  # cancelar, NADA é gravado — a api recusaria (sessão encerrada não aceita
  # conversa) e o canal já foi embora. A task é `async_nolink`: sem isto ela
  # sobreviveria ao servidor e seguiria chamando o modelo.
  describe "abandonar/1 e terminate/2 (sessão encerrada)" do
    test "abandonar mata a task, NÃO responde de novo e NÃO grava nem transmite nada", %{
      state: state
    } do
      Phoenix.PubSub.subscribe(Engine.PubSub, "session:" <> state.session_id)
      # ADR 0163: o `from` já recebeu `:ok` no aceite e não mora no state.
      {state_with_task, {_pid, tag}} = turno_pendurado(state)
      refute Map.has_key?(state_with_task.turno_assincrono, :from)
      task_pid = state_with_task.turno_assincrono.task.pid
      # O que o INÍCIO do turno gravou/transmitiu (agent.status working) não é
      # o assunto — o que se afirma é que abandonar não acrescenta nada.
      esvaziar_caixa()

      abandonado = TurnoAssincrono.abandonar(state_with_task)

      refute Process.alive?(task_pid)
      assert abandonado.turno_assincrono == nil
      refute_received {^tag, _}
      refute_received {:event_appended, _, _, _}
      refute_received %Phoenix.Socket.Broadcast{}
    end

    test "abandonar sem turno é no-op", %{state: state} do
      assert TurnoAssincrono.abandonar(state) == state
    end

    defp esvaziar_caixa do
      receive do
        _ -> esvaziar_caixa()
      after
        0 -> :ok
      end
    end

    test "o terminate/2 do servidor abandona o turno em curso", %{state: state} do
      {state_with_task, _from} = turno_pendurado(state)
      task_pid = state_with_task.turno_assincrono.task.pid
      esvaziar_caixa()

      assert :ok = CriativoServer.terminate({:shutdown, :sessao_encerrada}, state_with_task)

      refute Process.alive?(task_pid)
      refute_received {:event_appended, _, _, _}
    end
  end

  describe "cancelar/1 sem turno em curso é NO-OP idempotente" do
    test "não muda o state e não manda mensagem nenhuma", %{state: state} do
      assert state.turno_assincrono == nil

      resultado = TurnoAssincrono.cancelar(state)

      assert resultado == state
      refute_received {:event_appended, _, _, %{type: "agent.error"}}
    end

    test "cancelar duas vezes seguidas (segundo cancel depois de já ter cancelado) não quebra",
         %{state: state} do
      {state_with_task, _from} = turno_pendurado(state)

      cancelado_uma_vez = TurnoAssincrono.cancelar(state_with_task)
      cancelado_de_novo = TurnoAssincrono.cancelar(cancelado_uma_vez)

      assert cancelado_de_novo == cancelado_uma_vez
    end
  end

  describe "uma segunda mensagem enquanto o turno está em curso" do
    test "responde {:error, :turno_em_andamento} e NÃO sobe uma segunda task", %{state: state} do
      {state_with_task, _from} = turno_pendurado(state)

      Phoenix.PubSub.subscribe(Engine.PubSub, "session:" <> state.session_id)
      session_id = state.session_id
      segunda_from = {self(), make_ref()}

      assert {:reply, {:error, :turno_em_andamento}, ^state_with_task} =
               CriativoServer.handle_call(
                 {:user_message, "outra coisa"},
                 segunda_from,
                 state_with_task
               )

      # ADR 0163 (RN-578): a recusa deixou de ser calada. Até lá o controller
      # descartava este retorno e o clique recebia 202 — a mensagem ficava no
      # log como `chat.message` e nunca chegava ao modelo, sem rastro.
      assert_received {:event_appended, _, ^session_id,
                       %{type: "agent.error", payload: %{reason: "turno_em_andamento"} = payload}}

      assert payload.origem == "politica"
      assert payload.mensagem =~ "não a li"
      assert_received %Phoenix.Socket.Broadcast{event: "agent.error"}

      # E NÃO fecha o turno em curso: `agent.done`/`idle` diriam à tela que
      # a PRIMEIRA mensagem acabou.
      refute_received %Phoenix.Socket.Broadcast{event: "agent.done"}

      # A PRIMEIRA task continua sendo a única — limpa no fim do teste.
      _ = TurnoAssincrono.cancelar(state_with_task)
    end
  end

  describe "a task que CRASHA (não é cancelamento) também fecha o turno" do
    test "vira agent.error com origem classificada, e o from só recebeu o aceite", %{
      state: state,
      session_id: session_id
    } do
      {_pid, tag} = from = {self(), make_ref()}

      {:reply, :ok, state_with_task} =
        TurnoAssincrono.iniciar(state, from, fn -> raise "boom" end)

      %{task: %Task{ref: ref}} = state_with_task.turno_assincrono

      assert_receive {:DOWN, ^ref, :process, pid, reason}, 1_000

      {:ok, final_state} =
        TurnoAssincrono.tratar_resultado({:DOWN, ref, :process, pid, reason}, state_with_task)

      assert final_state.turno_assincrono == nil
      refute_received {^tag, _}
      assert_received {:event_appended, _, ^session_id, %{type: "agent.error", payload: payload}}
      assert payload.mensagem =~ "caiu de forma inesperada"
    end
  end

  describe "a task que devolve algo que NÃO é o state" do
    # A segunda barreira, e ela existe por uma queda real: o ramo do erro
    # narrado no frame final devolvia `{state, ""}` (tupla) onde todos os
    # outros ramos de `run_turn` devolvem `state` (mapa). O `Map.put/3` de
    # `tratar_resultado/2` levantava `BadMapError` DENTRO do `handle_info` do
    # agente, que é `restart: :temporary` e não voltava.
    #
    # Os três ramos foram corrigidos onde nasciam (po/arquiteto/dev_lead), mas
    # a sobrevivência do agente não pode depender de todo ramo futuro lembrar
    # do formato — daí a cláusula que narra em vez de derrubar.
    test "narra a falha com origem `codigo` em vez de levantar BadMapError", %{
      state: state,
      session_id: session_id
    } do
      {_pid, tag} = from = {self(), make_ref()}

      {:reply, :ok, state_with_task} =
        TurnoAssincrono.iniciar(state, from, fn -> {state, ""} end)

      %{task: %Task{ref: ref}} = state_with_task.turno_assincrono
      assert_receive {^ref, resultado}, 1_000

      # Antes da correção esta linha levantava `BadMapError` — que num
      # GenServer de verdade é a morte do agente.
      assert {:ok, final_state} =
               TurnoAssincrono.tratar_resultado({ref, resultado}, state_with_task)

      assert final_state.turno_assincrono == nil

      assert_received {:event_appended, _, ^session_id, %{type: "agent.error", payload: payload}}
      assert payload.origem == "codigo"
      assert payload.mensagem =~ "formato que o engine não sabe incorporar"
      assert payload.reason =~ "resultado_de_turno_invalido"

      # Quem chamou já tinha o aceite desde o início; o desfecho é o
      # `agent.error` durável acima, nunca uma segunda resposta.
      refute_received {^tag, _}
    end

    # O state PRESERVADO é o anterior ao turno: perder o histórico do turno é
    # caro, perder o agente é pior — e é a única escolha possível, já que o
    # resultado fora do contrato não é um state que se possa incorporar.
    test "preserva o state anterior ao turno", %{state: state} do
      from = {self(), make_ref()}

      {:reply, :ok, state_with_task} =
        TurnoAssincrono.iniciar(state, from, fn -> :qualquer_coisa end)

      %{task: %Task{ref: ref}} = state_with_task.turno_assincrono
      assert_receive {^ref, resultado}, 1_000

      {:ok, final_state} = TurnoAssincrono.tratar_resultado({ref, resultado}, state_with_task)

      assert final_state.messages == state.messages
      assert final_state.session_id == state.session_id
    end
  end

  describe "resultado com :aguardando_aprovacao (ADR 0086, RN-284)" do
    # O caso do Dev Lead: o turno parou no meio de um tool call que virou
    # `proposed_action` pending. O turno NÃO terminou. Desde o ADR 0163 o
    # `from` já foi respondido no `iniciar/3` — como em todo turno.
    test "NÃO emite agent.done, e emite agent.status: awaiting_approval", %{
      state: state
    } do
      Phoenix.PubSub.subscribe(Engine.PubSub, "session:" <> state.session_id)
      from = {self(), make_ref()}

      pendente = %{action_id: "pa-1", tool_call_id: "call-1", tool_name: "propose_execution_plan"}

      {:reply, :ok, state_with_task} =
        TurnoAssincrono.iniciar(state, from, fn ->
          Map.put(state, :aguardando_aprovacao, pendente)
        end)

      %{task: %Task{ref: ref}} = state_with_task.turno_assincrono
      assert_receive {^ref, resultado}, 1_000

      assert {:ok, final_state} =
               TurnoAssincrono.tratar_resultado({ref, resultado}, state_with_task)

      # O aceite foi a tupla do `iniciar/3`; nada chega ao `from` depois.
      {_pid, tag} = from
      refute_received {^tag, _}

      # O turno_assincrono foi limpo (mesmo caminho de sempre)...
      assert final_state.turno_assincrono == nil
      # ...mas a chave de suspensão SOBREVIVE no state devolvido — é o que o
      # chamador (`DevLeadServer`) lê para saber que está esperando.
      assert final_state.aguardando_aprovacao == pendente

      # NUNCA agent.done: o turno não terminou.
      refute_received %Phoenix.Socket.Broadcast{event: "agent.done"}
      # NUNCA agent.status: idle — diria ao painel que o agente está livre.
      refute_received %Phoenix.Socket.Broadcast{event: "agent.status", payload: %{status: "idle"}}
      # SÓ o status de suspensão.
      assert_received %Phoenix.Socket.Broadcast{
        event: "agent.status",
        payload: %{status: "awaiting_approval"}
      }
    end

    test "sem a chave :aguardando_aprovacao, o caminho de sempre (finalizar/1) continua valendo",
         %{state: state} do
      Phoenix.PubSub.subscribe(Engine.PubSub, "session:" <> state.session_id)
      from = {self(), make_ref()}

      {:reply, :ok, state_with_task} = TurnoAssincrono.iniciar(state, from, fn -> state end)
      %{task: %Task{ref: ref}} = state_with_task.turno_assincrono
      assert_receive {^ref, resultado}, 1_000

      assert {:ok, final_state} =
               TurnoAssincrono.tratar_resultado({ref, resultado}, state_with_task)

      refute Map.has_key?(final_state, :aguardando_aprovacao)
      assert_received %Phoenix.Socket.Broadcast{event: "agent.done"}
      assert_received %Phoenix.Socket.Broadcast{event: "agent.status", payload: %{status: "idle"}}
    end
  end
end
