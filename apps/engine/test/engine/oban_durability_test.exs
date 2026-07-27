defmodule Engine.ObanDurabilityTest do
  # Puro — inspeciona a config do Oban.
  use ExUnit.Case, async: true

  @moduledoc """
  O critério de aceite da Fase 4b pede "kill do engine gerando análise
  pós-restart". Com o `Oban.Engines.Basic`, um job SIGKILLado enquanto
  estava `executing` NÃO volta sozinho: o nó morreu sem marcar desfecho,
  a linha fica órfã em `executing`, e o `max_attempts` do worker nunca é
  exercido. Quem resgata órfão é o `Oban.Plugins.Lifeline`.

  Este teste guarda a config porque a ausência do plugin é invisível na
  suite: todo teste de worker chama `perform/1` direto, então o cenário
  de orfandade só aparece rodando o engine de verdade.
  """

  test "Lifeline está configurado — sem ele job órfão nunca é resgatado" do
    plugins = Application.get_env(:engine, Oban)[:plugins]

    assert Enum.any?(plugins, fn
             {Oban.Plugins.Lifeline, _opts} -> true
             Oban.Plugins.Lifeline -> true
             _ -> false
           end),
           "Oban sem Oban.Plugins.Lifeline: job morto em `executing` fica órfão " <>
             "para sempre e a análise pós-restart nunca acontece"
  end

  test "PsychologistWorker tem max_attempts > 1 (a retentativa precisa existir)" do
    assert Engine.Workers.PsychologistWorker.__opts__()[:max_attempts] > 1
  end
end
