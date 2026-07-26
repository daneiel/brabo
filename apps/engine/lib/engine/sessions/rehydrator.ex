defmodule Engine.Sessions.Rehydrator do
  @moduledoc """
  Boot task: recria otimista e incondicionalmente todo processo
  registrado em session_states (sobrevivente de um boot anterior).

  Matar o container do engine mata o Monitor junto — nenhum :DOWN é
  processado durante a queda, então a única rede de segurança possível é
  este passo no boot seguinte. Cada processo recriado sobe com um
  heartbeat timer novo (SessionServer.init/1); se ninguém reconectar
  dentro do timeout, fecha sozinho com causa "heartbeat_timeout" — isso
  sozinho já cumpre "reidratada OU encerrada com causa correta, nunca
  órfã", sem precisar de nenhuma chamada de rede síncrona no boot pra
  reconciliar com a api antes.
  """

  alias Engine.Readiness
  alias Engine.Sessions.{SessionState, SessionSupervisor}

  def run do
    SessionState.list_non_terminal()
    |> Enum.each(fn s -> SessionSupervisor.start_session(s.session_id, s.project_id) end)

    # O readiness probe do Kubernetes só libera tráfego depois disto: aceitar
    # heartbeat de alguém reconectando antes da sessão existir de novo é
    # exatamente o que a ordem da árvore de supervisão evita, e o probe
    # precisa de um sinal para afirmar o mesmo.
    Readiness.mark(:sessions)
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
