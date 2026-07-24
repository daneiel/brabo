defmodule Engine.Sessions.FakeEngineApiClient do
  @moduledoc """
  Fake de teste pra Engine.Sessions.EngineApiClient — sem Mox, sem Agent:
  só um `send/2` pro pid de teste registrado via `Application.get_env(:engine, :test_pid)`.
  """

  @behaviour Engine.Sessions.EngineApiClient

  @impl true
  def report_termination(project_id, session_id, reason, to) do
    if pid = Application.get_env(:engine, :test_pid) do
      send(pid, {:termination_reported, project_id, session_id, reason, to})
    end

    :ok
  end

  @impl true
  def append_event(project_id, session_id, event) do
    if pid = Application.get_env(:engine, :test_pid) do
      send(pid, {:event_appended, project_id, session_id, event})
    end

    :ok
  end
end
