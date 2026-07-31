defmodule Engine.Infra.Hooks.Termination do
  @moduledoc """
  Hook `:post_tool_use` que termina o `ToolLoop` do `WorkflowsAgent` (Fase
  8c) quando `emit_infra_delegation_result` teve sucesso — mesmo mecanismo
  de `Engine.Gates.Hooks.Termination`. O halt carrega `files`/`summary` dos
  argumentos da tool call.
  """

  @behaviour Engine.Harness.Hooks

  @impl true
  def call(%{tool: "emit_infra_delegation_result", result_ok?: true, args: args}) do
    {:halt,
     {"emit_infra_delegation_result",
      %{
        files: Map.get(args, "files", []),
        summary: Map.get(args, "summary", "")
      }}}
  end

  def call(ctx), do: {:cont, ctx}
end
