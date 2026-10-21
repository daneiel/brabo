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
      "epic_id" => "11111111-1111-4111-8111-111111111111",
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

    assert {:error,
            ~s(o campo actors chegou como texto; envie uma lista JSON de strings, ex.: ["item 1","item 2"])} =
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
    # O `ToolLoop` lê `:project_workspaces_root` ao montar o contexto, e
    # outros testes APAGAM essa chave no `on_exit`: sem defini-la aqui, o
    # resultado dependia da ordem da suíte.
    anterior = Application.fetch_env(:engine, :project_workspaces_root)
    Application.put_env(:engine, :project_workspaces_root, System.tmp_dir!())

    on_exit(fn ->
      case anterior do
        {:ok, valor} -> Application.put_env(:engine, :project_workspaces_root, valor)
        :error -> Application.delete_env(:engine, :project_workspaces_root)
      end
    end)

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

  describe "RN-725 (AT-405/AT-408)" do
    @spec_titulo %{
      name: "t",
      parameters: %{
        "type" => "object",
        "properties" => %{"title" => %{"type" => "string"}, "ids" => %{"type" => "array"}}
      }
    }

    test "escape literal em texto é decodificado; texto normal e lista seguem como antes" do
      assert {:ok, %{"title" => "Gerar código aleatório 😀\nfim"}} =
               ArgumentosDeFerramenta.normalizar(
                 %{"title" => "Gerar c\\u00f3digo aleat\\u00f3rio \\ud83d\\ude00\\nfim"},
                 @spec_titulo
               )

      assert {:ok, %{"title" => "linha \\n sem unicode"}} =
               ArgumentosDeFerramenta.normalizar(
                 %{"title" => "linha \\n sem unicode"},
                 @spec_titulo
               )

      assert {:ok, %{"ids" => ["a"]}} =
               ArgumentosDeFerramenta.normalizar(%{"ids" => ~s(["a"])}, @spec_titulo)
    end

    test "recusa 'exige' diz as chaves que chegaram, sem valores" do
      assert {:error, msg} =
               ArgumentosDeFerramenta.executar(
                 "t",
                 %{"storyId" => "segredo"},
                 @spec_titulo,
                 fn _ ->
                   {:error, "create_task exige `story_id` e `title`"}
                 end
               )

      assert msg =~ "chaves recebidas: storyId"
      refute msg =~ "segredo"
      assert ArgumentosDeFerramenta.chaves_recebidas("x") =~ "string"
    end

    test "complete_story nomeia o campo que falta" do
      Process.put(:fake_complete_story, %{
        "id" => "s1",
        "status" => "draft",
        "rf" => ["a"],
        "dod" => ["b"],
        "dor" => ["c"],
        "businessRuleIds" => []
      })

      assert {:ok, msg} =
               Engine.Harness.Tools.CompleteStory.run(%{"story_id" => "s1"}, %{
                 project_id: "p",
                 session_id: "s"
               })

      assert msg =~ "falta: business_rule_ids."
    end
  end

  describe "RN-895 (AT-583)" do
    test "objeto que não é JSON diz o formato esperado" do
      spec = %{parameters: %{"properties" => %{"meta" => %{"type" => "object"}}}}

      assert {:error,
              ~s(o campo meta chegou como texto; envie um objeto JSON, ex.: {"chave":"valor"})} =
               ArgumentosDeFerramenta.normalizar(%{"meta" => "chave: valor"}, spec)
    end

    test "número num campo lista diz o tipo que chegou" do
      spec = %{parameters: %{"properties" => %{"dod" => %{"type" => "array"}}}}

      assert {:error, "o campo dod chegou como número; envie uma lista" <> _} =
               ArgumentosDeFerramenta.normalizar(%{"dod" => 3}, spec)

      assert {:ok, %{"dod" => ["a"]}} = ArgumentosDeFerramenta.normalizar(%{"dod" => ["a"]}, spec)
    end

    test "recusa do emit_plano_de_teste leva as chaves recebidas" do
      args = %{"planoDeTeste" => "segredo"}

      assert {:error, msg} =
               ArgumentosDeFerramenta.executar("emit_plano_de_teste", args, nil, fn a ->
                 Engine.Gates.Tools.EmitPlanoDeTeste.run(a, %{})
               end)

      assert msg =~ "chaves recebidas: planoDeTeste"
      refute msg =~ "segredo"
    end
  end

  describe "RN-896 (AT-584)" do
    test "epic_id que não é UUID é recusado antes da api" do
      ctx = %{project_id: "p1", session_id: "s1"}

      assert {:error, "epic_id inválido; use o id" <> _} =
               CreateStory.run(%{"epic_id" => "EPIC_ID_PLACEHOLDER", "title" => "x"}, ctx)

      refute_received {:story_created, _}
    end

    @outro "22222222-2222-4222-8222-222222222222"

    defp com_conhecidos do
      %{
        project_id: "p1",
        session_id: "s1",
        epicos_conhecidos: %{"11111111-1111-4111-8111-111111111111" => "Cadastro"}
      }
    end

    test "épico fora do mapa mas no backlog é aceito" do
      Process.put(:fake_backlog, [%{"id" => @outro, "title" => "Antigo", "stories" => []}])
      assert {:ok, _} = CreateStory.run(%{"epic_id" => @outro, "title" => "x"}, com_conhecidos())
    end

    test "id fora do mapa e do backlog é recusado listando o backlog" do
      Process.put(:fake_backlog, [%{"id" => @outro, "title" => "Antigo", "stories" => []}])
      id = "33333333-3333-4333-8333-333333333333"

      assert {:error, msg} = CreateStory.run(%{"epic_id" => id, "title" => "x"}, com_conhecidos())
      assert msg =~ "#{@outro}=Antigo"
      refute_received {:story_created, _}
    end

    test "backlog que falha não recusa" do
      Process.put(:fake_backlog, {:error, :boom})
      assert {:ok, _} = CreateStory.run(%{"epic_id" => @outro, "title" => "x"}, com_conhecidos())
    end
  end
end
