defmodule Engine.Workers.SessionLifecycleWorker do
  @moduledoc """
  Processa eventos de ciclo de vida de sessão consumidos da outbox da api
  (aggregate_type = "session") por Engine.Outbox.Drain. session.created
  NÃO é mais tratado aqui — a criação do processo agora é um comando
  síncrono da api (POST /internal/sessions, ver
  EngineWeb.SessionCommandController); este worker só para um processo
  ainda rodando quando a api já sabe do encerramento.
  """

  use Oban.Worker, queue: :default, max_attempts: 5

  alias Engine.Sessions.{Monitor, SessionServer}

  @impl true
  def perform(%Oban.Job{args: %{"event_type" => event_type, "aggregate_id" => session_id}})
      when event_type in ["session.closed", "session.closed_abnormally"] do
    # Busca em `:global`: o job do Oban pode ser executado por qualquer réplica,
    # e não necessariamente pela que hospeda a sessão. Com lookup local, um job
    # sorteado para o nó "errado" não achava o processo e retornava :ok — a
    # sessão seguia rodando depois de a api já a ter encerrado.
    case SessionServer.whereis(session_id) do
      pid when is_pid(pid) ->
        :ok = Monitor.expect_stop(session_id)
        SessionServer.stop(pid)
        :ok

      nil ->
        :ok
    end
  end

  # Catch-all: outros event_type futuros de aggregate_type "session" não
  # falham/retry infinito num desconhecido.
  def perform(%Oban.Job{}), do: :ok
end
