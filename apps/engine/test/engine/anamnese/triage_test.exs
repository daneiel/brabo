defmodule Engine.Anamnese.TriageTest do
  use ExUnit.Case, async: true

  alias Engine.Anamnese.Triage

  test "sem hipótese na fila, exige o mínimo de eventos" do
    refute Triage.should_run?(Triage.min_events() - 1, 0)
    assert Triage.should_run?(Triage.min_events(), 0)
  end

  test "hipótese aceita na fila SEMPRE força a rodada, mesmo sem eventos" do
    # Se não forçasse, o loop fechado do Psicólogo nunca completaria numa
    # janela silenciosa.
    assert Triage.should_run?(0, 1)
  end

  test "tetos de custo são positivos e o agente tem slug próprio" do
    assert Triage.agent() == "anamnese"
    assert Triage.max_iterations() > 0
    assert Triage.token_budget_micros() > 0
  end
end
