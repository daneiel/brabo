defmodule Engine.Sessions.SessionLifecycleTest do
  # async: false — mexe em Application env compartilhado e nos processos
  # globais (Monitor, Registry). Engine.DataCase (não ExUnit.Case puro)
  # porque SessionServer.init/1 agora grava em session_states — como o
  # processo é spawnado pelo SessionSupervisor (não é filho do processo de
  # teste), a conexão sandboxed precisa estar em modo compartilhado
  # (async: false => shared: true em Engine.DataCase.setup_sandbox/1).
  use Engine.DataCase, async: false

  alias Engine.Sessions.{Monitor, SessionServer, SessionState, SessionSupervisor}

  setup do
    # async: false só serializa DENTRO deste módulo — outros arquivos de
    # teste que também mutam Monitor/Registry/test_pid global rodariam
    # concorrentemente sem este lock (ver Engine.GlobalSessionTestLock).
    Engine.GlobalSessionTestLock.acquire()
    Application.put_env(:engine, :engine_api_client, Engine.Sessions.FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :test_pid)
      Engine.GlobalSessionTestLock.release()
    end)

    :ok
  end

  test "parada esperada (expect_stop) nao dispara callback" do
    session_id = unique_id()
    {:ok, pid} = SessionSupervisor.start_session(session_id, "project-1")

    :ok = Monitor.expect_stop(session_id)
    SessionServer.stop(pid)

    refute_receive {:termination_reported, _, _, _, _}, 200
  end

  # O heartbeat mede inatividade da ABA (30s), não do TRABALHO. Numa execução
  # real isso matou a sessão assim que a tela saiu dela para o Backlog, e
  # prendeu um handoff `offered` para o Arquiteto numa sessão fechada — épico e
  # quatro histórias prontos, e a cadeia sem como seguir.
  test "heartbeat NÃO encerra sessão com trabalho pendente" do
    session_id = unique_id()

    Application.put_env(:engine, :fake_pending_work, %{
      pending: true,
      motivo: "handoff po → arquiteto"
    })

    on_exit(fn -> Application.delete_env(:engine, :fake_pending_work) end)
    {:ok, pid} = SessionSupervisor.start_session(session_id, "project-1")

    send(pid, :heartbeat_timeout)

    refute_receive {:termination_reported, _, ^session_id, "heartbeat_timeout", _}, 300
    assert Process.alive?(pid)
  end

  test "heartbeat encerra normalmente quando não há trabalho pendente" do
    session_id = unique_id()
    Application.put_env(:engine, :fake_pending_work, %{pending: false, motivo: nil})
    on_exit(fn -> Application.delete_env(:engine, :fake_pending_work) end)
    {:ok, pid} = SessionSupervisor.start_session(session_id, "project-1")

    send(pid, :heartbeat_timeout)

    assert_receive {:termination_reported, "project-1", ^session_id, "heartbeat_timeout",
                    "closed"}
  end

  # RN-581 (AT-072). No `exp001` o heartbeat fechou a sessão 30s depois de a
  # aba parar, com o Criativo tendo acabado de perguntar. Conversa esperando o
  # usuário segura a sessão — mas com TETO, contado do fim do turno.
  describe "conversa esperando o usuário (RN-581)" do
    setup do
      Application.put_env(:engine, :session_conversation_idle_timeout_ms, 60_000)

      on_exit(fn ->
        Application.delete_env(:engine, :session_conversation_idle_timeout_ms)
        Application.delete_env(:engine, :fake_pending_work)
      end)

      :ok
    end

    test "dentro do teto, reagenda em vez de encerrar" do
      session_id = unique_id()

      Application.put_env(:engine, :fake_pending_work, %{
        pending: true,
        motivo: "agente criativo aguardando resposta do usuário",
        aguardando_usuario_desde: DateTime.add(DateTime.utc_now(), -30, :second)
      })

      {:ok, pid} = SessionSupervisor.start_session(session_id, "project-1")
      send(pid, :heartbeat_timeout)

      refute_receive {:termination_reported, _, ^session_id, _, _}, 300
      assert Process.alive?(pid)

      :ok = Monitor.expect_stop(session_id)
      SessionServer.stop(pid)
    end

    test "acima do teto, encerra com causa PRÓPRIA (conversation_idle_timeout), closed" do
      session_id = unique_id()

      Application.put_env(:engine, :fake_pending_work, %{
        pending: true,
        motivo: "agente criativo aguardando resposta do usuário",
        aguardando_usuario_desde: DateTime.add(DateTime.utc_now(), -61, :second)
      })

      {:ok, pid} = SessionSupervisor.start_session(session_id, "project-1")
      send(pid, :heartbeat_timeout)

      assert_receive {:termination_reported, "project-1", ^session_id,
                      "conversation_idle_timeout", "closed"}

      refute Process.alive?(pid)
    end

    test "o teto default é 8h: uma conversa parada há 7h59 segura a sessão" do
      Application.delete_env(:engine, :session_conversation_idle_timeout_ms)
      session_id = unique_id()

      Application.put_env(:engine, :fake_pending_work, %{
        pending: true,
        motivo: "agente po aguardando resposta do usuário",
        aguardando_usuario_desde: DateTime.add(DateTime.utc_now(), -(8 * 3600 - 60), :second)
      })

      {:ok, pid} = SessionSupervisor.start_session(session_id, "project-1")
      send(pid, :heartbeat_timeout)

      refute_receive {:termination_reported, _, ^session_id, _, _}, 300

      Application.put_env(:engine, :fake_pending_work, %{
        pending: true,
        motivo: "agente po aguardando resposta do usuário",
        aguardando_usuario_desde: DateTime.add(DateTime.utc_now(), -(8 * 3600 + 1), :second)
      })

      send(pid, :heartbeat_timeout)

      assert_receive {:termination_reported, "project-1", ^session_id,
                      "conversation_idle_timeout", "closed"}
    end

    # AT-152: aba aberta = pings chegando, heartbeat nunca expira.
    test "com a aba ABERTA (pings), conversa ociosa além do teto fecha por conversation_idle_timeout" do
      Application.put_env(:engine, :session_heartbeat_timeout_ms, 200)
      Application.put_env(:engine, :session_conversation_idle_check_ms, 50)

      on_exit(fn ->
        Application.delete_env(:engine, :session_heartbeat_timeout_ms)
        Application.delete_env(:engine, :session_conversation_idle_check_ms)
      end)

      session_id = unique_id()

      Application.put_env(:engine, :fake_pending_work, %{
        pending: true,
        motivo: "agente criativo aguardando resposta do usuário",
        aguardando_usuario_desde: DateTime.add(DateTime.utc_now(), -61, :second)
      })

      {:ok, pid} = SessionSupervisor.start_session(session_id, "project-1")

      pinger =
        spawn_link(fn ->
          Stream.repeatedly(fn ->
            try do
              SessionServer.heartbeat(session_id)
            catch
              :exit, _ -> :ok
            end

            Process.sleep(30)
          end)
          |> Stream.run()
        end)

      on_exit(fn -> Process.exit(pinger, :kill) end)

      assert_receive {:termination_reported, "project-1", ^session_id,
                      "conversation_idle_timeout", "closed"},
                     1_000

      refute Process.alive?(pid)
    end

    test "com a aba ABERTA, conversa DENTRO do teto não fecha" do
      Application.put_env(:engine, :session_heartbeat_timeout_ms, 200)
      Application.put_env(:engine, :session_conversation_idle_check_ms, 50)

      on_exit(fn ->
        Application.delete_env(:engine, :session_heartbeat_timeout_ms)
        Application.delete_env(:engine, :session_conversation_idle_check_ms)
      end)

      session_id = unique_id()

      Application.put_env(:engine, :fake_pending_work, %{
        pending: true,
        motivo: "agente criativo aguardando resposta do usuário",
        aguardando_usuario_desde: DateTime.add(DateTime.utc_now(), -30, :second)
      })

      {:ok, pid} = SessionSupervisor.start_session(session_id, "project-1")

      Process.sleep(60)
      :ok = SessionServer.heartbeat(session_id)
      Process.sleep(60)
      :ok = SessionServer.heartbeat(session_id)

      refute_receive {:termination_reported, _, ^session_id, _, _}, 150
      assert Process.alive?(pid)

      :ok = Monitor.expect_stop(session_id)
      SessionServer.stop(pid)
    end

    test "pendência SEM instante continua sem teto (os quatro sinais de antes)" do
      Application.put_env(:engine, :session_conversation_idle_timeout_ms, 0)
      session_id = unique_id()

      Application.put_env(:engine, :fake_pending_work, %{
        pending: true,
        motivo: "handoff po → arquiteto aguardando aceite",
        aguardando_usuario_desde: nil
      })

      {:ok, pid} = SessionSupervisor.start_session(session_id, "project-1")
      send(pid, :heartbeat_timeout)

      refute_receive {:termination_reported, _, ^session_id, _, _}, 300
      assert Process.alive?(pid)

      :ok = Monitor.expect_stop(session_id)
      SessionServer.stop(pid)
    end
  end

  test "parada normal SEM expect_stop dispara callback (defensivo, closed_abnormally)" do
    session_id = unique_id()
    {:ok, pid} = SessionSupervisor.start_session(session_id, "project-1")

    SessionServer.stop(pid)

    assert_receive {:termination_reported, "project-1", ^session_id, "normal",
                    "closed_abnormally"}
  end

  test ":killed dispara callback com motivo killed (closed_abnormally) e limpa session_states" do
    session_id = unique_id()
    {:ok, pid} = SessionSupervisor.start_session(session_id, "project-1")
    assert SessionState.list_non_terminal() |> Enum.any?(&(&1.session_id == session_id))

    Process.exit(pid, :kill)

    assert_receive {:termination_reported, "project-1", ^session_id, "killed",
                    "closed_abnormally"}

    refute SessionState.list_non_terminal() |> Enum.any?(&(&1.session_id == session_id))
  end

  test "crash (raise) dispara callback com a mensagem da excecao (closed_abnormally)" do
    session_id = unique_id()
    {:ok, pid} = SessionSupervisor.start_session(session_id, "project-1")

    SessionServer.crash(pid)

    assert_receive {:termination_reported, "project-1", ^session_id, reason, "closed_abnormally"}
    assert reason =~ "crash simulado da sessão #{session_id}"
  end

  test "timeout de heartbeat dispara callback com to=closed" do
    Application.put_env(:engine, :session_heartbeat_timeout_ms, 50)
    on_exit(fn -> Application.delete_env(:engine, :session_heartbeat_timeout_ms) end)

    session_id = unique_id()
    {:ok, _pid} = SessionSupervisor.start_session(session_id, "project-1")

    assert_receive {:termination_reported, "project-1", ^session_id, "heartbeat_timeout",
                    "closed"},
                   300
  end

  test "heartbeat reseta o timer e evita o timeout" do
    Application.put_env(:engine, :session_heartbeat_timeout_ms, 100)
    on_exit(fn -> Application.delete_env(:engine, :session_heartbeat_timeout_ms) end)

    session_id = unique_id()
    {:ok, pid} = SessionSupervisor.start_session(session_id, "project-1")

    # dá 2 pings dentro da janela — se o timer não resetasse, o timeout
    # de 100ms teria disparado bem antes dos 250ms totais aqui.
    Process.sleep(60)
    :ok = SessionServer.heartbeat(session_id)
    Process.sleep(60)
    :ok = SessionServer.heartbeat(session_id)

    refute_receive {:termination_reported, _, _, _, _}, 80

    # o timer de heartbeat continua pendente depois daqui — encerra
    # explicitamente pra não vazar um :heartbeat_timeout tardio pro
    # mailbox do PRÓXIMO teste (que reusa o mesmo test_pid).
    :ok = Monitor.expect_stop(session_id)
    SessionServer.stop(pid)
  end

  defp unique_id, do: "session-#{System.unique_integer([:positive])}"
end
