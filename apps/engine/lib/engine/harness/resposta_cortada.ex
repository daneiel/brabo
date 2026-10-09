defmodule Engine.Harness.RespostaCortada do
  @moduledoc """
  A resposta do modelo que o TETO de saída cortou (RN-737, AT-423).

  Desde a RN-734 toda chamada leva `max_tokens`, e o provider fecha a resposta
  que estoura o teto com `finish_reason: "length"` (`stop_reason:
  "max_tokens"` no Anthropic). A api lê isso e devolve `truncated: true` na
  resposta do `llm-turn` e no frame `final` do stream. Sem este módulo o
  sinal se perdia: um argumento de ferramenta partido (um artefato grande,
  JSON pela metade) era executado como se estivesse inteiro, e um fecho
  cortado chegava ao fio sem aviso.

  A fachada `Engine.Sessions.EngineApiClient` chama `registrar/2` a cada
  chamada de LLM, no processo do turno — o mesmo que despacha as ferramentas
  e grava o fecho —, então o estado vale para a ÚLTIMA resposta e a próxima
  chamada o substitui. Dois consumidores:

    * `Engine.Harness.ArgumentosDeFerramenta.executar/4` NÃO executa a chamada
      INCOMPLETA da resposta cortada: devolve ao laço um erro nomeado (RN-163)
      para o modelo reenviar em partes menores. Desde a RN-745 (AT-430) só a
      ÚLTIMA chamada da resposta é a incompleta — medido: o stream
      OpenAI-compatível monta as chamadas em ordem, o corte cai na última, e
      `parseArgumentos` da api devolve `{}` para o JSON partido; as anteriores
      chegam com o JSON inteiro e EXECUTAM. Resposta cortada sem chamada
      conhecida segue recusando tudo (a régua da RN-737);
    * `Engine.Agents.TextoDoTurno.payload_do_turno/2` acrescenta ao fecho, sem
      reescrevê-lo, a linha `linha/1` no idioma do turno (molde da RN-731).
  """

  alias Engine.Harness.IdiomaDaResposta

  @chave {__MODULE__, :cortada}

  @recusa "a resposta foi cortada pelo limite de tokens, e os argumentos desta " <>
            "chamada (a última da resposta) chegaram incompletos; a ferramenta NÃO " <>
            "foi executada. As chamadas anteriores da mesma resposta, completas, " <>
            "foram executadas normalmente. Reenvie esta em partes menores, uma por chamada."

  @doc """
  Anota se a resposta da chamada de LLM veio cortada e devolve o resultado
  intacto. Qualquer outro desfecho limpa a anotação.
  """
  @spec registrar(term(), String.t() | nil) :: term()
  def registrar({:ok, %{"truncated" => true} = resp} = resultado, project_id) do
    Process.put(@chave, {:cortada, project_id, ultima_chamada(resp)})
    resultado
  end

  def registrar(resultado, _project_id) do
    Process.delete(@chave)
    resultado
  end

  @doc "A última resposta de LLM deste processo veio cortada pelo teto?"
  @spec cortada?() :: boolean()
  def cortada?, do: match?({:cortada, _, _}, Process.get(@chave))

  @doc """
  Esta chamada (`name`, `args`) é a incompleta da resposta cortada? É a
  ÚLTIMA chamada da resposta (RN-745); sem chamada conhecida, toda chamada é
  tratada como incompleta (RN-737).
  """
  @spec incompleta?(String.t() | nil, term()) :: boolean()
  def incompleta?(name, args) do
    case Process.get(@chave) do
      {:cortada, _, {n, a}} -> n == name and a == args
      {:cortada, _, nil} -> true
      _ -> false
    end
  end

  defp ultima_chamada(resp) do
    chamadas = get_in(resp, ["message", "toolCalls"]) || []

    case List.last(chamadas) do
      %{} = c -> {Map.get(c, "name"), Map.get(c, "arguments", %{})}
      _ -> nil
    end
  end

  @doc "O erro que volta ao laço no lugar da ferramenta de resposta cortada."
  @spec recusa(String.t() | nil) :: String.t()
  def recusa(name), do: "#{name}: #{@recusa}"

  @doc """
  A linha do fecho (ou `nil` quando a última resposta não foi cortada) e
  limpa a anotação. Sem `idioma`, usa o do turno (RN-622).
  """
  @spec descarregar(String.t() | nil) :: String.t() | nil
  def descarregar(idioma \\ nil) do
    case Process.delete(@chave) do
      {:cortada, project_id, _} -> linha(idioma || IdiomaDaResposta.idioma_do_turno(project_id))
      _ -> nil
    end
  end

  @doc "A linha no idioma dado: `pt*` em português, qualquer outro em inglês."
  @spec linha(String.t() | nil) :: String.t()
  def linha(idioma) when is_binary(idioma) do
    if idioma |> String.downcase() |> String.starts_with?("pt"),
      do: "Resposta cortada pelo limite de tamanho.",
      else: "Response cut off by the length limit."
  end

  def linha(_), do: "Response cut off by the length limit."
end
