defmodule SessionEngine.Application do
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    children = [
      SessionEngine.PsychologistMonitor,
      SessionEngine.SessionSupervisor
    ]

    Supervisor.start_link(children, strategy: :one_for_one, name: SessionEngine.Supervisor)
  end
end
