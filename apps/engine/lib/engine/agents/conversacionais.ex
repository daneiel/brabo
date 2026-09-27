defmodule Engine.Agents.Conversacionais do
  @moduledoc """
  Os agentes conversacionais de UMA sessão, e o que acontece com eles quando
  ela fecha (RN-581, AT-072).

  Cada conversacional é um processo por sessão, registrado LOCALMENTE em
  `Engine.Sessions.Registry` sob `<agente>:<sessão>` e supervisionado por um
  `DynamicSupervisor` próprio com `restart: :temporary`. Até a RN-581 nada os
  parava: `SessionLifecycleWorker` só derrubava o `SessionServer`, e o
  Criativo de uma sessão fechada seguia vivo, com o turno em curso chamando o
  modelo e gravando no log — no `exp001`, quatro minutos de eventos depois do
  `closed_at`.

  A lista é a MESMA que a api usa para recusar conversa em sessão encerrada
  (`AGENTES_CONVERSACIONAIS` em
  `apps/api/src/domain/sessions/conversa-em-sessao-encerrada.ts`), escrita
  aqui pela chave do registro — que para o Infra Lead é `infra`, o mesmo id
  de ator que ele grava.

  O `ToolLoop` de dev agents, QA e SecOps NÃO entra: não são processos por
  sessão, e a sessão de execução não fecha com eles pendurados (os sinais de
  trabalho pendente da RN-064).
  """

  require Logger

  @prefixos ~w(criativo po arquiteto dev-lead ux-designer staff infra)

  # Quanto `parar_da_sessao/1` espera um conversacional sair antes de matá-lo.
  # O Infra Lead roda o turno DENTRO do `handle_call` — o `stop` só é atendido
  # quando o turno acaba, e esperar um turno de LLM inteiro (minutos) para
  # parar um agente de uma sessão que já fechou é o defeito, não a cura.
  @espera_ms 5_000

  @doc "As chaves de registro dos conversacionais, na ordem da lista."
  def prefixos, do: @prefixos

  @doc """
  Para, NESTE nó, todo conversacional vivo da sessão. Devolve os prefixos dos
  que ESTA chamada parou — nunca o de uma entrada velha do Registry —, para o
  log dizer quem.

  O turno em curso morre junto: os servidores que usam `TurnoAssincrono`
  abandonam a task no `terminate/2` (sem gravar nada — a sessão já não
  aceita), e o Infra Lead, que não usa, é morto se não sair em
  #{@espera_ms}ms.
  """
  @spec parar_da_sessao(String.t()) :: [String.t()]
  def parar_da_sessao(session_id) do
    # A lista é de quem ESTE `stop` parou, e não de quem tinha chave no
    # Registry (AT-204). A limpeza do Registry é ASSÍNCRONA — a partição apaga a
    # chave quando recebe o EXIT —, então o lookup pode devolver um pid que já
    # tinha morto, e o log do fechamento diria que parou quem já não estava lá.
    for prefixo <- @prefixos,
        [{pid, _}] <- [Registry.lookup(Engine.Sessions.Registry, prefixo <> ":" <> session_id)],
        parar(pid) == :parado do
      prefixo
    end
  end

  @doc """
  `parar_da_sessao/1` em TODOS os nós do cluster. O registro é local, e o job
  do Oban que roda o fechamento pode cair em qualquer réplica — com lookup só
  local, o mesmo defeito que `SessionLifecycleWorker` já corrigiu para o
  `SessionServer` (`:global`) voltaria por aqui. Nó que não responde é
  registrado no log e não impede os outros.
  """
  @spec parar_da_sessao_no_cluster(String.t()) :: [String.t()]
  def parar_da_sessao_no_cluster(session_id) do
    nos = [node() | Node.list()]

    nos
    |> :erpc.multicall(__MODULE__, :parar_da_sessao, [session_id], @espera_ms * 2)
    |> Enum.zip(nos)
    |> Enum.flat_map(fn
      {{:ok, parados}, _no} ->
        parados

      {erro, no} ->
        Logger.warning(
          "sessão #{session_id}: não consegui parar os conversacionais no nó " <>
            "#{inspect(no)} (#{inspect(erro)})"
        )

        []
    end)
  end

  # `:parado` quando FOI este `stop` que o encerrou (ou o `kill` depois do
  # teto); `:ja_tinha_saido` quando o processo já não estava lá — uma entrada
  # velha do Registry, ou uma saída entre o lookup e o stop. As duas deixam a
  # sessão sem o agente, que é o desfecho pedido; só a primeira entra na lista.
  defp parar(pid) do
    GenServer.stop(pid, {:shutdown, :sessao_encerrada}, @espera_ms)
    :parado
  catch
    :exit, {:noproc, _} ->
      :ja_tinha_saido

    :exit, {:normal, _} ->
      :ja_tinha_saido

    :exit, {:timeout, _} ->
      Process.exit(pid, :kill)
      :parado
  end
end
