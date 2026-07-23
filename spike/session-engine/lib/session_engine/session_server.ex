defmodule SessionEngine.SessionServer do
  @moduledoc """
  Um processo por sessão. Guarda em memória o log de interações
  (mensagens entre agentes, eventos de sistema etc).

  Enquanto vivo, o processo É a fonte da verdade do log. Mas se ele
  morrer (crash ou kill), seu estado desaparece com ele — por isso
  cada `log/3` também espelha a entrada no PsychologistMonitor
  (veja `SessionEngine.PsychologistMonitor.sync_log/3`), que é quem
  consegue mostrar o log mesmo depois da morte do processo.
  """

  use GenServer, restart: :temporary

  # --- API pública ---

  def start_link(session_id) do
    GenServer.start_link(__MODULE__, session_id)
  end

  def log(pid, from, message) do
    GenServer.cast(pid, {:log, from, message})
  end

  def get_log(pid) do
    GenServer.call(pid, :get_log)
  end

  @doc "Provoca um crash real (raise) dentro do processo da sessão."
  def crash(pid) do
    GenServer.cast(pid, :crash)
  end

  @doc "Encerra a sessão normalmente."
  def stop(pid) do
    GenServer.stop(pid, :normal)
  end

  # --- Callbacks ---

  @impl true
  def init(session_id) do
    {:ok, %{id: session_id, log: [], seq: 0}}
  end

  @impl true
  def handle_cast({:log, from, message}, state) do
    seq = state.seq + 1
    log = state.log ++ [{seq, from, message}]
    SessionEngine.PsychologistMonitor.sync_log(self(), state.id, log)
    {:noreply, %{state | log: log, seq: seq}}
  end

  def handle_cast(:crash, state) do
    raise "falha simulada na sessão #{state.id}: erro inesperado no processamento do agente"
  end

  @impl true
  def handle_call(:get_log, _from, state) do
    {:reply, state.log, state}
  end

  # NOTA: terminate/2 é chamado para :normal e para crash (raise), mas
  # NUNCA para Process.exit(pid, :kill) — esse sinal não é interceptável
  # em nenhum nível, nem pelo próprio GenServer. É a prova viva de por
  # que o log precisa estar espelhado fora deste processo.
  @impl true
  def terminate(reason, state) do
    IO.puts(
      "  [SessionServer #{state.id}] terminate/2 executado (reason=#{inspect(reason)}) " <>
        "— isto NUNCA aparece quando a causa é :kill"
    )

    :ok
  end
end
