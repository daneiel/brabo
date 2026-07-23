defmodule SessionEngine.Agent do
  @moduledoc """
  Processo "agente" mínimo (spawn puro, sem GenServer). Troca
  mensagens com um par dentro de uma sessão e registra cada
  envio/recebimento no SessionServer correspondente.
  """

  def start(name, session_pid) do
    spawn(fn -> loop(name, session_pid, nil) end)
  end

  def set_peer(agent_pid, peer_pid) do
    send(agent_pid, {:set_peer, peer_pid})
  end

  def send_message(agent_pid, content) do
    send(agent_pid, {:send, content})
  end

  defp loop(name, session_pid, peer) do
    receive do
      {:set_peer, peer_pid} ->
        loop(name, session_pid, peer_pid)

      {:send, content} ->
        SessionEngine.SessionServer.log(session_pid, name, "enviou: #{content}")
        if peer, do: send(peer, {:incoming, name, content})
        loop(name, session_pid, peer)

      {:incoming, from_name, content} ->
        SessionEngine.SessionServer.log(session_pid, name, "recebeu de #{from_name}: #{content}")
        loop(name, session_pid, peer)
    end
  end
end
