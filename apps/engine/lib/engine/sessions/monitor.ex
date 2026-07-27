defmodule Engine.Sessions.Monitor do
  @moduledoc """
  Observa cada SessionServer via Process.monitor/1 (não link — uma sessão
  morta não deve derrubar o resto do engine) e decide, ao receber :DOWN,
  se um callback HTTP pra api é necessário.

  Sem mirror de log: o event log vive em Postgres (api), diferente do
  spike que provou este padrão — aqui só guardamos metadado de supervisão.
  """

  use GenServer

  require Logger

  alias Engine.Sessions.SessionState

  @name __MODULE__

  def start_link(_opts) do
    GenServer.start_link(__MODULE__, %{by_pid: %{}, by_session: %{}}, name: @name)
  end

  def watch(pid, session_id, project_id) do
    GenServer.call(@name, {:watch, pid, session_id, project_id})
  end

  @doc """
  Chamado pelo SessionLifecycleWorker ANTES de parar uma sessão cuja causa
  a api já conhece (consumiu session.closed/session.closed_abnormally via
  outbox) — evita o callback HTTP redundante.
  """
  def expect_stop(session_id), do: GenServer.call(@name, {:expect_stop, session_id})

  @impl true
  def init(state), do: {:ok, state}

  @impl true
  def handle_call({:watch, pid, session_id, project_id}, _from, state) do
    ref = Process.monitor(pid)
    entry = %{ref: ref, session_id: session_id, project_id: project_id, expect_stop: false}

    state = %{
      state
      | by_pid: Map.put(state.by_pid, pid, entry),
        by_session: Map.put(state.by_session, session_id, pid)
    }

    {:reply, :ok, state}
  end

  def handle_call({:expect_stop, session_id}, _from, state) do
    state =
      case Map.fetch(state.by_session, session_id) do
        {:ok, pid} -> put_in(state.by_pid[pid].expect_stop, true)
        :error -> state
      end

    {:reply, :ok, state}
  end

  @impl true
  def handle_info({:DOWN, ref, :process, pid, reason}, state) do
    case Map.fetch(state.by_pid, pid) do
      {:ok, %{ref: ^ref} = entry} ->
        # Nó descendo (SIGTERM, rollout, scale-down do HPA) não é término de
        # sessão: a linha PRECISA sobreviver, é dela que a reidratação do
        # próximo boot parte. O Engine.Dev.Monitor já fazia essa distinção;
        # aqui ela faltava, e o efeito era o oposto do desejado — como a
        # ordem de shutdown da árvore derruba o SessionSupervisor ANTES deste
        # Monitor, ele ficava vivo para processar cada :DOWN, apagar toda
        # sessão ativa e ainda reportá-la à api como closed_abnormally. Um
        # rollout marcava como anormal exatamente as sessões que estavam
        # saudáveis.
        unless node_shutdown?(reason) do
          safe_delete(entry.session_id)
          maybe_report(entry, reason)
        end

        state = %{
          state
          | by_pid: Map.delete(state.by_pid, pid),
            by_session: Map.delete(state.by_session, entry.session_id)
        }

        {:noreply, state}

      _ ->
        {:noreply, state}
    end
  end

  # Este Monitor é um SINGLETON: se ele morre, o engine perde de uma vez o
  # monitoramento de todas as sessões vivas (os monitores morrem com ele) e
  # nenhum término posterior vira callback pra api. Uma indisponibilidade do
  # banco não pode ter esse efeito — o :DOWN já foi consumido de qualquer
  # forma, então registra e segue.
  defp safe_delete(session_id) do
    SessionState.delete(session_id)
  rescue
    e ->
      Logger.warning("Monitor: falha ao apagar session_state #{session_id}: #{inspect(e)}")
  catch
    :exit, reason ->
      Logger.warning("Monitor: falha ao apagar session_state #{session_id}: #{inspect(reason)}")
  end

  # :normal precedido de expect_stop -> api já sabe, sem callback.
  # :killed, crash, heartbeat_timeout, ou :normal SEM expect_stop
  # (defensivo) -> reporta, com o destino de transição que cada causa
  # implica.
  defp maybe_report(%{expect_stop: true}, :normal), do: :ok

  defp maybe_report(entry, reason) do
    {reason_string, to} = classify(reason)

    # O contexto do OTel vive no dicionário do PROCESSO, e a task nasce com o
    # dicionário vazio: sem capturar aqui e reanexar lá dentro, o relato de
    # término viraria uma trace órfã — justamente o span que se procura quando
    # uma sessão morreu de forma estranha.
    otel_ctx = Engine.Telemetry.Span.capture()

    Task.Supervisor.start_child(Engine.TaskSupervisor, fn ->
      Engine.Telemetry.Span.attach(otel_ctx)
      client().report_termination(entry.project_id, entry.session_id, reason_string, to)
    end)
  end

  defp client do
    Application.get_env(:engine, :engine_api_client, Engine.Sessions.EngineApiClient.Live)
  end

  # heartbeat_timeout é um jeito normal de uma sessão terminar (ninguém
  # do outro lado) — não é uma falha do engine, então vira "closed" (via
  # o hop implícito active->closing que a api resolve do lado dela), não
  # "closed_abnormally" como as outras causas.
  defp classify({:shutdown, :heartbeat_timeout}), do: {"heartbeat_timeout", "closed"}
  defp classify(:normal), do: {"normal", "closed_abnormally"}
  defp classify(:killed), do: {"killed", "closed_abnormally"}

  defp classify({error, _stacktrace}) when is_exception(error),
    do: {Exception.message(error), "closed_abnormally"}

  defp classify(other), do: {inspect(other), "closed_abnormally"}

  # `:shutdown` puro é o supervisor derrubando o filho porque o NÓ está
  # parando. `{:shutdown, :heartbeat_timeout}` é o oposto: a sessão terminou
  # sozinha e a linha tem que sair, senão ela reidrata para sempre. Por isso
  # não dá pra copiar o `forget?({:shutdown, _})` do Engine.Dev.Monitor
  # literalmente — lá não existe uma causa de término que viaje dentro de
  # `:shutdown`.
  defp node_shutdown?(:shutdown), do: true
  defp node_shutdown?({:shutdown, :shutdown}), do: true
  defp node_shutdown?(_), do: false
end
