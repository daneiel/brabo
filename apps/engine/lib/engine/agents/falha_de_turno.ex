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
     motivo escrito.

  ## Por que `indeterminada` saiu

  Ela existiu com um argumento razoável: não chutar seria mais honesto que
  escolher uma das quatro no escuro. A execução real mostrou que o efeito é
  outro — `indeterminada` **não aponta ação nenhuma**. Quem tria a rodada
  seguinte lê "indeterminada" e recomeça a investigação do zero, que é o
  oposito de honesto.

  O que ela realmente significava: *o classificador não reconheceu esta forma*.
  Isso é uma lacuna do NOSSO código, e `codigo` é exatamente a origem que aponta
  a ação certa — acrescentar uma cláusula aqui. O diagnóstico continua indo
  verbatim junto, então nada de informação se perde no caminho.

  O valor devolvido é SEMPRE uma das quatro do ADR 0020, e há teste que falha se
  algum dia deixar de ser (achados P, Q e T).
  2. **O agente FALA** — a mensagem vai no mesmo evento, em português, para
     quem está na conversa não precisar abrir log nenhum.
  """

  @typedoc "O vocabulário fechado do ADR 0020. Não há quinto valor."
  @type origem :: String.t()

  @doc "As quatro origens do ADR 0020 — o conjunto que o teste verifica."
  @spec origens() :: [origem()]
  def origens, do: ["infra", "modelo", "codigo", "politica"]

  @doc """
  Origem da falha. Cada cláusula existe por um caso observado; a última não
  adivinha — ela nomeia a própria lacuna, que é de código.
  """
  @spec origem(term()) :: origem()
  # A api respondeu, mas o stream acabou sem frame final: conexão morreu no
  # meio, ou o processo do outro lado caiu. Nenhum dos dois é do modelo.
  def origem(:no_final_event), do: "infra"

  # Erro de transporte do Req (recusa de conexão, DNS, timeout).
  def origem(%{__exception__: true}), do: "infra"
  def origem(:timeout), do: "infra"

  # Requisição abortada no transporte (Req/Mint): a conexão morreu, não o
  # modelo. Saía como `indeterminada` porque não tinha cláusula — e
  # `indeterminada` é para o que não se sabe, não para o que ninguém escreveu.
  def origem(:aborted), do: "infra"

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
      # Texto que a api narrou e que nenhum padrão acima reconhece: a lacuna é
      # deste classificador. O diagnóstico vai junto, verbatim, com o texto
      # exato que falta cobrir.
      true -> "codigo"
    end
  end

  # Forma que este módulo não conhece. Mesma leitura: quem não soube classificar
  # foi o nosso código, e é aqui que a cláusula que falta deve nascer.
  def origem(_qualquer), do: "codigo"

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
  defp motivo(:aborted), do: "a conexão com a api foi abortada no meio do turno"
  defp motivo({:final, texto}) when is_binary(texto), do: texto
  defp motivo({status, _}) when is_integer(status), do: "a api respondeu #{status}"
  defp motivo(%{__exception__: true} = erro), do: Exception.message(erro)
  defp motivo(outro), do: inspect(outro)
end
