defmodule Engine.Gates.Hooks.Termination do
  @moduledoc """
  Hook `:post_tool_use` que termina o `ToolLoop` do QAAgent quando
  `emit_qa_verdict` teve sucesso — mesmo mecanismo de
  `Engine.Dev.Hooks.Termination` (halt propagado pelo `ToolLoop.Default`).
  """

  @behaviour Engine.Harness.Hooks

  @impl true
  def call(%{tool: "emit_qa_verdict", result_ok?: true, args: args}) do
    {:halt,
     {"emit_qa_verdict",
      %{
        veredito: Map.get(args, "veredito"),
        resumo: Map.get(args, "resumo", ""),
        itens: Map.get(args, "itens", []),
        coverage_matrix: Map.get(args, "coverageMatrix", [])
      }}}
  end

  def call(ctx), do: {:cont, ctx}
end
