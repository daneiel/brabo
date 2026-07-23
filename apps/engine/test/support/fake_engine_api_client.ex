defmodule Engine.Sessions.FakeEngineApiClient do
  @moduledoc """
  Fake de teste pra Engine.Sessions.EngineApiClient — sem Mox, sem Agent:
  só um `send/2` pro pid de teste registrado via `Application.get_env(:engine, :test_pid)`.
  """

  @behaviour Engine.Sessions.EngineApiClient

  @impl true
  def report_termination(project_id, session_id, reason) do
    if pid = Application.get_env(:engine, :test_pid) do
      send(pid, {:termination_reported, project_id, session_id, reason})
    end

    :ok
  end
end
