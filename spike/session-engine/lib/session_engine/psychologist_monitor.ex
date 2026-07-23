defmodule SessionEngine.PsychologistMonitor do
  @moduledoc """
  Observa toda sessão criada via `Process.monitor/1` e, ao receber
  `:DOWN`, imprime a causa da morte e o último log conhecido da
  sessão.

  Mantém uma cópia espelhada do log de cada sessão (atualizada via
  `sync_log/3` a cada interação) porque, no momento em que o `:DOWN`
  chega, o processo da sessão já não existe mais — não há nada para
  perguntar. Isso é especialmente crítico para `:kill`, onde nem
  `terminate/2` roda no processo morto.
  """

  use GenServer

  @name __MODULE__

  # --- API pública ---

  def start_link(_opts) do
    GenServer.start_link(__MODULE__, %{}, name: @name)
  end

  @doc "Chamado pelo SessionSupervisor logo após criar uma sessão."
  def watch(session_pid, session_id) do
    GenServer.call(@name, {:watch, session_pid, session_id})
  end

  @doc "Chamado pelo SessionServer a cada interação registrada."
  def sync_log(session_pid, session_id, log) do
    GenServer.cast(@name, {:sync_log, session_pid, session_id, log})
  end

  # --- Callbacks ---

  @impl true
  def init(_), do: {:ok, %{}}

  @impl true
  def handle_call({:watch, session_pid, session_id}, _from, state) do
    ref = Process.monitor(session_pid)
    entry = %{ref: ref, id: session_id, log: []}
    {:reply, :ok, Map.put(state, session_pid, entry)}
  end

  @impl true
  def handle_cast({:sync_log, session_pid, _session_id, log}, state) do
    state =
      case Map.fetch(state, session_pid) do
        {:ok, entry} -> Map.put(state, session_pid, %{entry | log: log})
        :error -> state
      end

    {:noreply, state}
  end

  @impl true
  def handle_info({:DOWN, ref, :process, pid, reason}, state) do
    case Map.fetch(state, pid) do
      {:ok, %{ref: ^ref, id: id, log: log}} ->
        report(id, pid, reason, log)
        {:noreply, Map.delete(state, pid)}

      _ ->
        {:noreply, state}
    end
  end

  defp report(id, pid, reason, log) do
    IO.puts("\n" <> String.duplicate("=", 64))
    IO.puts("[PsychologistMonitor] sessão \"#{id}\" (#{inspect(pid)}) terminou")
    IO.puts("  causa: #{format_reason(reason)}")
    IO.puts("  log capturado (#{length(log)} entradas):")

    Enum.each(log, fn {seq, from, message} ->
      IO.puts("    ##{seq} [#{from}] #{message}")
    end)

    IO.puts(String.duplicate("=", 64))
  end

  defp format_reason(:normal) do
    ":normal — encerramento intencional (GenServer.stop/2), terminate/2 rodou"
  end

  defp format_reason(:killed) do
    ":killed — Process.exit(pid, :kill), sinal não interceptável, terminate/2 NÃO rodou"
  end

  defp format_reason({error, _stacktrace}) when is_exception(error) do
    "crash — #{inspect(error.__struct__)}: #{Exception.message(error)} (terminate/2 rodou antes de propagar)"
  end

  defp format_reason(other), do: inspect(other)
end
