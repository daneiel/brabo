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

  test "agente que morre apaga a própria linha — não volta no boot seguinte", %{
    project_id: project_id,
    session_id: session_id
  } do
    {:ok, pid, :started} =
      DevAgentSupervisor.start_agent(project_id, "dev-api", "api", session_id, 500_000, 2)

    assert DevAgentState.get(project_id, "dev-api")

    ref = Process.monitor(pid)
    Process.exit(pid, :kill)
    assert_receive {:DOWN, ^ref, :process, ^pid, _}, 1_000
    wait_forget(pid)

    refute DevAgentState.get(project_id, "dev-api"),
           "a linha sobreviveu ao agente: o DevRehydrator o ressuscitaria a cada boot"

    # E o rehydrator de fato não o vê mais.
    refute Enum.any?(
             DevAgentState.list_all(),
             &(&1.project_id == project_id and &1.agent_id == "dev-api")
           )
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
