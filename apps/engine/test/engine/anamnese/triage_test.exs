defmodule Engine.Anamnese.TriageTest do
  use ExUnit.Case, async: false

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

  test "decisões contam como material da janela" do
    # Uma janela em que o usuário só aprovou e negou ações É material — antes
    # das decisões entrarem no contexto, ela era descartada como vazia.
    refute Triage.should_run?(0, 0, 0)
    assert Triage.should_run?(0, 0, Triage.min_events())
    assert Triage.should_run?(Triage.min_events() - 1, 0, 1)
  end

  test "tetos e limiares são knobs de operador, não constantes" do
    Application.put_env(:engine, :anamnese_min_events, 3)
    Application.put_env(:engine, :anamnese_max_prompt_events, 7)

    on_exit(fn ->
      Application.delete_env(:engine, :anamnese_min_events)
      Application.delete_env(:engine, :anamnese_max_prompt_events)
    end)

    assert Triage.min_events() == 3
    assert Triage.max_prompt_events() == 7
    assert Triage.should_run?(3, 0)
    refute Triage.should_run?(2, 0)
  end

  test "teto de payload é positivo (protege a janela pinned)" do
    assert Triage.max_payload_chars() > 0
    assert Triage.initial_window_days() > 0
  end
end
