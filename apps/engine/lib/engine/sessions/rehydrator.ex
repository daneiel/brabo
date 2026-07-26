defmodule Engine.Sessions.Rehydrator do
  @moduledoc """
  Boot task: recria todo processo registrado em session_states que ainda não
  tenha dono no cluster.

  Matar o container do engine mata o Monitor junto — nenhum :DOWN é
  processado durante a queda, então a única rede de segurança possível é
  este passo no boot seguinte. Cada processo recriado sobe com um
  heartbeat timer novo (SessionServer.init/1); se ninguém reconectar
  dentro do timeout, fecha sozinho com causa "heartbeat_timeout" — isso
  sozinho já cumpre "reidratada OU encerrada com causa correta, nunca
  órfã", sem precisar de nenhuma chamada de rede síncrona no boot pra
  reconciliar com a api antes.

  ## Por que esperar o cluster antes de reidratar (Fase 5, sessão 3)

  Com o nome da sessão em `:global`, reidratar antes de o cluster Erlang
  formar é ativamente destrutivo, e o modo de falha é surpreendente:

  1. num rollout (`maxSurge: 1`), o pod NOVO sobe enquanto o antigo ainda
     hospeda as sessões;
  2. se ele reidratar antes de enxergar o pod antigo, `:global.whereis_name`
     devolve `:undefined` e ele cria uma SEGUNDA cópia de cada sessão;
  3. quando os dois nós se conectam, o `:global` resolve o conflito de nome
     com o resolvedor default `random_exit_name`, que **mata um dos dois
     processos com `exit(pid, :kill)`**;
  4. o `Monitor` do nó perdedor vê `:killed`, reporta `closed_abnormally` com
     causa `"killed"` — e o pod antigo, que perdeu suas sessões para o
     sorteio, não tem mais nada para drenar no `preStop`.

  Foi exatamente isso que aconteceu: o drain funcionava perfeitamente quando
  chamado à mão e não drenava nada durante um rollout de verdade.

  Esperar é barato porque só acontece quando há sessão para reidratar: num
  boot com a tabela vazia (o caso comum) não há espera nenhuma.
  """

  require Logger

  alias Engine.Readiness
  alias Engine.Sessions.{SessionState, SessionSupervisor}

  # Teto da espera pelo cluster. O DNSCluster consulta o DNS periodicamente,
  # então "conectado" leva alguns segundos. O startupProbe do engine tolera
  # ~120s, então este teto é folgado.
  @cluster_wait_ms 15_000
  @cluster_poll_ms 500

  def run do
    sessions = SessionState.list_non_terminal()

    if sessions != [] do
      wait_for_cluster()
    end

    Enum.each(sessions, fn s -> SessionSupervisor.start_session(s.session_id, s.project_id) end)

    # O readiness probe do Kubernetes só libera tráfego depois disto: aceitar
    # heartbeat de alguém reconectando antes da sessão existir de novo é
    # exatamente o que a ordem da árvore de supervisão evita, e o probe
    # precisa de um sinal para afirmar o mesmo.
    Readiness.mark(:sessions)
  end

  # Só espera se houver um cluster para formar. Sem `DNS_CLUSTER_QUERY`
  # (desenvolvimento, compose, teste) o nó é sozinho por definição e esperar
  # seria atraso puro.
  defp wait_for_cluster do
    if Application.get_env(:engine, :dns_cluster_query) do
      deadline = System.monotonic_time(:millisecond) + @cluster_wait_ms
      do_wait(deadline)
    else
      :ok
    end
  end

  defp do_wait(deadline) do
    cond do
      Node.list() != [] ->
        # `Node.list/0` não-vazio diz que os nós estão CONECTADOS, não que o
        # `:global` já trocou as tabelas de nomes — e é essa janela que
        # importa: durante ela `:global.whereis_name/1` devolve `:undefined`
        # para nomes que existem no outro nó, o pod novo conclui que a sessão
        # não tem dono, cria uma segunda cópia, e quando a sincronização
        # termina o `:global` resolve o conflito matando uma das duas.
        #
        # Era exatamente este o defeito: o pod novo roubava (e matava) as
        # sessões do antigo, que então chegava no `preStop` sem nada local
        # para drenar — `total: 0` — enquanto a api registrava `killed`.
        :global.sync()
        Logger.info("rehydrator: cluster sincronizado com #{length(Node.list())} par(es)")
        :ok

      System.monotonic_time(:millisecond) >= deadline ->
        # Nó realmente sozinho (primeira réplica, scale-up a partir de zero).
        # Reidratar aqui é o certo: não há quem já seja dono.
        Logger.info("rehydrator: nenhum par apareceu, reidratando como nó único")
        :ok

      true ->
        Process.sleep(@cluster_poll_ms)
        do_wait(deadline)
    end
  end

  @doc "Idioma de boot task: roda o trabalho e retorna :ignore — não vira processo persistente."
  def start_link(_opts) do
    :ok = run()
    :ignore
  end

  def child_spec(_opts) do
    %{id: __MODULE__, start: {__MODULE__, :start_link, [[]]}}
  end
end
