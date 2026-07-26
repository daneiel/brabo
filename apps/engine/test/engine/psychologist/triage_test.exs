defmodule Engine.Psychologist.TriageTest do
  # Sem banco. `async: false` porque os tetos vêm de Application env
  # (config/runtime.exs) e um teste aqui sobrescreve o limiar.
  use ExUnit.Case, async: false

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

  test "tier leve manda menos evento pro prompt que o pesado" do
    assert Triage.max_prompt_events(:leve) < Triage.max_prompt_events(:pesada)
    assert Triage.max_payload_chars() > 0
  end

  test "limiar é knob de operador, não constante de código" do
    Application.put_env(:engine, :psychologist_triage_threshold, 2)
    on_exit(fn -> Application.delete_env(:engine, :psychologist_triage_threshold) end)

    assert Triage.threshold() == 2
    assert Triage.decide(1) == :leve
    assert Triage.decide(2) == :pesada
  end
end
