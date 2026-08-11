defmodule Engine.Agents.TurnoAssincronoTest do
  @moduledoc """
  RN-121: o turno de um agente conversacional passou a rodar numa Task
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

    assert {:noreply, state_with_task} =
             CriativoServer.handle_call({:user_message, "oi"}, from, state)

    # Prova que o turno REALMENTE chegou a chamar `llm_turn_stream` dentro da
    # task — não é uma asserção sobre uma mock que nunca roda nada.
    assert_receive :turno_pendurado, 1_000

    {state_with_task, from}
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

      # `from` foi respondido com o cancelamento — quem fez o `GenServer.call`
      # original não fica pendurado esperando um turno que não vai terminar.
      assert_received {^tag, {:error, :cancelado}}

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

      segunda_from = {self(), make_ref()}

      assert {:reply, {:error, :turno_em_andamento}, ^state_with_task} =
               CriativoServer.handle_call(
                 {:user_message, "outra coisa"},
                 segunda_from,
                 state_with_task
               )

      # A PRIMEIRA task continua sendo a única — limpa no fim do teste.
      _ = TurnoAssincrono.cancelar(state_with_task)
    end
  end

  describe "a task que CRASHA (não é cancelamento) também fecha o turno" do
    test "vira agent.error com origem classificada, e o from recebe {:error, {:crash, _}}", %{
      state: state,
      session_id: session_id
    } do
      from = {self(), make_ref()}

      {:noreply, state_with_task} =
        TurnoAssincrono.iniciar(state, from, fn -> raise "boom" end)

      %{task: %Task{ref: ref}} = state_with_task.turno_assincrono

      assert_receive {:DOWN, ^ref, :process, pid, reason}, 1_000

      {:ok, final_state} =
        TurnoAssincrono.tratar_resultado({:DOWN, ref, :process, pid, reason}, state_with_task)

      assert final_state.turno_assincrono == nil
      assert_received {_tag, {:error, {:crash, _reason}}}
      assert_received {:event_appended, _, ^session_id, %{type: "agent.error", payload: payload}}
      assert payload.mensagem =~ "caiu de forma inesperada"
    end
  end
end
