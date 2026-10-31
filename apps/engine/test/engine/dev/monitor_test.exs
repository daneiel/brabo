defmodule Engine.Dev.MonitorTest do
  # async: false — Monitor e DevAgentSupervisor são processos globais, e o
  # sandbox precisa estar em modo compartilhado pros agentes (que rodam em
  # processos próprios) enxergarem a conexão.
  use Engine.DataCase, async: false

  alias Engine.Dev.{DevAgentState, DevAgentSupervisor, Monitor}

  # O Monitor processa o :DOWN de forma assíncrona; espera ele esquecer o pid.
  defp wait_forget(pid, tentativas \\ 100) do
    if Map.has_key?(:sys.get_state(Monitor), pid) and tentativas > 0 do
      Process.sleep(10)
      wait_forget(pid, tentativas - 1)
    end
  end

  setup do
    %{project_id: Ecto.UUID.generate(), session_id: Ecto.UUID.generate()}
  end

  # AT-428 (RN-742): crash não é fim — vira agent.error durável (origem infra)
  # e o agente é religado da própria linha.
  test "agente que CAI grava agent.error infra e é religado", %{
    project_id: project_id,
    session_id: session_id
  } do
    Application.put_env(:engine, :test_pid, self())
    Application.put_env(:engine, :engine_api_client, Engine.Sessions.FakeEngineApiClient)
    on_exit(fn -> Application.delete_env(:engine, :engine_api_client) end)
    on_exit(fn -> Application.delete_env(:engine, :test_pid) end)

    {:ok, pid, :started} =
      DevAgentSupervisor.start_agent(project_id, "dev-api", "api", session_id, 500_000, 2, :noop)

    ref = Process.monitor(pid)
    Process.exit(pid, :kill)
    assert_receive {:DOWN, ^ref, :process, ^pid, _}, 1_000

    assert_receive {:event_appended, ^project_id, ^session_id,
                    %{type: "agent.error", payload: %{origem: "infra", religado: true}}},
                   2_000

    novo = espera_religado(project_id, "dev-api", pid)
    assert is_pid(novo) and novo != pid
    assert DevAgentState.get(project_id, "dev-api")
    :ok = DynamicSupervisor.terminate_child(DevAgentSupervisor, novo)
  end

  test "agente que termina :normal apaga a linha e não é religado", %{
    project_id: project_id,
    session_id: session_id
  } do
    {:ok, pid, :started} =
      DevAgentSupervisor.start_agent(project_id, "dev-x", "x", session_id, 500_000, 2, :noop)

    ref = Process.monitor(pid)
    GenServer.stop(pid, :normal)
    assert_receive {:DOWN, ^ref, :process, ^pid, _}, 1_000
    wait_forget(pid)
    refute DevAgentState.get(project_id, "dev-x")
  end

  test "sem linha durável, o crash não religa nem grava evento", %{project_id: project_id} do
    Application.put_env(:engine, :test_pid, self())
    Application.put_env(:engine, :engine_api_client, Engine.Sessions.FakeEngineApiClient)
    on_exit(fn -> Application.delete_env(:engine, :engine_api_client) end)
    on_exit(fn -> Application.delete_env(:engine, :test_pid) end)

    entry = %{project_id: project_id, agent_id: "dev-sem-linha"}
    Monitor.registrar_e_religar(entry, nil, :boom, false)
    refute_received {:event_appended, _, _, _}
    assert Registry.lookup(Engine.Dev.Registry, {project_id, "dev-sem-linha"}) == []
  end

  defp espera_religado(project_id, agent_id, antigo, tentativas \\ 100) do
    case Registry.lookup(Engine.Dev.Registry, {project_id, agent_id}) do
      [{pid, _}] when pid != antigo ->
        if Process.alive?(pid), do: pid, else: retry(project_id, agent_id, antigo, tentativas)

      _ ->
        retry(project_id, agent_id, antigo, tentativas)
    end
  end

  defp retry(_p, _a, _antigo, 0), do: nil

  defp retry(p, a, antigo, n) do
    Process.sleep(20)
    espera_religado(p, a, antigo, n - 1)
  end

  test "desligamento do supervisor PRESERVA a linha (é o caso que a rehydration cobre)", %{
    project_id: project_id,
    session_id: session_id
  } do
    {:ok, pid, :started} =
      DevAgentSupervisor.start_agent(project_id, "dev-web", "web", session_id, 500_000, 2)

    :ok = DynamicSupervisor.terminate_child(DevAgentSupervisor, pid)
    wait_forget(pid)

    assert DevAgentState.get(project_id, "dev-web"),
           "a linha sumiu num :shutdown — o nó reiniciaria sem os agentes que tinha"
  end
end
