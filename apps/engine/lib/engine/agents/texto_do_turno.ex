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
  @chave_modelo {__MODULE__, :modelo}

  @doc "Guarda o texto de uma volta que ainda vai continuar (houve ferramenta)."
  @spec acumular(String.t() | nil) :: :ok
  def acumular(texto) when texto in [nil, ""], do: :ok

  def acumular(texto) when is_binary(texto) do
    Process.put(@chave, [texto | Process.get(@chave, [])])
    :ok
  end

  @doc """
  Como `acumular/1`, guardando também o `modelName` da chamada de LLM que
  escreveu a volta (AT-384): o turno que fecha SEM uma chamada final (entregou
  um formulário, esgotou o teto) grava o texto com o modelo da última chamada
  que houve, nunca com `nil`. `nil` não apaga o modelo já visto.
  """
  @spec acumular(String.t() | nil, String.t() | nil) :: :ok
  def acumular(texto, modelo) do
    if is_binary(modelo) and modelo != "", do: Process.put(@chave_modelo, modelo)
    acumular(texto)
  end

  @doc """
  Devolve `{texto, modelo}` e esvazia o acúmulo: o `modelo` é o da chamada que
  fecha o turno, senão o da última volta acumulada, senão `nil` — sem chamada
  de LLM no turno, nenhum modelo é inventado.
  """
  @spec descarregar_com_modelo(String.t() | nil, String.t() | nil) ::
          {String.t(), String.t() | nil}
  def descarregar_com_modelo(ultimo, modelo) do
    visto = Process.delete(@chave_modelo)
    {descarregar(ultimo), modelo || visto}
  end

  @doc """
  O payload da `agent.response` do turno (AT-395, revisa a RN-698 por decisão
  do dono de 03/10): `content` é só o FECHO — o texto da última volta que
  escreveu algo (o turno que termina num formulário, sem texto na última
  volta, fica com a anterior) — e `passos` são os textos das voltas
  anteriores, na ordem, só quando há. Nada some: o fio os recolhe em "Passos
  do turno". `nil` quando o modelo não escreveu nada. Esvazia o acúmulo.
  """
  @spec payload_do_turno(String.t() | nil, String.t() | nil) :: map() | nil
  def payload_do_turno(ultimo, modelo) do
    visto = Process.delete(@chave_modelo)
    pedacos = Enum.reverse(Process.delete(@chave) || [])

    case Enum.reject(pedacos ++ [ultimo || ""], &(&1 == "")) do
      [] ->
        Engine.Agents.GravadoNoTurno.descarregar()
        nil

      textos ->
        {passos, [fecho]} = Enum.split(textos, -1)

        # RN-731: o número do que foi gravado é FATO do servidor, nunca do texto.
        fecho =
          case Engine.Agents.GravadoNoTurno.descarregar() do
            nil -> String.trim_leading(fecho)
            linha -> String.trim_leading(fecho) <> "\n\n" <> linha
          end

        base = %{content: fecho, modelName: modelo || visto}
        if passos == [], do: base, else: Map.put(base, :passos, passos)
    end
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
