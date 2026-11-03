defmodule Engine.Harness.CitacaoDasFontes do
  @moduledoc """
  Citação inline `[n]` validada contra as fontes do PRÓPRIO turno (AT-716,
  RN-985).

  - `anexar/1`: mensagem `system` EFÊMERA no fim da chamada (mesmo caminho de
    `IdiomaDaResposta`, na fachada `EngineApiClient`), só com ≥1 fonte em
    `FontesDoTurno`. Lista `[n] rótulo` na ordem de `fontes` (até 10). Não nomeia
    idioma (RN-667) e nunca entra em `state.messages`. Teto declarado: 250 tokens
    (`teto_de_tokens/0`); o teste mede com 10 fontes.
  - `marcar/1`: no fecho, grava `citacoes` (índices `[n]` do texto que existem
    em `fontes`, sem repetição, em ordem de aparição). O `content` não é
    reescrito (RN-731); sem marcador válido o campo fica ausente.
  """

  alias Engine.Agents.FontesDoTurno

  @teto_de_tokens 250
  def teto_de_tokens, do: @teto_de_tokens

  @spec anexar([map()]) :: [map()]
  def anexar(messages) when is_list(messages) do
    case FontesDoTurno.ver() do
      [] -> messages
      fontes -> messages ++ [%{"role" => "system", "content" => texto(fontes)}]
    end
  end

  def anexar(messages), do: messages

  @doc "O texto, PURO."
  def texto(fontes) do
    lista =
      fontes
      |> Enum.with_index(1)
      |> Enum.map_join("\n", fn {f, n} -> "[#{n}] #{Map.get(f, :rotulo) || Map.get(f, :ref)}" end)

    "Fontes consultadas neste turno:\n#{lista}\n" <>
      "Ao afirmar algo que veio de uma fonte, cite com [n]. Não cite o que não está na lista."
  end

  @spec marcar(map()) :: map()
  def marcar(%{content: content, fontes: fontes} = payload)
      when is_binary(content) and is_list(fontes) do
    max = length(fontes)

    validos =
      ~r/\[(\d{1,3})\]/
      |> Regex.scan(content, capture: :all_but_first)
      |> Enum.map(fn [n] -> String.to_integer(n) end)
      |> Enum.filter(&(&1 >= 1 and &1 <= max))
      |> Enum.uniq()

    if validos == [], do: payload, else: Map.put(payload, :citacoes, validos)
  end

  def marcar(payload), do: payload
end
