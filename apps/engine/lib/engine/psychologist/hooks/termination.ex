defmodule Engine.Psychologist.Hooks.Termination do
  @moduledoc """
  Hook `:post_tool_use` que termina o `ToolLoop` do Psicólogo quando
  `emit_hypotheses` teve sucesso — mesmo mecanismo de
  `Engine.Gates.Hooks.Termination`/`Engine.Dev.Hooks.Termination`
  (halt propagado pelo `ToolLoop.Default`).

  Dois estágios de propósito: a TOOL valida (rejeita com `{:error, ...}`,
  que vira o próximo tool-result pro modelo corrigir) e o HOOK termina
  (só quando a validação passou).
  """

  @behaviour Engine.Harness.Hooks

  @impl true
  def call(%{tool: "emit_hypotheses", result_ok?: true, args: args}) do
    {:halt, {"emit_hypotheses", %{count: length(Map.get(args, "hypotheses", []))}}}
  end

  def call(ctx), do: {:cont, ctx}
end
