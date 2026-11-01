defmodule Engine.Gates.OrigemDoErro do
  @moduledoc """
  Origem (RN-059) do erro de LLM que parou o turno de um gate (RN-897, AT-586).
  Provider que CORTA a chamada de ferramenta no teto de saída ("Tool calls
  cutoff by max_tokens") é o modelo estourando o teto, não a infra caindo;
  qualquer outro erro de LLM segue `infra`.
  """

  @spec de_llm(term()) :: String.t()
  def de_llm(error) do
    if String.contains?(to_string(error), "cutoff by max_tokens"), do: "modelo", else: "infra"
  end
end
