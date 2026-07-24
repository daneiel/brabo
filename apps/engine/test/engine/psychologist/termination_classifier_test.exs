defmodule Engine.Psychologist.TerminationClassifierTest do
  # Puro — classificação determinística, sem LLM (ADR 0013/0015).
  use ExUnit.Case, async: true

  alias Engine.Psychologist.TerminationClassifier, as: Classifier

  test "status closed é sempre :normal, qualquer que seja o motivo" do
    assert Classifier.classify(nil, "closed") == :normal
    assert Classifier.classify("heartbeat_timeout", "closed") == :normal
  end

  test "heartbeat_timeout em término anormal vira :timeout" do
    assert Classifier.classify("heartbeat_timeout", "closed_abnormally") == :timeout
  end

  test "kill (qualquer caixa) vira :kill" do
    assert Classifier.classify("killed", "closed_abnormally") == :kill
    assert Classifier.classify("Killed by operator", "closed_abnormally") == :kill
  end

  test "qualquer outra mensagem de erro vira :crash" do
    assert Classifier.classify("** (RuntimeError) boom", "closed_abnormally") == :crash
  end

  test "término anormal sem motivo reportado vira :unknown" do
    assert Classifier.classify(nil, "closed_abnormally") == :unknown
  end

  test "todas as causas têm rótulo pt-BR" do
    for cause <- [:normal, :timeout, :kill, :crash, :unknown] do
      assert is_binary(Classifier.label(cause))
    end
  end
end
