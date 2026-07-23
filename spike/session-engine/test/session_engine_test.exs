defmodule SessionEngineTest do
  use ExUnit.Case

  test "cria uma sessão supervisionada e monitorada" do
    {:ok, pid} = SessionEngine.start_session("sessao-teste")
    assert Process.alive?(pid)
    SessionEngine.SessionServer.log(pid, :teste, "olá")
    assert [{1, :teste, "olá"}] = SessionEngine.SessionServer.get_log(pid)
  end
end
