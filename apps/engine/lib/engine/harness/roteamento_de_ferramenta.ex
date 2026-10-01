defmodule Engine.Harness.RoteamentoDeFerramenta do
  @moduledoc """
  O lado do engine do roteamento de ferramenta pelo Jev (AT-238, ADR 0179,
  RN-625).

  Quem ESCOLHE a ferramenta é a api, dentro do `llm-turn` (a credencial, o
  metering e o modelo moram lá). O engine faz três coisas pequenas, todas na
  fachada `Engine.Sessions.EngineApiClient` — o ponto por onde passam TODAS as
  chamadas de LLM, os sete conversacionais, o `ToolLoop` e o Infra Lead — para
  não haver sete formas do mesmo evento:

  1. **Narrar** o passo em `tool_router.decided` (`registrar/5`): menu antes e
     depois, escolha, confiança, latência, a queda e o porquê. É esse evento,
     junto com `token_usage`, que a AT-239 lê para medir o ganho — por script
     sobre o log, nunca anotado.
  2. **Somar** o custo do Jev ao orçamento local do laço (`custo_micros/1`). O
     `usage.costMicros` do turno é só o do chat; o do Jev viaja à parte, em
     `toolRouting.custoMicros`, para `usage` continuar coerente com os próprios
     tokens.
  3. **Sair do beco** (`repetir_com_catalogo_inteiro?/2`): se o menu estava
     restrito e o modelo respondeu SEM chamar ferramenta, o passo é repetido UMA
     vez com o catálogo inteiro. É o mecanismo mais simples que não abre porta
     nova de contenção: a repetição pede MAIS ferramentas, nunca uma que o
     agente não tinha, e a api continua sem confiar em nada que o engine diga
     além de "não me restrinja".

  Nada aqui aprova, nega ou escolhe modelo. A ferramenta que o modelo chamar
  segue o caminho de sempre — inclusive uma que NÃO estava no cardápio do passo
  (lembrada do histórico): ela é despachada, vira `Proposed Action` e passa pela
  política, e o evento só REGISTRA `foraDoCardapio` (o Jev estreita, não proíbe).

  ## Falha

  Registrar o evento NUNCA derruba o turno: `append_event` que falha vira log.
  Resposta sem `toolRouting` (api antiga, ou roteador não consultado) é
  devolvida intacta e não grava nada.
  """

  require Logger

  alias Engine.Harness.ToolCallRecovery

  @tipo "tool_router.decided"

  @spec tipo() :: String.t()
  def tipo, do: @tipo

  @doc """
  Grava `tool_router.decided` se a resposta trouxe `toolRouting`, e devolve a
  resposta como veio. `grava` é a função que anexa o evento (a fachada passa a
  própria `append_event/3`, para o aviso ao canal valer também aqui).
  """
  @spec registrar(
          {:ok, map()} | {:error, term()},
          String.t(),
          String.t(),
          String.t(),
          (String.t(), String.t(), map() -> any())
        ) :: {:ok, map()} | {:error, term()}
  def registrar(
        {:ok, %{"toolRouting" => %{} = roteamento} = resp} = resultado,
        project_id,
        session_id,
        agent,
        grava
      ) do
    evento = %{
      type: @tipo,
      actorKind: "agent",
      actorId: agent,
      payload: payload(roteamento, resp)
    }

    try do
      grava.(project_id, session_id, evento)
    rescue
      erro ->
        Logger.warning("tool_router.decided não gravado: #{Exception.message(erro)}")
    end

    resultado
  end

  def registrar(resultado, _project_id, _session_id, _agent, _grava), do: resultado

  @doc false
  @spec payload(map(), map()) :: map()
  def payload(roteamento, resp) do
    menu_depois = Map.get(roteamento, "menuDepois") || []

    %{
      modelo: roteamento["modelo"],
      ofertadas: roteamento["ofertadas"],
      menuAntes: roteamento["menuAntes"],
      menuDepois: menu_depois,
      escolha: roteamento["escolha"],
      confianca: roteamento["confianca"],
      segunda: roteamento["segunda"],
      anterior: roteamento["anterior"],
      aplicado: roteamento["aplicado"] == true,
      motivoDaQueda: roteamento["motivoDaQueda"],
      origemDaQueda: roteamento["origemDaQueda"],
      detalheDaQueda: roteamento["detalheDaQueda"],
      latenciaMs: roteamento["latenciaMs"],
      custoMicros: roteamento["custoMicros"] || 0,
      gastoNaoRegistrado: roteamento["gastoNaoRegistrado"] == true,
      foraDoCardapio: fora_do_cardapio(resp, menu_depois)
    }
  end

  @doc "O custo do Jev nesta resposta, em micro-USD (0 quando não houve)."
  @spec custo_micros(map()) :: non_neg_integer()
  def custo_micros(%{"toolRouting" => %{"custoMicros" => custo}}) when is_integer(custo),
    do: max(custo, 0)

  def custo_micros(_resp), do: 0

  @doc """
  O menu foi restringido E o modelo não chamou ferramenta nenhuma (nem em
  texto recuperável)? Então o passo volta uma vez com o catálogo inteiro.
  Resposta com erro do provider não repete: o problema não é o menu.
  """
  @spec repetir_com_catalogo_inteiro?(map(), [map()]) :: boolean()
  def repetir_com_catalogo_inteiro?(
        %{"toolRouting" => %{"aplicado" => true}, "message" => message} = resp,
        tools
      )
      when is_map(message) do
    sem_erro? = Map.get(resp, "error") in [nil, ""]
    sem_chamada? = (Map.get(message, "toolCalls") || []) == []

    sem_recuperavel? =
      ToolCallRecovery.from_content(Map.get(message, "content") || "", nomes(tools)) == []

    sem_erro? and sem_chamada? and sem_recuperavel?
  end

  def repetir_com_catalogo_inteiro?(_resp, _tools), do: false

  @doc """
  Na repetição, a resposta útil é a NOVA, mas o custo do passo é dos dois: o
  Jev cobrou uma vez (só na primeira chamada) e o chat cobrou duas. O
  `toolRouting` da primeira fica, marcado `repetidoComCatalogoInteiro`, para o
  evento dizer que o menu estava errado.
  """
  @spec mesclar_repeticao(map(), map()) :: map()
  def mesclar_repeticao(primeira, segunda) do
    roteamento = Map.put(primeira["toolRouting"], "repetidoComCatalogoInteiro", true)

    custo_do_chat =
      (get_in(primeira, ["usage", "costMicros"]) || 0) +
        (get_in(segunda, ["usage", "costMicros"]) || 0)

    segunda
    |> Map.put("toolRouting", roteamento)
    |> Map.update(
      "usage",
      %{"costMicros" => custo_do_chat},
      &Map.put(&1, "costMicros", custo_do_chat)
    )
  end

  defp fora_do_cardapio(resp, menu_depois) do
    chamadas = get_in(resp, ["message", "toolCalls"]) || []

    chamadas
    |> Enum.map(& &1["name"])
    |> Enum.reject(&(is_nil(&1) or &1 in menu_depois))
    |> Enum.uniq()
  end

  defp nomes(tools) do
    Enum.map(tools, fn t -> Map.get(t, "name") || Map.get(t, :name) end)
  end
end
