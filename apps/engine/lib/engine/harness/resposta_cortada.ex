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

    * `Engine.Harness.ArgumentosDeFerramenta.executar/4` NÃO executa ferramenta
      vinda de resposta cortada: devolve ao laço um erro nomeado (RN-163) para
      o modelo reenviar em partes menores;
    * `Engine.Agents.TextoDoTurno.payload_do_turno/2` acrescenta ao fecho, sem
      reescrevê-lo, a linha `linha/1` no idioma do turno (molde da RN-731).
  """

  alias Engine.Harness.IdiomaDaResposta

  @chave {__MODULE__, :cortada}

  @recusa "a resposta foi cortada pelo limite de tokens, e os argumentos desta " <>
            "chamada chegaram incompletos; a ferramenta NÃO foi executada. Reenvie " <>
            "o argumento em partes menores."

  @doc """
  Anota se a resposta da chamada de LLM veio cortada e devolve o resultado
  intacto. Qualquer outro desfecho limpa a anotação.
  """
  @spec registrar(term(), String.t() | nil) :: term()
  def registrar({:ok, %{"truncated" => true}} = resultado, project_id) do
    Process.put(@chave, {:cortada, project_id})
    resultado
  end

  def registrar(resultado, _project_id) do
    Process.delete(@chave)
    resultado
  end

  @doc "A última resposta de LLM deste processo veio cortada pelo teto?"
  @spec cortada?() :: boolean()
  def cortada?, do: match?({:cortada, _}, Process.get(@chave))

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
      {:cortada, project_id} -> linha(idioma || IdiomaDaResposta.idioma_do_turno(project_id))
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
