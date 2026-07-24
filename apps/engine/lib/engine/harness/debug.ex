defmodule Engine.Harness.Debug do
  @moduledoc """
  Ponto de entrada de debug do harness (critério de aceite da Fase 3a): dado
  projeto + agente, monta o prompt e imprime, com anotação por camada e a
  contagem de tokens (estimada) de cada uma. Função pura de conveniência
  chamável do IEx (`iex -S mix`), no espírito de `Engine.Outbox.Drain.run_once/0`
  — sem Mix.Task (não há precedente no engine).
  """

  alias Engine.Harness.ContextBuilder
  alias Engine.Harness.PromptAssembler

  @doc """
  Monta e retorna o relatório do assembler pra (projeto, agente) — usado pelos
  testes e pelo `print/2`.
  """
  def assemble(project_id, agent) do
    project_id
    |> ContextBuilder.build_layers(agent)
    |> PromptAssembler.assemble()
  end

  @doc """
  Imprime o prompt montado com anotação de camada e tokens por camada.
  Retorna `:ok`.
  """
  def print(project_id, agent) do
    report = assemble(project_id, agent)

    IO.puts("=== prompt de #{agent} @ projeto #{project_id} ===")

    Enum.each(report.layers, fn layer ->
      IO.puts("")

      IO.puts(
        "== [#{layer.id}] #{layer.tokens} tokens (est) / budget #{layer.budget}" <>
          " — #{cut_label(layer)} =="
      )

      if layer.rendered == "" do
        IO.puts("(vazio)")
      else
        IO.puts(layer.rendered)
      end
    end)

    IO.puts("")
    IO.puts("=== total: #{report.total_tokens} tokens (estimado) ===")
    :ok
  end

  defp cut_label(%{cut_applied: :none}), do: "sem corte"

  defp cut_label(%{cut_applied: :dropped_units, dropped: dropped}),
    do: "descartou #{length(dropped)} unidade(s)"

  defp cut_label(%{cut_applied: :truncated}), do: "truncado"
  defp cut_label(%{cut_applied: :dropped_layer}), do: "camada descartada"
end
