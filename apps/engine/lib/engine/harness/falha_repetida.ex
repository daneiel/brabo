defmodule Engine.Harness.FalhaRepetida do
  @moduledoc """
  Falha repetida de ferramenta no turno (AT-588, RN-913). Conta, no dicionário
  do processo do turno (molde de `IdiomaDaResposta`), as falhas IGUAIS — mesma
  ferramenta e mesmos argumentos, `tool.result` `ok: false`. Na 2ª o resultado
  devolvido ao modelo ganha a correção; na 3ª o laço PARA com `agent.error`
  origem `modelo` (RN-059, RN-163). Quem despacha é
  `ArgumentosDeFerramenta.executar/4`; quem para é cada laço, pelo desfecho que
  ele já tem para o teto de iterações (`restante/1` zera as voltas e
  `narrar_ou/4` troca o `toolloop.limit_reached` por esta narração).
  """

  alias Engine.Sessions.EngineApiClient

  @chave :falha_repetida
  @parar_em 3
  # Os testes do teto de iterações repetem a MESMA chamada falha: `config/test.exs` sobe o limite.
  defp parar_em, do: Application.get_env(:engine, :falha_repetida_parar_em, @parar_em)

  @doc "Zera o contador (início de turno)."
  def zerar, do: Process.delete(@chave)

  @doc "Zera o contador e devolve `voltas`: entra no lugar do teto na 1ª volta de cada turno."
  def inicio_de_turno(voltas) do
    zerar()
    voltas
  end

  @doc "Registra o resultado de uma chamada; devolve o resultado, com a correção da 2ª falha igual em diante."
  def registrar({:error, motivo}, name, args) do
    estado = Process.get(@chave, %{contagens: %{}, parou: false})
    n = Map.get(estado.contagens, {name, args}, 0) + 1

    Process.put(@chave, %{
      estado
      | contagens: Map.put(estado.contagens, {name, args}, n),
        parou: estado.parou or n >= parar_em()
    })

    if n >= 2,
      do:
        {:error,
         "#{motivo}\n\nCORREÇÃO: esta chamada já falhou igual #{n} vezes neste turno. " <>
           "Não a repita: mude os argumentos ou use outra abordagem."},
      else: {:error, motivo}
  end

  def registrar(resultado, _name, _args), do: resultado

  @doc "O turno já atingiu a 3ª falha igual?"
  def parou?, do: Process.get(@chave, %{parou: false}).parou

  @doc "Zera as voltas que restam se o turno parou — o laço cai no desfecho do teto."
  def restante(remaining), do: if(parou?(), do: 0, else: remaining)

  @doc "Se parou, narra o `agent.error` (e zera); senão roda `fun` (a narração do teto)."
  def narrar_ou(project_id, session_id, agent, fun) do
    if parou?(), do: narrar(project_id, session_id, agent), else: fun.()
  end

  @doc "Grava o `agent.error` de origem `modelo` da parada e zera o contador."
  def narrar(project_id, session_id, agent) do
    zerar()

    EngineApiClient.append_event(project_id, session_id, %{
      type: "agent.error",
      actorKind: "agent",
      actorId: agent,
      payload: %{
        origem: "modelo",
        mensagem:
          "Parei: a mesma chamada de ferramenta falhou igual #{parar_em()} vezes neste turno. " <>
            "Me diga como prefere seguir.",
        reason: "falha_repetida_de_ferramenta"
      }
    })
  end
end
