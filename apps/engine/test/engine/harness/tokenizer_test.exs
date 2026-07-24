defmodule Engine.Harness.TokenizerTest do
  use ExUnit.Case, async: true

  alias Engine.Harness.Tokenizer

  test "vazio estima 0 tokens" do
    assert Tokenizer.estimate("") == 0
  end

  test "estimativa é bytes/4 com teto, determinística" do
    # 8 bytes -> 2 tokens; 9 bytes -> 3 (teto).
    assert Tokenizer.estimate("abcdefgh") == 2
    assert Tokenizer.estimate("abcdefghi") == 3
    # Determinismo: mesma entrada, mesmo resultado.
    assert Tokenizer.estimate("qualquer coisa") == Tokenizer.estimate("qualquer coisa")
  end

  test "estimativa cresce monotonicamente com o tamanho" do
    assert Tokenizer.estimate("aa") <= Tokenizer.estimate("aaaaaa")
  end

  test "estimated?/0 é true (resultado é sempre estimativa)" do
    assert Tokenizer.estimated?() == true
  end
end
