defmodule Engine.Agents.MensagemDoAssistente do
  @moduledoc """
  A mensagem do assistente que os agentes conversacionais guardam no histórico
  depois de cada chamada de LLM (RN-690, AT-350).

  Ela leva os `toolCalls` NATIVOS da resposta quando há algum. Sem eles, o
  `role: "tool"` que `dispatch_tool/2` acrescenta em seguida viajava com um
  `toolCallId` que não respondia chamada nenhuma; o provider descartava o
  resultado órfão, o modelo nunca via o que a ferramenta devolveu e repetia a
  mesma chamada até o teto do laço. É o mesmo formato que o `ToolLoop` já
  guarda (a mensagem inteira) e que `Engine.Harness.ContextManager` agrupa na
  compactação. Chamada recuperada do TEXTO (`ToolCallRecovery`, id nulo) não
  entra: não há id para casar.
  """

  @spec de(String.t(), map()) :: map()
  def de(content, message) do
    base = %{"role" => "assistant", "content" => content, :pinned => false}

    case Map.get(message, "toolCalls") do
      [_ | _] = chamadas -> Map.put(base, "toolCalls", chamadas)
      _ -> base
    end
  end
end
