defmodule Engine.Psychologist.TerminationClassifierTest do
  # Puro — classificação determinística, sem LLM (ADR 0013/0015).
  use ExUnit.Case, async: true

  alias Engine.Psychologist.TerminationClassifier, as: Classifier

  test "fecho gracioso (sem motivo reportado) é :normal" do
    assert Classifier.classify(nil, "closed") == :normal
  end

  test "heartbeat_timeout é :timeout mesmo fechando como closed" do
    # É o caso que o Monitor produz de verdade: `{"heartbeat_timeout",
    # "closed"}`. Classificar pelo STATUS fazia isso virar :normal, e a
    # causa :timeout — nomeada no enunciado ao lado de crash e kill — era
    # inalcançável em produção.
    assert Classifier.classify("heartbeat_timeout", "closed") == :timeout
    assert Classifier.classify("heartbeat_timeout", "closed_abnormally") == :timeout
  end

  test "kill (qualquer caixa) vira :kill" do
    assert Classifier.classify("killed", "closed_abnormally") == :kill
    assert Classifier.classify("Killed by operator", "closed_abnormally") == :kill
  end

  test "qualquer outra mensagem de erro vira :crash" do
    assert Classifier.classify("** (RuntimeError) boom", "closed_abnormally") == :crash
  end

  test "parada inesperada sem causa identificada vira :unknown" do
    # Monitor manda `{"normal", "closed_abnormally"}` quando o processo sai
    # limpo mas a api não esperava a parada: anormal, sem causa concreta.
    assert Classifier.classify("normal", "closed_abnormally") == :unknown
    assert Classifier.classify(nil, "closed_abnormally") == :unknown
  end

  test "motivo qualquer com status closed continua :normal" do
    assert Classifier.classify("normal", "closed") == :normal
  end

  test "abnormal?/1 é o que decide se a seção de término é exigida" do
    refute Classifier.abnormal?(:normal)

    for cause <- [:timeout, :kill, :crash, :unknown] do
      assert Classifier.abnormal?(cause)
    end
  end

  test "todas as causas têm rótulo pt-BR" do
    for cause <- [:normal, :timeout, :kill, :crash, :unknown] do
      assert is_binary(Classifier.label(cause))
    end
  end
end
