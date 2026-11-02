defmodule Engine.Gates.Hooks.TerminationTest do
  # RN-787 (AT-464): o parecer de QA grava `itens`/`coverageMatrix` como LISTA,
  # mesmo quando o modelo os manda como string JSON.
  use ExUnit.Case, async: true

  alias Engine.Gates.Hooks.Termination

  defp parecer(args),
    do: Termination.call(%{tool: "emit_qa_verdict", result_ok?: true, args: args})

  test "string JSON vira lista" do
    assert {:halt, {"emit_qa_verdict", v}} =
             parecer(%{
               "veredito" => "approved",
               "itens" => "[]",
               "coverageMatrix" => ~s([{"rule":"R1","covered":true}])
             })

    assert v.itens == []
    assert v.coverage_matrix == [%{"rule" => "R1", "covered" => true}]
  end

  test "lista passa intacta; string que não é lista JSON vira lista vazia" do
    assert {:halt, {_, v}} =
             parecer(%{"veredito" => "approved", "itens" => ["a"], "coverageMatrix" => "nada"})

    assert v.itens == ["a"]
    assert v.coverage_matrix == []
  end
end
