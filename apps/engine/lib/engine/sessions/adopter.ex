defmodule Engine.Sessions.Adopter do
  @moduledoc """
  Adota sessões sem dono (Fase 5, item 4).

  ## O buraco que isto fecha

  O `Engine.Shutdown.drain/0` cobre o desligamento educado: o `preStop` roda,
  as sessões são oferecidas a um par e as não adotadas são encerradas com causa
  conhecida. Ele **não** cobre a réplica que some sem aviso — `kill -9`,
  OOMKill, nó evictado, perda de rede.

  Nesse caso o nome `:global` é liberado automaticamente quando o nó cai, mas a
  linha em `session_states` sobrevive e **ninguém a reidrata**: a reidratação só
  acontece no boot, e os pods que já estavam de pé não vão reiniciar. A sessão
  fica `active` na api, sem processo em lugar nenhum — a definição exata de
  sessão órfã que o item 4 quer eliminar.

  A varredura é barata (uma consulta e um `:global.whereis_name` por linha) e
  idempotente: `SessionSupervisor.start_session/2` deduplica pelo nome global,
  então N réplicas varrendo ao mesmo tempo produzem um dono só.

  Uma sessão adotada sobe com timer de heartbeat novo. Se ninguém reconectar,
  ela fecha sozinha por `heartbeat_timeout` — que é o desfecho correto e já
  existente, não uma sessão pendurada.
  """

  require Logger

  alias Engine.Sessions.{SessionServer, SessionState, SessionSupervisor}
  alias Engine.Readiness

  @doc """
  Assume toda sessão de `session_states` que não tenha dono vivo no cluster.
  Devolve os ids adotados.
  """
  def run do
    # Um nó que está drenando não deve adotar nada: ele acabou de soltar as
    # próprias sessões e está a segundos de morrer.
    if Readiness.shutting_down?() do
      []
    else
      # Mesma armadilha do Rehydrator: sem sincronizar, `whereis_name` pode
      # dizer que uma sessão viva em outro nó não tem dono, e a "adoção"
      # criaria uma segunda cópia que o `:global` resolveria matando uma das
      # duas. Barato: quando já sincronizado, retorna de imediato.
      if Node.list() != [], do: :global.sync()

      adopted =
        SessionState.list_non_terminal()
        |> Enum.reject(&SessionServer.whereis(&1.session_id))
        |> Enum.flat_map(&adopt/1)

      if adopted != [] do
        Logger.info("adopter: #{length(adopted)} sessão(ões) órfã(s) adotada(s)")
      end

      adopted
    end
  end

  # `start_session/2` só devolve `{:ok, pid}` — o que pode dar errado aqui é
  # levantar (banco fora, corrida com um nó que morreu no meio). Uma sessão que
  # falha não pode interromper a adoção das outras.
  defp adopt(state) do
    {:ok, _pid} = SessionSupervisor.start_session(state.session_id, state.project_id)
    [state.session_id]
  rescue
    e ->
      Logger.warning("adopter: erro ao adotar #{state.session_id}: #{Exception.message(e)}")
      []
  catch
    kind, reason ->
      Logger.warning(
        "adopter: erro ao adotar #{state.session_id}: #{inspect(kind)} #{inspect(reason)}"
      )

      []
  end
end
