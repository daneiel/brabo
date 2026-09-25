defmodule EngineWeb.SessionCommandController do
  @moduledoc """
  Recebe o comando síncrono da api pra criar um processo de sessão
  supervisionado — substitui o antigo consumo de session.created via
  outbox (ver Engine.Sessions.SessionSupervisor.start_session/2).
  """

  use EngineWeb, :controller

  alias Engine.Readiness

  def create(conn, %{"sessionId" => session_id, "projectId" => project_id} = params) do
    # "Para de aceitar novas sessões" (Fase 5, item 4a). O readiness já tirou o
    # pod dos Endpoints, mas isso não é instantâneo: o kube-proxy leva alguns
    # segundos para propagar, e nessa janela a api ainda pode acertar este pod.
    # Recusar aqui com 503 faz a api falhar a ativação em vez de criar uma
    # sessão numa réplica que está indo embora — e `TransitionSessionUseCase`
    # chama o engine ANTES de persistir `active`, então a sessão simplesmente
    # não é ativada, em vez de nascer órfã.
    if Readiness.shutting_down?() do
      conn
      |> put_status(:service_unavailable)
      |> json(%{error: "engine em desligamento", retryable: true})
    else
      # `traceParent` é opcional: uma api mais antiga (rolling deploy) não o
      # manda, e a sessão simplesmente não fica vinculada a uma trace.
      {:ok, _pid} =
        Engine.Sessions.SessionSupervisor.start_session(
          session_id,
          project_id,
          Map.get(params, "traceParent")
        )

      send_resp(conn, 201, "")
    end
  end

  @doc """
  AT-157 (RN-579): a api gravou um evento por conta própria (decisão humana em
  outra aba, transição de sessão, chat direto) e pede o MESMO aviso que a
  fachada `EngineApiClient` emite para as escritas do engine. Só `type` e
  `actorId` atravessam, nunca o payload; o canal é gatilho e o GET continua
  sendo a fonte. Sem ninguém inscrito o broadcast é um no-op, então a rota não
  precisa saber se a sessão vive neste nó.
  """
  def event_appended(conn, %{"sessionId" => session_id, "type" => type} = params)
      when is_binary(session_id) and is_binary(type) and type != "" do
    actor_id = if is_binary(params["actorId"]), do: params["actorId"], else: nil
    Engine.Sessions.LiveBroadcast.event_appended(session_id, type, actor_id)
    send_resp(conn, 204, "")
  end

  def event_appended(conn, _params) do
    conn
    |> put_status(:bad_request)
    |> json(%{error: "type é obrigatório"})
  end
end
