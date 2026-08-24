defmodule Engine.Harness.ContextManagerTest do
  # async: false — Application env global (:engine_api_client, :test_pid).
  use ExUnit.Case, async: false

  alias Engine.Harness.ContextManager
  alias Engine.Sessions.FakeEngineApiClient

  setup do
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :test_pid)
    end)

    :ok
  end

  defp msg(role, content, pinned), do: %{"role" => role, "content" => content, :pinned => pinned}

  test "compacta os turnos antigos, PRESERVA os pinned e emite context.compacted" do
    long = String.duplicate("conteúdo antigo e verboso ", 20)

    messages = [
      msg("system", "PROMPT DO SISTEMA", true),
      msg("user", "TAREFA IMPORTANTE", true),
      msg("assistant", long <> " resposta1", false),
      msg("tool", long <> " resultado1", false),
      msg("assistant", "resposta recente", false)
    ]

    # Fake do sumarizador retorna "RESUMO".
    Process.put(:fake_llm_turns, [FakeEngineApiClient.final_response("RESUMO")])

    ctx = %{
      project_id: "proj-1",
      session_id: "sess-1",
      agent: "echo",
      messages: messages,
      # janela minúscula pra forçar a compactação; mantém 1 turno recente.
      context_window: 1,
      compaction_keep_recent: 1
    }

    assert {:ok, out} = ContextManager.maybe_compact(ctx)

    contents = Enum.map(out.messages, &Map.get(&1, "content"))

    # pinned preservados
    assert "PROMPT DO SISTEMA" in contents
    assert "TAREFA IMPORTANTE" in contents
    # turno recente preservado
    assert "resposta recente" in contents
    # antigos compactados (sumarizados) — não estão mais no contexto
    refute Enum.any?(contents, &(&1 =~ "resposta1"))
    refute Enum.any?(contents, &(&1 =~ "resultado1"))
    # o resumo entrou
    assert Enum.any?(contents, &(&1 =~ "RESUMO"))

    # emitiu context.compacted com economia de tokens
    assert_received {:event_appended, _, _,
                     %{
                       type: "context.compacted",
                       payload: %{tokensBefore: before_tokens, tokensAfter: after_tokens}
                     }}

    assert before_tokens > after_tokens
  end

  test "sem estouro de janela: não compacta, contexto intacto" do
    messages = [msg("system", "P", true), msg("assistant", "curto", false)]

    ctx = %{
      project_id: "proj-1",
      session_id: "sess-1",
      agent: "echo",
      messages: messages,
      context_window: 100_000
    }

    assert {:ok, out} = ContextManager.maybe_compact(ctx)
    assert out.messages == messages
    refute_received {:event_appended, _, _, %{type: "context.compacted"}}
  end

  defp tool_call_msg(id, args),
    do: %{
      "role" => "assistant",
      "content" => "",
      "toolCalls" => [%{"id" => id, "name" => "read_file", "arguments" => args}],
      :pinned => false
    }

  defp tool_result_msg(id, content),
    do: %{
      "role" => "tool",
      "content" => content,
      "toolCallId" => id,
      "name" => "read_file",
      :pinned => false
    }

  test "toolCalls pesados nos argumentos entram na estimativa e disparam compactação" do
    # `content` vazio nas mensagens assistant: antes da correção, `estimate/1`
    # só somava `content` e este histórico daria 0 tokens — a compactação
    # NUNCA disparava, não importa quão grande o argumento da tool call fosse.
    heavy_args = %{"path" => String.duplicate("x", 2_000)}

    messages = [
      msg("system", "PROMPT DO SISTEMA", true),
      tool_call_msg("tc-1", heavy_args),
      tool_result_msg("tc-1", "conteúdo lido 1"),
      tool_call_msg("tc-2", heavy_args),
      tool_result_msg("tc-2", "conteúdo lido 2"),
      msg("assistant", "resposta final recente", false)
    ]

    Process.put(:fake_llm_turns, [FakeEngineApiClient.final_response("RESUMO")])

    ctx = %{
      project_id: "proj-1",
      session_id: "sess-1",
      agent: "echo",
      messages: messages,
      # Pequena o bastante pra só o CONTENT (curto) nunca estourar sozinho —
      # só dispara se os toolCalls pesados também forem contados.
      context_window: 300,
      compaction_keep_recent: 1
    }

    assert {:ok, out} = ContextManager.maybe_compact(ctx)

    contents = Enum.map(out.messages, &Map.get(&1, "content"))
    assert "PROMPT DO SISTEMA" in contents
    assert "resposta final recente" in contents
    assert Enum.any?(contents, &(&1 =~ "RESUMO"))

    assert_received {:event_appended, _, _,
                     %{type: "context.compacted", payload: %{tokensBefore: before_tokens}}}

    # ~2.000 bytes de argumento por tool call, duas vezes: se `toolCalls`
    # não fosse contado, `before_tokens` ficaria na casa de dezenas (só o
    # `content` curto das mensagens).
    assert before_tokens > 500
  end

  test "não orfana tool result: o corte respeita a fronteira de iteração do ToolLoop" do
    messages = [
      msg("system", "PROMPT", true),
      msg("assistant", "turno antigo, simples " <> String.duplicate("x", 500), false),
      %{
        "role" => "assistant",
        "content" => "",
        "toolCalls" => [
          %{"id" => "tc-1", "name" => "read_file", "arguments" => %{"path" => "a.ex"}},
          %{"id" => "tc-2", "name" => "read_file", "arguments" => %{"path" => "b.ex"}}
        ],
        :pinned => false
      },
      tool_result_msg("tc-1", "conteúdo a"),
      tool_result_msg("tc-2", "conteúdo b")
    ]

    Process.put(:fake_llm_turns, [FakeEngineApiClient.final_response("RESUMO")])

    ctx = %{
      project_id: "proj-1",
      session_id: "sess-1",
      agent: "echo",
      messages: messages,
      # janela minúscula: força a compactação a cortar em algum lugar.
      context_window: 1,
      # keep_recent agora conta ITERAÇÕES (grupos), não mensagens cruas — 1
      # grupo mantido é exatamente o par assistant(toolCalls) + os 2 tool
      # results da última iteração.
      compaction_keep_recent: 1
    }

    assert {:ok, out} = ContextManager.maybe_compact(ctx)

    kept_tool_call_ids =
      out.messages
      |> Enum.filter(&(Map.get(&1, "role") == "assistant"))
      |> Enum.flat_map(&Map.get(&1, "toolCalls", []))
      |> Enum.map(&Map.get(&1, "id"))

    kept_tool_result_ids =
      out.messages
      |> Enum.filter(&(Map.get(&1, "role") == "tool"))
      |> Enum.map(&Map.get(&1, "toolCallId"))

    # nenhum `role: "tool"` sobrevivente ficou sem a mensagem assistant que o
    # chamou — se tivesse cortado no meio da iteração, "tc-1"/"tc-2" apareceriam
    # aqui sem correspondência em `kept_tool_call_ids`.
    assert kept_tool_result_ids != []
    assert Enum.all?(kept_tool_result_ids, &(&1 in kept_tool_call_ids))
    # o par inteiro (as duas tool calls + os dois results) sobreviveu junto,
    # não metade dele.
    assert length(kept_tool_result_ids) == 2
  end

  test "pinned sobrevivem intactos mesmo com toolCalls pesados estourando o threshold" do
    heavy_args = %{"payload" => String.duplicate("y", 5_000)}

    messages = [
      msg("system", "REGRA FIXA 1", true),
      msg("user", "REGRA FIXA 2", true),
      tool_call_msg("tc-1", heavy_args),
      tool_result_msg("tc-1", "resultado antigo"),
      msg("assistant", "resposta recente", false)
    ]

    Process.put(:fake_llm_turns, [FakeEngineApiClient.final_response("RESUMO")])

    ctx = %{
      project_id: "proj-1",
      session_id: "sess-1",
      agent: "echo",
      messages: messages,
      context_window: 10,
      compaction_keep_recent: 1
    }

    assert {:ok, out} = ContextManager.maybe_compact(ctx)
    contents = Enum.map(out.messages, &Map.get(&1, "content"))

    assert "REGRA FIXA 1" in contents
    assert "REGRA FIXA 2" in contents

    pinned_out = Enum.filter(out.messages, & &1[:pinned])
    assert length(pinned_out) == 2
  end

  test "teto de TRANSPORTE força compactação mesmo com janela do modelo folgada" do
    # ~10 tokens (40 bytes / 4 bytes-por-token) — bem abaixo do que o
    # histórico abaixo pesa, mesmo a janela do MODELO sendo enorme.
    Application.put_env(:engine, :transport_max_body_bytes, 40)
    on_exit(fn -> Application.delete_env(:engine, :transport_max_body_bytes) end)

    messages = [
      msg("system", "P", true),
      msg("assistant", String.duplicate("conteúdo antigo e grande ", 20), false),
      msg("assistant", "recente", false)
    ]

    Process.put(:fake_llm_turns, [FakeEngineApiClient.final_response("RESUMO")])

    ctx = %{
      project_id: "proj-1",
      session_id: "sess-1",
      agent: "echo",
      messages: messages,
      # janela do MODELO gigante — sozinha, não dispararia compactação.
      context_window: 1_000_000,
      compaction_keep_recent: 1
    }

    assert {:ok, out} = ContextManager.maybe_compact(ctx)
    contents = Enum.map(out.messages, &Map.get(&1, "content"))
    assert Enum.any?(contents, &(&1 =~ "RESUMO"))
  end
end
