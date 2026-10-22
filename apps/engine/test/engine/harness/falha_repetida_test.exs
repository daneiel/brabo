defmodule Engine.Harness.FalhaRepetidaTest do
  @moduledoc "RN-913 (AT-588): falha igual repetida no turno corrige na 2ª e para na 3ª."

  use Engine.DataCase, async: false

  alias Engine.Harness.{ArgumentosDeFerramenta, FalhaRepetida, ToolLoop}
  alias Engine.Sessions.FakeEngineApiClient

  defmodule Falha do
    @behaviour Engine.Harness.Tool
    @impl true
    def spec,
      do: %{
        name: "falha",
        description: "falha",
        parameters: %{"type" => "object", "properties" => %{}}
      }

    @impl true
    def category, do: :direct
    @impl true
    def run(_args, _ctx), do: {:error, "sempre falha"}
  end

  setup do
    Application.put_env(:engine, :falha_repetida_parar_em, 3)
    Application.put_env(:engine, :project_workspaces_root, System.tmp_dir!())
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())
    FalhaRepetida.zerar()

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
      Application.put_env(:engine, :falha_repetida_parar_em, 1_000)
      Application.delete_env(:engine, :test_pid)
    end)
  end

  defp falhar(args),
    do: ArgumentosDeFerramenta.executar("falha", args, nil, fn _ -> {:error, "ruim"} end)

  test "a 2ª falha igual leva a correção; a 1ª não" do
    assert {:error, "ruim"} = falhar(%{"a" => 1})
    assert {:error, msg} = falhar(%{"a" => 1})
    assert msg =~ "CORREÇÃO"
    refute FalhaRepetida.parou?()
  end

  test "falhas diferentes não somam" do
    for i <- 1..5, do: assert({:error, "ruim"} = falhar(%{"a" => i}))
    refute FalhaRepetida.parou?()
  end

  test "a 3ª falha igual marca a parada e o contador zera no novo turno" do
    for _ <- 1..3, do: falhar(%{"a" => 1})
    assert FalhaRepetida.parou?()
    assert FalhaRepetida.restante(9) == 0
    FalhaRepetida.zerar()
    refute FalhaRepetida.parou?()
    assert {:error, "ruim"} = falhar(%{"a" => 1})
  end

  test "no ToolLoop a 3ª falha igual grava agent.error origem modelo e para" do
    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("falha", %{"a" => 1}),
      FakeEngineApiClient.tool_call_response("falha", %{"a" => 1}),
      FakeEngineApiClient.tool_call_response("falha", %{"a" => 1}),
      FakeEngineApiClient.final_response("não devia chegar")
    ])

    ctx = %{
      project_id: Ecto.UUID.generate(),
      session_id: Ecto.UUID.generate(),
      agent: "echo",
      tools: [Falha],
      messages: [%{"role" => "user", "content" => "faça", :pinned => true}],
      context_window: 1_000_000
    }

    assert {:ok, out} = ToolLoop.run(ctx)

    assert_received {:event_appended, _, _,
                     %{
                       type: "agent.error",
                       payload: %{origem: "modelo", reason: "falha_repetida_de_ferramenta"}
                     }}

    contents = out.messages |> Enum.filter(&(&1["role"] == "tool")) |> Enum.map(& &1["content"])
    assert length(contents) == 3
    assert Enum.at(contents, 1) =~ "CORREÇÃO"
    assert out.last_error =~ "falha repetida"
  end
end
