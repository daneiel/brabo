defmodule Engine.Sessions.SessionServer do
  @moduledoc """
  Runtime de UMA sessão ativa, supervisionado. O event log de domínio
  vive em Postgres do lado da api (session_events), não neste processo —
  este módulo só supervisiona + detecta término (crash/kill/normal/
  heartbeat_timeout) e persiste o próprio estado em session_states pra
  sobreviver a restart do nó (ver Engine.Sessions.Rehydrator).
  """

  use GenServer, restart: :temporary

  alias Engine.Sessions.SessionState

  def start_link({session_id, project_id}) do
    start_link({session_id, project_id, nil})
  end

  def start_link({session_id, project_id, trace_parent}) do
    GenServer.start_link(__MODULE__, {session_id, project_id, trace_parent},
      name: via(session_id)
    )
  end

  @doc """
  Nome do processo, registrado em `:global` — não num `Registry` local (Fase 5).

  Enquanto o engine era uma réplica só, `Registry` e "único no cluster" eram a
  mesma coisa. Com o HPA da Fase 5 deixaram de ser, e o efeito era destrutivo:
  o `Rehydrator` recria no boot um SessionServer para TODA linha de
  `session_states`, que é uma tabela global. Com N réplicas, cada sessão passava
  a existir N vezes; o websocket do browser chega em UMA (o Service balanceia),
  e as outras N-1 cópias nunca recebiam `ping` — estouravam o heartbeat e
  mandavam a api fechar uma sessão que estava viva em outro pod.

  `:global` resolve os dois lados de uma vez: `start_session/2` passa a
  deduplicar entre nós, e `heartbeat/1` alcança o dono onde quer que ele
  esteja, então o websocket pode cair em qualquer réplica.
  """
  def via(session_id), do: {:global, {:brabo_session, session_id}}

  @doc "pid do dono da sessão em qualquer nó do cluster, ou nil."
  def whereis(session_id) do
    case :global.whereis_name({:brabo_session, session_id}) do
      :undefined -> nil
      pid -> pid
    end
  end

  def stop(pid), do: GenServer.stop(pid, :normal)

  @doc "Hook de teste/ops: provoca um crash real (raise) dentro do processo."
  def crash(pid), do: GenServer.cast(pid, :crash)

  @doc "Chamado pelo SessionChannel a cada ping — reseta o timer de heartbeat."
  def heartbeat(session_id) do
    GenServer.call(via(session_id), :heartbeat)
  end

  @impl true
  def init({session_id, project_id}), do: init({session_id, project_id, nil})

  def init({session_id, project_id, trace_parent}) do
    SessionState.upsert_active!(session_id, project_id, trace_parent)
    heartbeat_ref = schedule_heartbeat_timeout()

    {:ok,
     %{
       session_id: session_id,
       project_id: project_id,
       heartbeat_ref: heartbeat_ref
     }}
  end

  @impl true
  def handle_call(:heartbeat, _from, state) do
    Process.cancel_timer(state.heartbeat_ref)
    {:reply, :ok, %{state | heartbeat_ref: schedule_heartbeat_timeout()}}
  end

  @impl true
  def handle_cast(:crash, state) do
    raise "crash simulado da sessão #{state.session_id} (hook de teste/ops)"
  end

  @impl true
  def handle_info(:heartbeat_timeout, state) do
    SessionState.mark_closing!(state.session_id, "heartbeat_timeout")
    # {:shutdown, reason} em vez do átomo cru — é um encerramento
    # sancionado (ninguém do outro lado), não um crash; evita o log de
    # erro padrão do OTP que um :stop com razão arbitrária geraria.
    {:stop, {:shutdown, :heartbeat_timeout}, state}
  end

  defp schedule_heartbeat_timeout do
    Process.send_after(self(), :heartbeat_timeout, heartbeat_timeout_ms())
  end

  defp heartbeat_timeout_ms do
    Application.get_env(:engine, :session_heartbeat_timeout_ms, 30_000)
  end
end
