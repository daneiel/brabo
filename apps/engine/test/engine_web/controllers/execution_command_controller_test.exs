defmodule EngineWeb.ExecutionCommandControllerTest do
  # async: false — mexe nos processos globais (DevAgentSupervisor, Monitor) e
  # precisa do sandbox compartilhado, já que os agentes rodam em processos
  # próprios. As actions são chamadas DIRETO (sem passar pelo router): o que
  # está sob teste é a decisão do controller, não o pipeline de auth.
  use EngineWeb.ConnCase, async: false

  alias Engine.Dev.{DevAgentState, DevAgentSupervisor, FakeWorktreeManager}
  alias Engine.Sessions.FakeEngineApiClient
  alias EngineWeb.ExecutionCommandController

  setup do
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :worktree_manager, FakeWorktreeManager)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :worktree_manager)
      Application.delete_env(:engine, :test_pid)
    end)

    %{project_id: Ecto.UUID.generate(), session_id: Ecto.UUID.generate()}
  end

  test "parallelize herda os tetos do agente base do módulo", %{
    conn: conn,
    project_id: project_id,
    session_id: session_id
  } do
    # O aceite de um clique não pode criar um agente sem teto: a guarda de
    # orçamento do ToolLoop é `when is_integer(budget)`, então nil = ilimitado.
    {:ok, _pid, :started} =
      DevAgentSupervisor.start_agent(project_id, "dev-api", "api", session_id, 123_456, 1)

    conn =
      ExecutionCommandController.parallelize(conn, %{
        "sessionId" => session_id,
        "projectId" => project_id,
        "module" => "api"
      })

    assert conn.status == 202

    extra = DevAgentState.get(project_id, "dev-api-2")
    assert extra, "o subagente extra não subiu"
    assert extra.task_budget_micros == 123_456
    assert extra.max_gate_corrections == 1
  end

  test "parallelize sem agente base: 409 e nenhum agente criado", %{
    conn: conn,
    project_id: project_id,
    session_id: session_id
  } do
    conn =
      ExecutionCommandController.parallelize(conn, %{
        "sessionId" => session_id,
        "projectId" => project_id,
        "module" => "web"
      })

    assert conn.status == 409
    refute DevAgentState.get(project_id, "dev-web-2")
  end
end
