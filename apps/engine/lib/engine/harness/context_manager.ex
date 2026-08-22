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
  Compactação: estima os tokens das mensagens (`content` + os `toolCalls` de
  mensagens `assistant`, serializados — os argumentos de tool call ocupam
  bytes reais no corpo HTTP e ficavam invisíveis à estimativa antiga); se
  acima de `threshold * janela efetiva` E houver mensagens não-pinned além
  das `keep_recent` iterações mais recentes, sumariza as mais antigas
  não-pinned via `llm_turn` (agent "context-manager", modelo barato),
  substitui-as por uma mensagem de resumo, preserva as pinned + as recentes,
  e emite `context.compacted` (`tokensBefore`/`tokensAfter`). Determinístico
  dado o resumo do modelo.

  A janela EFETIVA é `min(context_window, teto_de_transporte)` — ver
  `window/1`. O corte em `older`/`recent` acontece por FRONTEIRA DE ITERAÇÃO
  do ToolLoop (`group_by_iteration/1`), nunca por mensagem crua: uma mensagem
  `assistant` com `toolCalls` e os `role: "tool"` que a respondem viajam
  juntos para o mesmo lado do corte, ou o protocolo de tool-use do provider
  quebra (mensagem de resultado sem a chamada correspondente no histórico).
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

    groups = group_by_iteration(non_pinned)
    older = groups |> Enum.drop(-keep) |> List.flatten()
    recent = groups |> Enum.take(-keep) |> List.flatten()

    if tokens > limit and older != [] do
      compact(ctx, tokens, pinned, older, recent)
    else
      {:ok, ctx}
    end
  end

  # Agrupa mensagens não-pinned em iterações do ToolLoop: uma mensagem
  # `assistant` com `toolCalls` "puxa" para o mesmo grupo todo `role: "tool"`
  # que vem logo em seguida (o resultado de CADA tool call daquela iteração —
  # `ToolLoop.Default` anexa um por vez, na ordem de despacho, antes de
  # recursar para a próxima iteração). Mensagem sem toolCalls (ou tool "solto",
  # sem assistant precedente no grupo corrente) forma grupo de 1 — mesmo
  # comportamento de antes, mensagem a mensagem.
  defp group_by_iteration(messages) do
    Enum.chunk_while(
      messages,
      [],
      fn msg, acc ->
        cond do
          acc == [] ->
            {:cont, [msg]}

          Map.get(msg, "role") == "tool" and assistant_with_tool_calls?(hd(acc)) ->
            {:cont, acc ++ [msg]}

          true ->
            {:cont, acc, [msg]}
        end
      end,
      fn
        [] -> {:cont, []}
        acc -> {:cont, acc, []}
      end
    )
  end

  defp assistant_with_tool_calls?(%{"role" => "assistant"} = msg) do
    case Map.get(msg, "toolCalls") do
      list when is_list(list) and list != [] -> true
      _ -> false
    end
  end

  defp assistant_with_tool_calls?(_), do: false

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

  # Conta `content` de TODA mensagem (inclui `role: "tool"`, cujo resultado
  # já viajava por este campo) MAIS a serialização JSON de `toolCalls` de
  # mensagens `assistant` — os argumentos de uma tool call são bytes reais no
  # corpo HTTP de `POST .../llm-turn` e antes ficavam de fora: uma mensagem
  # só de tool calls tem `content` vazio e passava pela estimativa como se
  # não custasse nada.
  defp estimate(messages) do
    messages
    |> Enum.map(fn m ->
      Tokenizer.estimate(Map.get(m, "content", "")) + Tokenizer.estimate(tool_calls_json(m))
    end)
    |> Enum.sum()
  end

  defp tool_calls_json(msg) do
    if assistant_with_tool_calls?(msg) do
      case Jason.encode(Map.get(msg, "toolCalls")) do
        {:ok, json} -> json
        {:error, _} -> ""
      end
    else
      ""
    end
  end

  defp threshold(ctx),
    do:
      Map.get(ctx, :compaction_threshold) ||
        Application.get_env(:engine, :context_compaction_threshold, 0.7)

  # Janela EFETIVA de compactação: a menor entre a janela do MODELO
  # (`context_window`, o que os agentes de gate/dev declaram como 128_000 —
  # descreve o modelo, não muda aqui) e o teto de TRANSPORTE
  # (`transport_window_tokens/0`, derivado do limite de bytes do corpo HTTP
  # da api). Usar só a janela do modelo compactava tarde demais: 70% de 128k
  # tokens é ~350 KB de payload estimado, bem depois do limite de transporte
  # real (confirmado: 413 muito antes disso). A compactação deve disparar
  # ANTES do corpo estourar o limite HTTP, não antes do modelo "esquecer".
  defp window(ctx) do
    model_window =
      Map.get(ctx, :context_window) ||
        Application.get_env(:engine, :default_context_window, 8192)

    min(model_window, transport_window_tokens())
  end

  # Teto de transporte convertido de bytes pra tokens pela MESMA heurística
  # do tokenizer aproximado (`Engine.Harness.Tokenizer.bytes_per_token/0`) —
  # a constante mora só lá, não duplicada aqui.
  defp transport_window_tokens do
    max_bytes = Application.get_env(:engine, :transport_max_body_bytes, 8_388_608)
    div(max_bytes, Tokenizer.bytes_per_token())
  end

  defp keep_recent(ctx),
    do: Map.get(ctx, :compaction_keep_recent, 2)
end
