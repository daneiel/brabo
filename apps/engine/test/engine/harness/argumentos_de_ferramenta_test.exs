defmodule Engine.Harness.ArgumentosDeFerramentaTest do
  @moduledoc """
  RN-719 (AT-387): lista/objeto vindo como STRING JSON é normalizado no ponto
  comum de despacho, string que não é JSON do tipo vira recusa NOMEADA, e
  exceção dentro da ferramenta vira erro do laço com origem `codigo`.
  """

  use Engine.DataCase, async: false

  alias Engine.Agents.ResultadoDeFerramenta
  alias Engine.Harness.{ArgumentosDeFerramenta, ToolLoop}
  alias Engine.Harness.Tools.{CreateC4Diagram, CreateStory}
  alias Engine.Sessions.FakeEngineApiClient

  defmodule Explode do
    @behaviour Engine.Harness.Tool
    @impl true
    def spec,
      do: %{
        name: "explode",
        description: "lança",
        parameters: %{"type" => "object", "properties" => %{}}
      }

    @impl true
    def category, do: :direct
    @impl true
    def run(_args, _ctx), do: Enum.map("não é lista", & &1)
  end

  setup do
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :test_pid)
    end)

    %{ctx: %{project_id: "p1", session_id: "s1"}}
  end

  defp executar(mod, args, ctx),
    do: ArgumentosDeFerramenta.executar(mod.spec().name, args, [mod.spec()], &mod.run(&1, ctx))

  test "create_story com business_rule_ids em string JSON grava os ids", %{ctx: ctx} do
    args = %{
      "epic_id" => "ep-1",
      "title" => "Comprar",
      "business_rule_ids" => "[\"01M3YM49TM61FBS4JZ9BSQSK20\"]"
    }

    assert {:ok, _} = executar(CreateStory, args, ctx)
    assert_received {:story_created, fields}
    assert fields.businessRuleIds == ["01M3YM49TM61FBS4JZ9BSQSK20"]
  end

  test "create_c4_diagram com actors em string JSON funciona", %{ctx: ctx} do
    args = %{"system_name" => "Loja", "actors" => "[{\"name\": \"Cliente\"}]"}

    assert {:ok, _} = executar(CreateC4Diagram, args, ctx)
    assert_received {:c4_diagram_created, entrada}
    assert [%{name: "Cliente", type: "person"}] = entrada.actors
  end

  test "string que não é JSON num campo array vira recusa nomeada", %{ctx: ctx} do
    args = %{"system_name" => "Loja", "actors" => "Cliente e GitHub"}

    assert {:error, "o campo actors precisa ser uma lista"} =
             executar(CreateC4Diagram, args, ctx)

    refute_received {:c4_diagram_created, _}
  end

  test "campo declarado string não é normalizado", %{ctx: ctx} do
    assert {:ok, %{"system_name" => "[1]"}} =
             ArgumentosDeFerramenta.normalizar(%{"system_name" => "[1]"}, CreateC4Diagram.spec())

    _ = ctx
  end

  test "exceção na ferramenta vira erro com origem codigo" do
    assert {:error, motivo} =
             ArgumentosDeFerramenta.executar("explode", %{}, nil, &Explode.run(&1, %{}))

    assert ArgumentosDeFerramenta.falha_interna?(motivo)

    assert %{ok: false, origem: "codigo"} =
             ResultadoDeFerramenta.payload("explode", {:error, motivo})
  end

  test "ferramenta que lança não encerra o turno do ToolLoop" do
    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("explode", %{}),
      FakeEngineApiClient.final_response("segui")
    ])

    ctx = %{
      project_id: Ecto.UUID.generate(),
      session_id: Ecto.UUID.generate(),
      agent: "echo",
      tools: [Explode],
      messages: [%{"role" => "user", "content" => "faça", :pinned => true}],
      context_window: 1_000_000
    }

    assert {:ok, out} = ToolLoop.run(ctx)

    assert_received {:event_appended, _, _,
                     %{type: "tool.result", payload: %{tool: "explode", ok: false}}}

    tool_msg = Enum.find(out.messages, &(&1["role"] == "tool"))
    assert tool_msg["content"] =~ "falha interna da ferramenta explode"
  end
end
