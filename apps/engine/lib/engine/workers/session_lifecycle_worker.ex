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
  alias Engine.Telemetry.Span

  @impl true
  def perform(%Oban.Job{
        args: %{"event_type" => event_type, "aggregate_id" => session_id} = args
      })
      when event_type in ["session.closed", "session.closed_abnormally"] do
    # `session_id` em toda linha de log deste job (ADR 0035). O
    # `JsonLogFormatter` lê `meta[:session_id]` desde a Fase 5, e o campo sempre
    # saiu ausente porque `Logger.metadata/1` não era chamado em lugar nenhum do
    # engine.
    Logger.metadata(session_id: session_id)

    # Pendura o trabalho na trace da sessão, usando o `traceparent` que a api
    # gravou no metadado do evento. `with_session/4` trata nil como "sem parent
    # remoto, abre trace própria", então evento antigo (pré-Fase 5) segue
    # funcionando.
    Span.with_session(
      args["traceparent"],
      "outbox.session_lifecycle",
      %{"brabo.session_id" => session_id, "brabo.event_type" => event_type},
      fn -> encerrar(session_id) end
    )
  end

  # Catch-all: outros event_type futuros de aggregate_type "session" não
  # falham/retry infinito num desconhecido.
  def perform(%Oban.Job{}), do: :ok

  # Busca em `:global`: o job do Oban pode ser executado por qualquer réplica,
  # e não necessariamente pela que hospeda a sessão. Com lookup local, um job
  # sorteado para o nó "errado" não achava o processo e retornava :ok — a
  # sessão seguia rodando depois de a api já a ter encerrado.
  defp encerrar(session_id) do
    case SessionServer.whereis(session_id) do
      pid when is_pid(pid) ->
        :ok = Monitor.expect_stop(session_id)
        SessionServer.stop(pid)
        :ok

      nil ->
        :ok
    end
  end
end
