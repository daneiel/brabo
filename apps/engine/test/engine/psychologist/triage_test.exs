defmodule Engine.Psychologist.TriageTest do
  # Puro — sem banco, sem Application env.
  use ExUnit.Case, async: true

  alias Engine.Psychologist.Triage

  test "abaixo do limiar: triagem leve" do
    assert Triage.decide(0) == :leve
    assert Triage.decide(Triage.threshold() - 1) == :leve
  end

  test "no limiar (e acima): triagem pesada" do
    assert Triage.decide(Triage.threshold()) == :pesada
    assert Triage.decide(Triage.threshold() + 100) == :pesada
  end

  test "cada tier usa um slug de agente distinto (bindings de modelo diferentes)" do
    assert Triage.agent_for(:leve) == "psicologo-leve"
    assert Triage.agent_for(:pesada) == "psicologo"
  end

  test "tier leve tem tetos menores de iteração e orçamento (controle de custo)" do
    assert Triage.max_iterations(:leve) < Triage.max_iterations(:pesada)
    assert Triage.token_budget_micros(:leve) < Triage.token_budget_micros(:pesada)
  end
end
