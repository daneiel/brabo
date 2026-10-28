defmodule Engine.Dev.RetomadaDoCommitTest do
  @moduledoc """
  AT-582 (ADR 0226): o dev `working` reidratado retoma do commit, 1x, se a queda
  é recente. Fora disso (2a queda, janela vencida, `awaiting_approval`) volta o
  bloqueio de sempre.
  """
  use Engine.DataCase, async: false

  alias Engine.Dev.{DevAgentServer, FakeWorktreeManager}
  alias Engine.Gates.FakeGateDispatcher
  alias Engine.Sessions.FakeEngineApiClient

  @task "task-abc12345"

  setup do
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :worktree_manager, FakeWorktreeManager)
    Application.put_env(:engine, :gate_dispatcher, FakeGateDispatcher)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      for k <- [:engine_api_client, :worktree_manager, :gate_dispatcher, :test_pid],
          do: Application.delete_env(:engine, k)
    end)

    project_id = Ecto.UUID.generate()
    container_running!(project_id)

    Process.put(:fake_dev_context, %{
      "task" => %{"id" => @task, "title" => "Cadastro", "description" => ""},
      "story" => %{
        "id" => "st-1",
        "title" => "Cadastro",
        "description" => "",
        "rf" => [],
        "rnf" => [],
        "dod" => [],
        "dor" => []
      },
      "businessRules" => [],
      "adrs" => []
    })

    Process.put(:fake_propose_action, %{"id" => "pa-git", "status" => "executed"})

    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("report_done", %{"summary" => "feito"})
    ])

    %{project_id: project_id, session_id: Ecto.UUID.generate()}
  end

  defp quando(segundos),
    do: DateTime.utc_now() |> DateTime.add(-segundos, :second) |> DateTime.to_iso8601()

  defp working(cause, segundos) do
    payload = %{"taskId" => @task, "agentId" => "dev-api"}
    payload = if cause, do: Map.put(payload, "cause", cause), else: payload

    %{
      "type" => "dev.working",
      "actor" => %{"kind" => "agent", "id" => "dev-api"},
      "payload" => payload,
      "createdAt" => quando(segundos)
    }
  end

  defp recuperar(ctx, status, eventos) do
    Process.put(:fake_events, eventos)

    resume = %{
      status: status,
      task_id: @task,
      worktree_path: "/tmp/wt",
      consecutive_blocked: 0
    }

    {:ok, st, {:continue, c}} =
      DevAgentServer.init(
        {ctx.project_id, "dev-api", "api", ctx.session_id, nil, nil, nil, resume}
      )

    DevAgentServer.handle_continue(c, st)
  end

  test "queda recente: preserva, readota a MESMA tarefa e segue sem bloquear", ctx do
    Process.put(:fake_preservar, {:ok, "0123456789abcdef"})
    assert {:noreply, _} = recuperar(ctx, "working", [working(nil, 60)])

    assert_received {:worktree_adopted, _, "dev-api", "task-task-abc"}
    assert_received {:event_appended, _, _, %{type: "dev.working", payload: p}}
    assert p.cause == "retomada"
    assert p.commit == "0123456789abcdef"
    # O laço da MESMA tarefa rodou de novo (o modelo scriptado chamou a ferramenta).
    assert_received {:event_appended, _, _, %{type: "tool.call", payload: %{tool: "report_done"}}}
    # Não bloqueou por causa do reinício (o fake não tem git real, então o
    # desfecho do laço em si não é o ponto aqui).
    refute_received {:task_blocked, _, "engine reiniciou durante a task", _, _}
  end

  test "2a queda (o dev.working anterior já é retomada): bloqueia", ctx do
    assert {:noreply, _} = recuperar(ctx, "working", [working("retomada", 60)])
    assert_received {:task_blocked, @task, "engine reiniciou durante a task", _, "dev-api"}
    refute_received {:worktree_adopted, _, _, _}
  end

  test "fora da janela: bloqueia", ctx do
    assert {:noreply, _} = recuperar(ctx, "working", [working(nil, 7200)])
    assert_received {:task_blocked, @task, "engine reiniciou durante a task", _, "dev-api"}
    refute_received {:worktree_adopted, _, _, _}
  end

  test "awaiting_approval continua bloqueando", ctx do
    assert {:noreply, _} = recuperar(ctx, "awaiting_approval", [working(nil, 60)])
    assert_received {:task_blocked, @task, motivo, _, "dev-api"}
    assert motivo =~ "esperava aprovação"
    refute_received {:worktree_adopted, _, _, _}
  end
end
