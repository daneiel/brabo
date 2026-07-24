defmodule Engine.Harness.ContextManager do
  @moduledoc """
  Contrato do gerenciador de contexto (Fase 3a). Quando o contexto passa de
  X% do limite do modelo, sumariza os turnos mais antigos via o binding
  "context-manager" (modelo barato), substitui-os por um resumo e emite
  `context.compacted` com tokens antes/depois. Itens PINNED nunca são
  compactados. Impl em `.Default`; trocável via
  `Application.get_env(:engine, :context_manager, ...)`.
  """

  @callback maybe_compact(ctx :: map()) :: {:ok, map()}

  def maybe_compact(ctx), do: impl().maybe_compact(ctx)

  defp impl,
    do: Application.get_env(:engine, :context_manager, Engine.Harness.ContextManager.Default)
end

defmodule Engine.Harness.ContextManager.Default do
  @moduledoc """
  Compactação: estima os tokens das mensagens; se acima de `threshold *
  janela do modelo` E houver mensagens não-pinned além das `keep_recent` mais
  recentes, sumariza as mais antigas não-pinned via `llm_turn` (agent
  "context-manager", modelo barato), substitui-as por uma mensagem de resumo,
  preserva as pinned + as recentes, e emite `context.compacted`
  (`tokensBefore`/`tokensAfter`). Determinístico dado o resumo do modelo.
  """

  @behaviour Engine.Harness.ContextManager

  alias Engine.Harness.Tokenizer
  alias Engine.Sessions.EngineApiClient

  @summarizer_agent "context-manager"

  @impl true
  def maybe_compact(ctx) do
    tokens = estimate(ctx.messages)
    limit = round(threshold(ctx) * window(ctx))
    {pinned, non_pinned} = Enum.split_with(ctx.messages, & &1[:pinned])
    keep = keep_recent(ctx)

    older = Enum.drop(non_pinned, -keep)
    recent = Enum.take(non_pinned, -keep)

    if tokens > limit and older != [] do
      compact(ctx, tokens, pinned, older, recent)
    else
      {:ok, ctx}
    end
  end

  defp compact(ctx, tokens_before, pinned, older, recent) do
    summary = summarize(ctx, older)

    summary_msg = %{
      "role" => "system",
      "content" => "Resumo da conversa anterior (compactado):\n#{summary}",
      :pinned => false
    }

    new_messages = pinned ++ [summary_msg] ++ recent
    tokens_after = estimate(new_messages)

    EngineApiClient.append_event(ctx.project_id, ctx.session_id, %{
      type: "context.compacted",
      actorKind: "agent",
      actorId: @summarizer_agent,
      payload: %{tokensBefore: tokens_before, tokensAfter: tokens_after}
    })

    {:ok, %{ctx | messages: new_messages}}
  end

  defp summarize(ctx, older) do
    body =
      Enum.map_join(older, "\n\n", fn m ->
        "#{Map.get(m, "role", "?")}: #{Map.get(m, "content", "")}"
      end)

    prompt = "Resuma concisamente os turnos abaixo, preservando decisões e fatos:\n\n#{body}"
    messages = [%{"role" => "user", "content" => prompt}]

    case EngineApiClient.llm_turn(ctx.project_id, ctx.session_id, @summarizer_agent, messages, []) do
      {:ok, %{"message" => %{"content" => content}}} when is_binary(content) and content != "" ->
        content

      _ ->
        # Fallback determinístico se o sumarizador falhar: nunca perde o fio
        # (mantém um resumo textual mínimo em vez de descartar tudo).
        "(#{length(older)} turnos anteriores omitidos)"
    end
  end

  defp estimate(messages) do
    messages
    |> Enum.map(fn m -> Tokenizer.estimate(Map.get(m, "content", "")) end)
    |> Enum.sum()
  end

  defp threshold(ctx),
    do:
      Map.get(ctx, :compaction_threshold) ||
        Application.get_env(:engine, :context_compaction_threshold, 0.7)

  defp window(ctx),
    do:
      Map.get(ctx, :context_window) || Application.get_env(:engine, :default_context_window, 8192)

  defp keep_recent(ctx),
    do: Map.get(ctx, :compaction_keep_recent, 2)
end
