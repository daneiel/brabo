defmodule Engine.Agents.TextoDoTurno do
  @moduledoc """
  O texto que o modelo escreve ao longo de UM turno de agente conversacional,
  gravado como UMA `agent.response` (RN-698, AT-354).

  Com ferramentas, o modelo escreve em pedaços: um trecho antes da chamada de
  ferramenta, outro na volta seguinte — e muitas vezes a frase continua de uma
  volta para a outra (" histórias e tarefas que cubram tudo."). Cada volta
  virava a SUA `agent.response`, e o fio recolhe as anteriores em "Passos do
  turno" e deixa à mostra só a última: o que se lia era o fragmento, começando
  com espaço, no meio da frase. Nada se perdia no transporte (o frame `final`
  da api leva o texto inteiro da VOLTA); o que se partia era o TURNO.

  O acúmulo mora no dicionário do PROCESSO do turno — a Task de
  `TurnoAssincrono`, que nasce e morre com ele —, então não há estado do
  servidor a limpar nem a sobreviver a um reinício. Quem fecha o turno (sem
  ferramenta, teto esgotado, falha) chama `descarregar/0` e grava o que veio.
  """

  @chave {__MODULE__, :pedacos}

  @doc "Guarda o texto de uma volta que ainda vai continuar (houve ferramenta)."
  @spec acumular(String.t() | nil) :: :ok
  def acumular(texto) when texto in [nil, ""], do: :ok

  def acumular(texto) when is_binary(texto) do
    Process.put(@chave, [texto | Process.get(@chave, [])])
    :ok
  end

  @doc """
  Devolve o texto do turno inteiro — os pedaços acumulados mais o `ultimo` — e
  esvazia o acúmulo. `""` quando o modelo não escreveu nada.
  """
  @spec descarregar(String.t() | nil) :: String.t()
  def descarregar(ultimo \\ "") do
    pedacos = Enum.reverse(Process.get(@chave, []))
    Process.delete(@chave)

    (pedacos ++ [ultimo || ""])
    |> Enum.reject(&(&1 == ""))
    |> Enum.reduce("", &juntar(&2, &1))
  end

  @doc """
  Junta dois pedaços. Pedaço que já começa ou termina com espaço é
  continuação da mesma frase e entra como veio; dois pedaços "colados" (sem
  espaço entre eles) viram parágrafos — juntar "feito.Agora" seria inventar
  uma palavra.
  """
  @spec juntar(String.t(), String.t()) :: String.t()
  def juntar("", pedaco), do: pedaco

  def juntar(acumulado, pedaco) do
    if String.match?(acumulado, ~r/\s\z/u) or String.match?(pedaco, ~r/\A\s/u) do
      acumulado <> pedaco
    else
      acumulado <> "\n\n" <> pedaco
    end
  end
end
