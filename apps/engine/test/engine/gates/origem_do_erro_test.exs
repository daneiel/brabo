defmodule Engine.Gates.OrigemDoErroTest do
  use ExUnit.Case, async: true

  alias Engine.Gates.OrigemDoErro

  test "corte por max_tokens é do modelo (RN-897)" do
    assert OrigemDoErro.de_llm("Tool calls cutoff by max_tokens (BaseTen 502)") == "modelo"
  end

  test "outro erro de provider segue infra" do
    assert OrigemDoErro.de_llm("timeout de 120s") == "infra"
  end
end
