defmodule Engine.Agents.RaciocinioDoTurno do
  @moduledoc """
  O RACIOCÍNIO do modelo ao longo do turno (AT-676, RN-993): irmão de
  `FontesDoTurno`. Acumula, no dicionário do processo do turno, o
  `raciocinio` INTEIRO de cada chamada de LLM e o entrega ao fecho
  (`TextoDoTurno.payload_do_turno/2` e o `ToolLoop`) como `raciocinio` e
  `raciocinioTotal` (caracteres), FORA do `content`.

  NUNCA volta ao modelo: `Reidratacao` não lê estas chaves, e o RAG não indexa.
  Os `thinkingBlocks` da Anthropic ficam só em memória, entre as voltas do
  laço, e são devolvidos na mensagem `assistant` com `toolCalls` da chamada
  seguinte — nunca vão ao log.
  """

  @chave {__MODULE__, :textos}
  @chave_blocos {__MODULE__, :blocos}

  @doc "Guarda o raciocínio (e os blocos da Anthropic) de uma chamada concluída."
  @spec registrar(map()) :: :ok
  def registrar(resp) when is_map(resp) do
    case resp["raciocinio"] do
      t when is_binary(t) and t != "" -> Process.put(@chave, [t | Process.get(@chave, [])])
      _ -> :ok
    end

    Process.put(@chave_blocos, get_in(resp, ["message", "thinkingBlocks"]))
    :ok
  end

  def registrar(_), do: :ok

  @doc "Devolve os blocos da última chamada na mensagem `assistant` com `toolCalls`."
  @spec anexar_blocos([map()]) :: [map()]
  def anexar_blocos(messages) do
    with [_ | _] = blocos <- Process.get(@chave_blocos),
         {_, i} <-
           messages
           |> Enum.with_index()
           |> Enum.filter(fn {m, _} ->
             m["role"] == "assistant" and m["toolCalls"] not in [nil, []]
           end)
           |> List.last() do
      List.update_at(messages, i, &Map.put(&1, "thinkingBlocks", blocos))
    else
      _ -> messages
    end
  end

  @doc "Entrega `%{raciocinio, raciocinioTotal}` (ou `%{}`) e esvazia o acúmulo."
  @spec descarregar() :: map()
  def descarregar do
    Process.delete(@chave_blocos)

    case Process.delete(@chave) do
      nil ->
        %{}

      textos ->
        texto = textos |> Enum.reverse() |> Enum.join("\n\n")
        %{raciocinio: texto, raciocinioTotal: String.length(texto)}
    end
  end
end
