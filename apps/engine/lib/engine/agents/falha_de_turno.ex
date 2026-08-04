defmodule Engine.Agents.FalhaDeTurno do
  @moduledoc """
  Traduz a falha de um turno de LLM em ORIGEM e em uma frase que o agente diz.

  Existe porque o desfecho de falha era o pior possível: os quatro agentes
  conversacionais gravavam `agent.response` com conteúdo VAZIO no event log —
  indistinguível de sucesso — e mandavam o motivo por `broadcast`, que é
  efêmero. Quem não estivesse com a aba aberta naquele segundo nunca saberia
  que houve erro; quem estivesse, via um balão em branco.

  Duas correções, e as duas importam:

  1. **A falha vira evento durável** (`agent.error`), com a ORIGEM no
     vocabulário do ADR 0020 — nunca por eliminação: cada padrão abaixo tem um
     motivo escrito, e o que não casa com nenhum sai como `indeterminada`, que
     é mais honesto que chutar uma das quatro.
  2. **O agente FALA** — a mensagem vai no mesmo evento, em português, para
     quem está na conversa não precisar abrir log nenhum.
  """

  @typedoc "Vocabulário do ADR 0020, mais `indeterminada` para o que não se sabe."
  @type origem :: String.t()

  @doc """
  Origem da falha. Cada cláusula existe por um caso observado, e a última
  recusa-se a adivinhar.
  """
  @spec origem(term()) :: origem()
  # A api respondeu, mas o stream acabou sem frame final: conexão morreu no
  # meio, ou o processo do outro lado caiu. Nenhum dos dois é do modelo.
  def origem(:no_final_event), do: "infra"

  # Erro de transporte do Req (recusa de conexão, DNS, timeout).
  def origem(%{__exception__: true}), do: "infra"
  def origem(:timeout), do: "infra"

  # A api recusou a chamada. 5xx é dela; 4xx é do que o engine mandou.
  def origem({status, _corpo}) when is_integer(status) and status >= 500, do: "infra"
  def origem({status, _corpo}) when is_integer(status) and status >= 400, do: "codigo"

  # Erro que a própria api narrou no frame final — texto normalizado por ela.
  def origem({:final, texto}) when is_binary(texto) do
    cond do
      texto =~ ~r/budget|orçamento/iu -> "politica"
      texto =~ ~r/credencial/iu -> "politica"
      texto =~ ~r/modelo vinculado|binding/iu -> "politica"
      texto =~ ~r/provider|upstream|rate.?limit|401|429/iu -> "modelo"
      true -> "indeterminada"
    end
  end

  def origem(_qualquer), do: "indeterminada"

  @doc """
  A frase que o agente diz no fio. Sempre nomeia o que falhou e o que NÃO
  aconteceu — "nada foi gasto" é a informação que a pessoa mais quer quando vê
  um erro de LLM.
  """
  @spec mensagem(term()) :: String.t()
  def mensagem(reason) do
    "Não consegui completar este turno: #{motivo(reason)}. " <>
      "Nada foi gasto nesta tentativa. Você pode tentar de novo."
  end

  defp motivo(:no_final_event), do: "a resposta do modelo foi interrompida antes do fim"
  defp motivo({:final, texto}) when is_binary(texto), do: texto
  defp motivo({status, _}) when is_integer(status), do: "a api respondeu #{status}"
  defp motivo(%{__exception__: true} = erro), do: Exception.message(erro)
  defp motivo(outro), do: inspect(outro)
end
