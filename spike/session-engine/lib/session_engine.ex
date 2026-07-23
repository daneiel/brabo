defmodule SessionEngine do
  @moduledoc """
  Facade pública do spike de motor de sessões (OTP puro).
  """

  @doc "Cria uma sessão supervisionada e monitorada."
  defdelegate start_session(session_id), to: SessionEngine.SessionSupervisor

  @doc "Cria um processo agente associado a uma sessão."
  def start_agent(name, session_pid), do: SessionEngine.Agent.start(name, session_pid)
end
