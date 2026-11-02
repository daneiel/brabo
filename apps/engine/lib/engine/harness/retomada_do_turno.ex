defmodule Engine.Harness.RetomadaDoTurno do
  @moduledoc """
  "Você estava em X, falta Y" (AT-582, ADR 0226): a mensagem `system` EFÊMERA
  que o turno RETOMADO recebe, pelo MESMO molde de
  `Engine.Harness.AmbienteDoAgente` (RN-706), `FluxoDoTime` (RN-711) e
  `IdiomaDaResposta` (RN-622): nunca em `state.messages`, nunca por servidor,
  nunca uma fala falsa do usuário.

  ## Contrato

    * `texto/1` — PURO. Recebe o mapa de `Engine.Agents.Diario` e devolve o
      texto (teto `teto_de_caracteres/0`, 2 000): onde parou, o plano, o que
      está confirmado (não repetir), o que ficou sem desfecho (conferir o estado
      antes de repetir), as ações pendentes (não propor de novo) e a ordem de
      continuar do próximo passo. Diz que merge em branch protegida nunca é do
      agente (RN-418).
    * `com_retomada/2` — roda `fun` com o texto no dicionário do processo e
      restaura o anterior ao sair. Aceita o texto ou um `ctx` com a chave
      `:retomada` (o `ToolLoop` dos dev/gates). Sem texto, não faz nada.
      Nos conversacionais o dicionário viaja para a Task do turno
      (`TurnoAssincrono.iniciar/3`), e a mensagem vale para TODAS as chamadas
      do turno retomado e some com ele.
    * `anexar/2` — chamado pela fachada `EngineApiClient` (`llm_turn/5` e
      `llm_turn_stream/6`), DEPOIS de `DecisoesDoProjeto` e ANTES de
      `PerfilDoAutor`; o idioma continua a última.
  """

  @chave :brabo_retomada_do_turno
  @teto 2_000

  def teto_de_caracteres, do: @teto

  @doc "Roda `fun` com a retomada (`texto` ou `ctx[:retomada]`) no dicionário do processo."
  def com_retomada(texto_ou_ctx, fun) when is_function(fun, 0) do
    anterior = Process.get(@chave)

    case texto_de(texto_ou_ctx) do
      nil -> :ok
      texto -> Process.put(@chave, texto)
    end

    try do
      fun.()
    after
      if anterior, do: Process.put(@chave, anterior), else: Process.delete(@chave)
    end
  end

  @doc "A lista com a mensagem de retomada no FIM, ou intacta sem retomada."
  @spec anexar([map()], String.t()) :: [map()]
  def anexar(messages, _agent) when is_list(messages) do
    case Process.get(@chave) do
      texto when is_binary(texto) and texto != "" ->
        messages ++ [%{"role" => "system", "content" => texto}]

      _ ->
        messages
    end
  end

  def anexar(messages, _agent), do: messages

  defp texto_de(t) when is_binary(t) and t != "", do: t
  defp texto_de(%{retomada: t}) when is_binary(t) and t != "", do: t
  defp texto_de(_), do: nil

  @doc "O texto, PURO, a partir do mapa do `Engine.Agents.Diario`."
  @spec texto(map()) :: String.t()
  def texto(diario) do
    [
      "Retomada (fato do sistema): o seu turno anterior foi interrompido antes de " <>
        "terminar. Continue do PRÓXIMO passo, sem recomeçar e sem repetir o que já foi feito.",
      plano(Map.get(diario, :plano)),
      lista("Já confirmado (não repita)", Map.get(diario, :efeitos, [])),
      lista(
        "Ficou sem desfecho registrado (confira o estado antes de repetir)",
        Map.get(diario, :sem_desfecho, [])
      ),
      lista(
        "Ações pendentes de decisão (não proponha de novo)",
        Map.get(diario, :pendentes, [])
      ),
      "Merge em branch protegida nunca é seu: é sempre do usuário."
    ]
    |> Enum.reject(&is_nil/1)
    |> Enum.join("\n")
    |> cortar()
  end

  defp plano(%{"objetivo" => objetivo, "passos" => passos}) when is_list(passos) do
    linhas =
      passos
      |> Enum.with_index(1)
      |> Enum.map_join("\n", fn {p, i} -> "#{i}. [#{p["estado"]}] #{p["texto"]}" end)

    "Seu plano: #{objetivo}\n#{linhas}"
  end

  defp plano(_),
    do: "Você não deixou plano registrado: reconstrua o ponto em que parou pelo histórico."

  defp lista(_titulo, []), do: nil
  defp lista(titulo, itens), do: "#{titulo}: " <> Enum.join(itens, "; ") <> "."

  defp cortar(t),
    do: if(String.length(t) > @teto, do: String.slice(t, 0, @teto - 1) <> "…", else: t)
end
