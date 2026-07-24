defmodule Engine.Harness.Hooks.EventLog do
  @moduledoc """
  Hook `:post_tool_use` que grava o RESULTADO da ferramenta no event log
  (item 4) — um `session_event` `"tool.result"` via
  `EngineApiClient.append_event/3`. Recebe o ctx já com `:result` e
  `:result_ok?`.
  """

  @behaviour Engine.Harness.Hooks

  alias Engine.Sessions.EngineApiClient

  @impl true
  def call(ctx) do
    event = %{
      type: "tool.result",
      actorKind: "agent",
      actorId: ctx.agent,
      payload: %{
        tool: ctx.tool,
        ok: Map.get(ctx, :result_ok?, true),
        result: truncate(Map.get(ctx, :result, ""))
      }
    }

    _ = EngineApiClient.append_event(ctx.project_id, ctx.session_id, event)
    {:cont, ctx}
  end

  # Resultado grande não precisa inteiro no event log.
  defp truncate(text) when is_binary(text) do
    if byte_size(text) > 2000, do: binary_part(text, 0, 2000) <> "…", else: text
  end

  defp truncate(other), do: inspect(other)
end
