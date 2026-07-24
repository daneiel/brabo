defmodule Engine.Dev.Hooks.Termination do
  @moduledoc """
  Hook `:post_tool_use` que termina o `ToolLoop` quando o DevAgent sinaliza
  conclusão (`report_done`) ou bloqueio (`report_blocked`) com sucesso —
  reaproveita o halt de `Engine.Harness.Hooks` (o `ToolLoop.Default` propaga
  como `{:halted, reason, ctx}`, ver `tool_loop.ex`). Falha do tool
  (`result_ok? == false` — ex.: `report_done` sem suite verde) NÃO termina; o
  loop continua e o modelo tenta de novo.
  """

  @behaviour Engine.Harness.Hooks

  @impl true
  def call(%{tool: "report_done", result_ok?: true, args: args}) do
    {:halt, {"report_done", %{summary: Map.get(args, "summary", "")}}}
  end

  def call(%{tool: "report_blocked", result_ok?: true, args: args}) do
    {:halt,
     {"report_blocked",
      %{reason: Map.get(args, "reason", ""), diagnosis: Map.get(args, "diagnosis", "")}}}
  end

  def call(ctx), do: {:cont, ctx}
end
