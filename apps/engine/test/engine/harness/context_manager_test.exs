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
end
