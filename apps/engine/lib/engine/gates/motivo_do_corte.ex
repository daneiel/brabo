defmodule Engine.Gates.MotivoDoCorte do
  @moduledoc """
  RN-945 (AT-618), extensão da RN-780: o motivo que os agentes de QA narram
  quando o `ToolLoop` para com `corte_pelo_teto: true` (resposta só de
  raciocínio, cortada pelo teto de saída duas vezes).
  """

  def texto,
    do:
      "a resposta foi só raciocínio e o teto de saída a cortou duas vezes; " <>
        "o modelo não chegou a chamar a ferramenta de término"
end
