defmodule Engine.Dev.DevRehydratorTest do
  # async: false — DevAgentSupervisor e Registry são processos globais, e os
  # agentes rodam em processos próprios (sandbox em modo compartilhado).
  use Engine.DataCase, async: false

  alias Engine.Dev.{
    DevAgentServer,
    DevAgentState,
    DevAgentSupervisor,
    DevRehydrator,
    NoopDevAgentServer
  }

  alias Engine.Sessions.FakeEngineApiClient

  setup do
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :test_pid)
    end)

    %{project_id: Ecto.UUID.generate(), session_id: Ecto.UUID.generate()}
  end

  # De qual módulo o processo registrado é — é o que distingue um dev agent
  # real de um Noop depois que a reidratação já rodou.
  defp server_module(project_id, agent_id) do
    [{pid, _}] = Registry.lookup(Engine.Dev.Registry, {project_id, agent_id})
    {:dictionary, dict} = Process.info(pid, :dictionary)
    {mod, :init, 1} = Keyword.fetch!(dict, :"$initial_call")
    mod
  end

  defp desliga(project_id, agent_id) do
    # :shutdown PRESERVA a linha durável — é exatamente o caso que a
    # reidratação cobre (o nó caiu com o agente vivo).
    [{pid, _}] = Registry.lookup(Engine.Dev.Registry, {project_id, agent_id})
    :ok = DynamicSupervisor.terminate_child(DevAgentSupervisor, pid)
    wait_unregister(project_id, agent_id)
  end

  defp wait_unregister(project_id, agent_id, tentativas \\ 100) do
    if Registry.lookup(Engine.Dev.Registry, {project_id, agent_id}) != [] and tentativas > 0 do
      Process.sleep(10)
      wait_unregister(project_id, agent_id, tentativas - 1)
    end
  end

  test "reidrata um NoopDevAgent como Noop — não como agente real", %{
    project_id: project_id,
    session_id: session_id
  } do
    {:ok, _pid, :started} =
      DevAgentSupervisor.start_agent(project_id, "dev-api", "api", session_id, 500_000, 2, :noop)

    assert server_module(project_id, "dev-api") == NoopDevAgentServer
    assert DevAgentState.get(project_id, "dev-api").impl == "noop"

    desliga(project_id, "dev-api")
    :ok = DevRehydrator.run()

    assert server_module(project_id, "dev-api") == NoopDevAgentServer,
           "o Noop voltou como agente REAL: um restart do nó trocaria a implementação " <>
             "(e passaria a gastar token) sem ninguém pedir"

    desliga(project_id, "dev-api")
  end

  test "reidrata um dev agent real como real", %{
    project_id: project_id,
    session_id: session_id
  } do
    {:ok, _pid, :started} =
      DevAgentSupervisor.start_agent(project_id, "dev-web", "web", session_id, 500_000, 2)

    assert DevAgentState.get(project_id, "dev-web").impl == "real"

    desliga(project_id, "dev-web")
    :ok = DevRehydrator.run()

    assert server_module(project_id, "dev-web") == DevAgentServer

    desliga(project_id, "dev-web")
  end

  test "reidratação preserva os tetos e NÃO redispara o ciclo :work", %{
    project_id: project_id,
    session_id: session_id
  } do
    {:ok, _pid, :started} =
      DevAgentSupervisor.start_agent(project_id, "dev-api", "api", session_id, 123_456, 7, :noop)

    desliga(project_id, "dev-api")
    :ok = DevRehydrator.run()

    row = DevAgentState.get(project_id, "dev-api")
    assert row.task_budget_micros == 123_456
    assert row.max_gate_corrections == 7

    # Um ciclo novo é decisão de quem reativa a execução — reidratar não pode
    # sair reivindicando task nem propondo ação.
    refute_received {:task_claimed, _, _}
    refute_received {:propose_action, _, _, _}

    desliga(project_id, "dev-api")
  end

  test "é idempotente: rodar duas vezes não duplica agente", %{
    project_id: project_id,
    session_id: session_id
  } do
    {:ok, _pid, :started} =
      DevAgentSupervisor.start_agent(project_id, "dev-api", "api", session_id, nil, nil, :noop)

    :ok = DevRehydrator.run()
    :ok = DevRehydrator.run()

    assert length(Registry.lookup(Engine.Dev.Registry, {project_id, "dev-api"})) == 1

    desliga(project_id, "dev-api")
  end
end
