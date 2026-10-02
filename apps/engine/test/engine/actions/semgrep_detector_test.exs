defmodule Engine.Actions.SemgrepDetectorTest do
  use ExUnit.Case, async: true

  alias Engine.Actions.SemgrepDetector.Live

  # RN-707 (AT-380): a saída do semgrep é interpretada sem rodar o binário.
  test "JSON com results vira findings, inclusive com exit 1 (achou algo)" do
    json =
      Jason.encode!(%{
        "results" => [
          %{
            "path" => "a.js",
            "check_id" => "x",
            "start" => %{"line" => 3},
            "extra" => %{"message" => "eval"}
          }
        ]
      })

    assert {:ok, [%{tool: "semgrep", path: "a.js", line: 3, message: "eval"}]} =
             Live.interpretar(json, 1)
  end

  test "exit 1 com stdout vazio é falha de execução nomeada, não :invalid_output" do
    assert {:error, {:sem_saida, 1}} = Live.interpretar("", 1)
    assert {:error, {:sem_saida, 0}} = Live.interpretar("  \n", 0)
  end

  test "saída não JSON segue :invalid_output; exit fora de 0/1 é :scan_failed" do
    assert {:error, :invalid_output} = Live.interpretar("Traceback", 1)
    assert {:error, :scan_failed} = Live.interpretar("", 2)
  end
end
