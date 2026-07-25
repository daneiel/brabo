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

  test "hook :post_tool_use pode terminar o loop com {:halt, reason} (Fase 4a)", %{ctx: ctx} do
    Process.put(
      :fake_llm_always,
      FakeEngineApiClient.tool_call_response("search_workspace", %{"query" => "x"})
    )

    hooks =
      Engine.Harness.Hooks.new()
      |> Engine.Harness.Hooks.register(:pre_tool_use, Engine.Harness.Hooks.ActionPipeline)
      |> Engine.Harness.Hooks.register(:post_tool_use, fn ctx ->
        if ctx.tool == "search_workspace", do: {:halt, :done_by_test}, else: {:cont, ctx}
      end)

    assert {:halted, :done_by_test, _out} = ToolLoop.run(Map.put(ctx, :hooks, hooks))

    # só rodou UM turno — o halt parou o loop antes de chamar llm_turn de novo.
    assert_received {:llm_turn, "echo", _, _}
    refute_received {:llm_turn, "echo", _, _}
  end

  test "teto de tokens: orçamento estourado para o loop sem chamar llm_turn de novo (Fase 4a)", %{
    ctx: ctx
  } do
    expensive =
      "search_workspace"
      |> FakeEngineApiClient.tool_call_response(%{"query" => "x"})
      |> put_in(["usage", "costMicros"], 1_000)

    Process.put(:fake_llm_always, expensive)

    ctx = Map.put(ctx, :token_budget_micros, 100)

    assert {:budget_exceeded, out} = ToolLoop.run(ctx)
    assert out.tokens_spent_micros >= 100

    assert_received {:llm_turn, "echo", _, _}
    refute_received {:llm_turn, "echo", _, _}

    assert_received {:event_appended, _, _,
                     %{type: "toolloop.budget_exceeded", payload: %{tokens_spent_micros: 1_000}}}
  end

  test "registry de tools customizado (ctx.tools) é respeitado (Fase 4a)", %{ctx: ctx} do
    # Registro só com search_workspace — read_file não existe nesse escopo.
    custom_tools = [Engine.Harness.Tools.SearchWorkspace]

    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("read_file", %{"path" => "x"}),
      FakeEngineApiClient.final_response("pronto")
    ])

    ctx = Map.put(ctx, :tools, custom_tools)

    assert {:ok, out} = ToolLoop.run(ctx)

    # a lista de tool_specs mandada pro modelo só tinha search_workspace.
    assert_received {:llm_turn, "echo", _, tool_specs}
    assert Enum.map(tool_specs, & &1.name) == ["search_workspace"]

    # read_file não está no registry custom -> "ferramenta desconhecida".
    tool_msg = Enum.find(out.messages, &(&1["role"] == "tool"))
    assert tool_msg["content"] =~ "ferramenta desconhecida: read_file"
  end

  test "falha do provider NO CORPO da resposta vira ctx.last_error", %{ctx: ctx} do
    # A api devolve 200 com `error` no corpo quando o provider morre; só o
    # transporte quebrado vira {:error, _}. Sem registrar este caso, quem
    # consome o {:ok, ctx} diagnostica "o modelo parou sem sinalizar" pra uma
    # falha de infraestrutura — foi exatamente o que um gate de QA reportou
    # errado numa execução real do critério de aceite (ADR 0020).
    Process.put(:fake_llm_turns, [
      %{
        "message" => %{"role" => "assistant", "content" => ""},
        "error" => "Falha ao conectar no Ollama: fetch failed"
      }
    ])

    assert {:ok, out} = ToolLoop.run(ctx)
    assert out.last_error =~ "Falha ao conectar no Ollama"
  end

  test "resposta sem erro não inventa last_error", %{ctx: ctx} do
    Process.put(:fake_llm_turns, [FakeEngineApiClient.final_response("tudo pronto")])

    assert {:ok, out} = ToolLoop.run(ctx)
    refute Map.has_key?(out, :last_error)
  end
end
