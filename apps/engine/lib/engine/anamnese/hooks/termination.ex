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

  # A saída HONESTA: sem membro elegível, sem evidência, nada de novo. Encerra
  # a rodada como desfecho legítimo — antes disso a Anamnese não tinha verbo
  # para dizer "não há o que emitir" e insistia em `emit_proficiency` com lista
  # vazia até o teto de iterações, gastando por rodada, a cada tick.
  def call(%{tool: "skip_proficiency", result_ok?: true, args: args}) do
    {:halt, {"skip_proficiency", Map.get(args, "motivo", "sem motivo declarado")}}
  end

  def call(ctx), do: {:cont, ctx}
end
