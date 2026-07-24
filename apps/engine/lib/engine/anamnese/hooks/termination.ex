defmodule Engine.Anamnese.Hooks.Termination do
  @moduledoc """
  Hook `:post_tool_use` que termina o `ToolLoop` da Anamnese quando
  `emit_proficiency` teve sucesso — mesmo mecanismo de
  `Engine.Psychologist.Hooks.Termination`.

  `propose_instruction_patch` NÃO termina o loop de propósito: o patch é
  opcional e vem ANTES do perfil na mesma rodada (o modelo propõe o
  ajuste e só então fecha emitindo os perfis).
  """

  @behaviour Engine.Harness.Hooks

  @impl true
  def call(%{tool: "emit_proficiency", result_ok?: true, args: args}) do
    {:halt, {"emit_proficiency", %{count: length(Map.get(args, "profiles", []))}}}
  end

  def call(ctx), do: {:cont, ctx}
end
