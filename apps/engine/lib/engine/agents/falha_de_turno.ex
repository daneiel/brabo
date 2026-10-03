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

  # A api recusou a oferta de handoff porque o destino já está ativo no projeto
  # (ADR 0182, RN-635): não há defeito de código, há uma regra de produto.
  def origem({409, %{"reason" => "agente_ja_ativo"}}), do: "politica"

  # A api recusou a chamada. 5xx é dela; 4xx é do que o engine mandou.
  def origem({status, _corpo}) when is_integer(status) and status >= 500, do: "infra"
  def origem({status, _corpo}) when is_integer(status) and status >= 400, do: "codigo"

  # Frame final com o `errorCode` do provider (RN-730): o código decide o
  # crédito esgotado; o resto segue pela leitura do texto.
  def origem({:final, texto, "insufficient_credit"}) when is_binary(texto), do: "infra"
  def origem({:final, texto, _code}) when is_binary(texto), do: origem({:final, texto})

  # Erro que a própria api narrou no frame final — texto normalizado por ela.
  def origem({:final, texto}) when is_binary(texto) do
    cond do
      # RN-726: provider sem crédito (402) é INFRA — falta saldo na conta, não
      # há defeito do modelo nem do nosso código. Antes do padrão de provider.
      credito_esgotado?(texto) -> "infra"
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
  O provider recusou por falta de CRÉDITO (HTTP 402, ou o texto do OpenRouter
  "exceed your available credits"/"add credits") — RN-726. Aceita o termo cru
  ou o texto já inspecionado (`ctx.last_error` do `ToolLoop` é `inspect/1`).
  """
  @spec credito_esgotado?(term()) :: boolean()
  def credito_esgotado?(nil), do: false

  # RN-730: o `code` normalizado pela api (ADR 0041) decide PRIMEIRO. O texto
  # abaixo fica só como REDE: api anterior ao `errorCode`, e caminhos que só
  # carregam a mensagem (o `last_error` do `ToolLoop` quando o código não veio).
  def credito_esgotado?(%{"errorCode" => "insufficient_credit"}), do: true
  def credito_esgotado?(%{"errorCode" => code}) when is_binary(code), do: false
  def credito_esgotado?(%{"error" => texto}), do: credito_esgotado?(texto)

  def credito_esgotado?(texto) when is_binary(texto) do
    texto =~ ~r/status 402|\(402\)|available credits|add credits|insufficient credits/iu
  end

  def credito_esgotado?(outro), do: credito_esgotado?(inspect(outro))

  @doc """
  A frase que o agente diz no fio. Sempre nomeia o que falhou e o que NÃO
  aconteceu — "nada foi gasto" é a informação que a pessoa mais quer quando vê
  um erro de LLM.

  Crédito do provider esgotado (RN-733) ganha frase CURTA e acionável no idioma
  do turno (RN-622, `IdiomaDaResposta.idioma_do_turno/1`); o JSON do provider
  fica só no `reason` (diagnóstico), nunca na bolha.
  """
  @spec mensagem(term(), String.t() | nil) :: String.t()
  def mensagem(reason, project_id \\ nil) do
    if credito?(reason) do
      if portugues?(Engine.Harness.IdiomaDaResposta.idioma_do_turno(project_id)),
        do: "Crédito do provedor do modelo esgotado — recarregue a chave e tente de novo.",
        else: "The model provider's credit is exhausted — top up the key and try again."
    else
      "Não consegui completar este turno: #{motivo(reason)}. " <>
        "Nada foi gasto nesta tentativa. Você pode tentar de novo."
    end
  end

  @doc """
  O `reason` gravado no `agent.error` (diagnóstico, RN-733): o texto do frame
  final quando há um — nunca a tupla `{:final, …}` inspecionada —; o resto,
  `inspect/1` como sempre.
  """
  @spec diagnostico(term()) :: String.t()
  def diagnostico({:final, texto}) when is_binary(texto), do: texto
  def diagnostico({:final, texto, _code}) when is_binary(texto), do: texto
  def diagnostico(outro), do: inspect(outro)

  defp credito?({:final, _texto, "insufficient_credit"}), do: true
  defp credito?({:final, texto, _code}) when is_binary(texto), do: credito_esgotado?(texto)
  defp credito?({:final, texto}) when is_binary(texto), do: credito_esgotado?(texto)
  defp credito?(_), do: false

  # Sem idioma conhecido, pt-BR: é o idioma em que esta frase sempre saiu.
  defp portugues?(idioma) when is_binary(idioma),
    do: idioma |> String.downcase() |> String.starts_with?("pt")

  defp portugues?(_), do: true

  defp motivo(:no_final_event), do: "a resposta do modelo foi interrompida antes do fim"
  defp motivo(:aborted), do: "a conexão com a api foi abortada no meio do turno"
  defp motivo({:final, texto}) when is_binary(texto), do: texto
  defp motivo({:final, texto, _code}) when is_binary(texto), do: texto
  defp motivo({status, _}) when is_integer(status), do: "a api respondeu #{status}"
  defp motivo(%{__exception__: true} = erro), do: Exception.message(erro)
  defp motivo(outro), do: inspect(outro)
end
