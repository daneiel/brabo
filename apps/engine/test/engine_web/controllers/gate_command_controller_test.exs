defmodule EngineWeb.GateCommandControllerTest do
  # RN-724 (ADR 0207): a rota interna que retoma o ciclo estacionado. A action
  # é chamada DIRETO — o pipeline de auth é `VerifyServiceToken`, testado à parte.
  use EngineWeb.ConnCase, async: false

  alias Engine.Gates.{FakeGateDispatcher, GateState}
  alias EngineWeb.GateCommandController

  setup do
    Application.put_env(:engine, :gate_dispatcher, FakeGateDispatcher)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      Application.delete_env(:engine, :gate_dispatcher)
      Application.delete_env(:engine, :test_pid)
    end)

    project_id = Ecto.UUID.generate()
    task_id = "task-#{Ecto.UUID.generate()}"

    GateState.upsert!(%{
      project_id: project_id,
      task_id: task_id,
      gate: "qa",
      session_id: Ecto.UUID.generate(),
      step: "in_progress"
    })

    %{project_id: project_id, task_id: task_id}
  end

  defp params(project_id, task_id, gate),
    do: %{"projectId" => project_id, "taskId" => task_id, "gate" => gate}

  test "ciclo estacionado: 202 e despacha o gate de novo", %{
    conn: conn,
    project_id: project_id,
    task_id: task_id
  } do
    :ok = GateState.park!(project_id, task_id, "qa")

    conn = GateCommandController.resume(conn, params(project_id, task_id, "qa"))

    assert conn.status == 202
    assert_received {:gate_dispatch, :qa, ^project_id, ^task_id}
  end

  test "ciclo NÃO estacionado: 409 nomeado e nada despachado", %{
    conn: conn,
    project_id: project_id,
    task_id: task_id
  } do
    conn = GateCommandController.resume(conn, params(project_id, task_id, "qa"))

    assert %{"error" => "gate_nao_estacionado"} = json_response(conn, 409)
    refute_received {:gate_dispatch, _, _, _}
  end

  test "gate desconhecido: 409 nomeado", %{conn: conn, project_id: project_id, task_id: task_id} do
    conn = GateCommandController.resume(conn, params(project_id, task_id, "deploy"))
    assert %{"error" => "gate_nao_estacionado"} = json_response(conn, 409)
  end
end
