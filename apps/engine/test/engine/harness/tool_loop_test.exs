defmodule Engine.Harness.ToolLoopTest do
  # DataCase — o ToolLoop monta o system prompt via o harness, que LÊ o banco
  # (projects/agent_instructions). async: false por causa do Application env
  # global (:engine_api_client, :test_pid, :project_workspaces_root).
  use Engine.DataCase, async: false

  alias Engine.Harness.ToolLoop
  alias Engine.Sessions.FakeEngineApiClient

  setup do
    root =
      Path.join(
        System.tmp_dir!(),
        "brabo-loop-test-#{System.os_time(:microsecond)}-#{System.unique_integer([:positive])}"
      )

    Application.put_env(:engine, :project_workspaces_root, root)
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      File.rm_rf!(root)
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :test_pid)
    end)

    %{
      ctx: %{
        project_id: Ecto.UUID.generate(),
        session_id: Ecto.UUID.generate(),
        agent: "echo",
        messages: [%{"role" => "user", "content" => "faça a tarefa", :pinned => true}],
        # janela grande: sem compactação interferindo nestes testes.
        context_window: 1_000_000
      }
    }
  end

  test "limite de iterações: modelo sempre pede tool → para com toolloop.limit_reached", %{
    ctx: ctx
  } do
    # Toda chamada de LLM pede a mesma ferramenta (direta) — o loop só para
    # pelo limite, nunca por resposta final.
    Process.put(
      :fake_llm_always,
      FakeEngineApiClient.tool_call_response("search_workspace", %{"query" => "x"})
    )

    assert {:limit_reached, _} = ToolLoop.run(Map.put(ctx, :max_iterations, 3))

    assert_received {:event_appended, _, _,
                     %{type: "toolloop.limit_reached", payload: %{iteration: 3}}}
  end

  test "caminho feliz: resposta final imediata, sem tool calls", %{ctx: ctx} do
    Process.put(:fake_llm_turns, [FakeEngineApiClient.final_response("tudo pronto")])

    assert {:ok, out} = ToolLoop.run(ctx)

    last = List.last(out.messages)
    assert last["role"] == "assistant"
    assert last["content"] == "tudo pronto"
    refute_received {:event_appended, _, _, %{type: "tool.call"}}
  end

  test "terminal via pipeline: cria proposed_action e injeta o resultado como tool message", %{
    ctx: ctx
  } do
    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("terminal", %{"command" => "echo oi"}),
      FakeEngineApiClient.final_response("feito")
    ])

    Process.put(:fake_propose_action, %{
      "id" => "pa-1",
      "status" => "executed",
      "executionResult" => %{"exitCode" => 0, "stdout" => "oi\n"}
    })

    assert {:ok, out} = ToolLoop.run(ctx)

    assert_received {:propose_action, "terminal", %{kind: "agent", id: "echo"},
                     %{command: "echo oi"}}

    # o resultado do terminal virou uma mensagem `tool` no histórico
    tool_msg = Enum.find(out.messages, &(&1["role"] == "tool"))
    assert tool_msg["content"] =~ "oi"
    # e foi narrado no event log
    assert_received {:event_appended, _, _, %{type: "tool.call", payload: %{tool: "terminal"}}}
    assert_received {:event_appended, _, _, %{type: "tool.result", payload: %{tool: "terminal"}}}
  end
end
