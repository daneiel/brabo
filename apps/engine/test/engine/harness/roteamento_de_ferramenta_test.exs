defmodule Engine.Harness.RoteamentoDeFerramentaTest do
  # RN-625 (AT-238, ADR 0179): o lado do engine do roteamento pelo Jev.
  # DataCase porque o `ToolLoop` monta o system prompt lendo o banco;
  # async: false pelo Application env global.
  use Engine.DataCase, async: false

  alias Engine.Harness.{RoteamentoDeFerramenta, ToolLoop}
  alias Engine.Sessions.{EngineApiClient, FakeEngineApiClient}

  setup do
    root =
      Path.join(
        System.tmp_dir!(),
        "brabo-roteamento-#{System.os_time(:microsecond)}-#{System.unique_integer([:positive])}"
      )

    Application.put_env(:engine, :project_workspaces_root, root)
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      File.rm_rf!(root)
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :test_pid)
    end)

    %{
      project_id: Ecto.UUID.generate(),
      session_id: Ecto.UUID.generate()
    }
  end

  @tools [%{name: "read_file"}, %{name: "write_file"}, %{name: "terminal"}]

  defp roteamento(over \\ %{}) do
    Map.merge(
      %{
        "modelo" => "typesafe/jev-1.13",
        "ofertadas" => 3,
        "menuAntes" => ["read_file", "write_file", "terminal"],
        "menuDepois" => ["read_file", "write_file"],
        "escolha" => "write_file",
        "confianca" => 0.91,
        "segunda" => %{"opcao" => "terminal", "probabilidade" => 0.06},
        "anterior" => "read_file",
        "aplicado" => true,
        "motivoDaQueda" => nil,
        "origemDaQueda" => nil,
        "detalheDaQueda" => nil,
        "latenciaMs" => 212,
        "custoMicros" => 52,
        "gastoNaoRegistrado" => false
      },
      over
    )
  end

  defp resposta(message_over, roteamento) do
    FakeEngineApiClient.final_response("")
    |> Map.update!("message", &Map.merge(&1, message_over))
    |> Map.put("toolRouting", roteamento)
  end

  defp chamada(nome), do: %{"id" => "c-#{nome}", "name" => nome, "arguments" => %{}}

  describe "tool_router.decided" do
    test "a fachada grava o evento com o menu antes e depois, a escolha e o custo", %{
      project_id: p,
      session_id: s
    } do
      Process.put(:fake_llm_turns, [
        resposta(%{"toolCalls" => [chamada("write_file")]}, roteamento())
      ])

      assert {:ok, _} =
               EngineApiClient.llm_turn(
                 p,
                 s,
                 "dev-api",
                 [%{"role" => "user", "content" => "x"}],
                 @tools
               )

      assert_received {:event_appended, ^p, ^s,
                       %{
                         type: "tool_router.decided",
                         actorKind: "agent",
                         actorId: "dev-api",
                         payload: payload
                       }}

      assert payload.menuAntes == ["read_file", "write_file", "terminal"]
      assert payload.menuDepois == ["read_file", "write_file"]
      assert payload.escolha == "write_file"
      assert payload.confianca == 0.91
      assert payload.aplicado == true
      assert payload.motivoDaQueda == nil
      assert payload.latenciaMs == 212
      assert payload.custoMicros == 52
      assert payload.foraDoCardapio == []
    end

    test "uma queda vai ao evento COM o motivo e a origem (RN-059: nunca calada)", %{
      project_id: p,
      session_id: s
    } do
      queda =
        roteamento(%{
          "aplicado" => false,
          "escolha" => nil,
          "confianca" => nil,
          "menuDepois" => ["read_file", "write_file", "terminal"],
          "motivoDaQueda" => "timeout",
          "origemDaQueda" => "infra",
          "custoMicros" => 0
        })

      Process.put(:fake_llm_turns, [resposta(%{"toolCalls" => [chamada("terminal")]}, queda)])
      assert {:ok, _} = EngineApiClient.llm_turn(p, s, "dev-api", [], @tools)

      assert_received {:event_appended, _, _,
                       %{
                         type: "tool_router.decided",
                         payload: %{
                           aplicado: false,
                           motivoDaQueda: "timeout",
                           origemDaQueda: "infra"
                         }
                       }}
    end

    test "ferramenta FORA do cardápio do passo é despachada como sempre e só REGISTRADA", %{
      project_id: p,
      session_id: s
    } do
      Process.put(:fake_llm_turns, [
        resposta(%{"toolCalls" => [chamada("terminal")]}, roteamento())
      ])

      assert {:ok, %{"message" => %{"toolCalls" => [%{"name" => "terminal"}]}}} =
               EngineApiClient.llm_turn(p, s, "dev-api", [], @tools)

      assert_received {:event_appended, _, _,
                       %{type: "tool_router.decided", payload: %{foraDoCardapio: ["terminal"]}}}
    end

    test "sem `toolRouting` (api antiga, ou roteador não consultado): nada é gravado", %{
      project_id: p,
      session_id: s
    } do
      Process.put(:fake_llm_turns, [FakeEngineApiClient.final_response("oi")])
      assert {:ok, _} = EngineApiClient.llm_turn(p, s, "dev-api", [], @tools)
      refute_received {:event_appended, _, _, %{type: "tool_router.decided"}}
    end

    test "o stream dos conversacionais grava o mesmo evento", %{project_id: p, session_id: s} do
      Process.put(:fake_llm_turns, [
        resposta(%{"toolCalls" => [chamada("write_file")]}, roteamento())
      ])

      assert {:ok, _} =
               EngineApiClient.llm_turn_stream(p, s, "criativo", [], @tools, fn _ -> :ok end)

      assert_received {:event_appended, _, _, %{type: "tool_router.decided", actorId: "criativo"}}
    end

    test "CASO DE FALHA: o append recusado NÃO derruba o turno", %{project_id: p, session_id: s} do
      Process.put(:fake_append_event_error, :recusado)

      Process.put(:fake_llm_turns, [
        resposta(%{"toolCalls" => [chamada("write_file")]}, roteamento())
      ])

      assert {:ok, %{"message" => %{"toolCalls" => [_]}}} =
               EngineApiClient.llm_turn(p, s, "dev-api", [], @tools)
    end
  end

  describe "sair do beco: o menu restrito errou" do
    test "modelo respondeu SEM ferramenta com o menu restrito: repete UMA vez com o catálogo inteiro",
         %{
           project_id: p,
           session_id: s
         } do
      Process.put(:fake_llm_turns, [
        resposta(%{"content" => "não consigo com essas ferramentas"}, roteamento()),
        FakeEngineApiClient.tool_call_response("terminal", %{"command" => "ls"})
      ])

      assert {:ok, resp} = EngineApiClient.llm_turn(p, s, "dev-api", [], @tools)

      assert_received {:llm_turn_catalogo_completo, "dev-api"}
      assert [%{"name" => "terminal"}] = resp["message"]["toolCalls"]
      # O evento diz que o menu estava errado, e o passo não vira duas voltas no laço.
      assert_received {:event_appended, _, _,
                       %{
                         type: "tool_router.decided",
                         payload: %{aplicado: true, foraDoCardapio: ["terminal"]}
                       }}
    end

    test "o custo do chat das DUAS voltas soma, e o do Jev fica no toolRouting", %{
      project_id: p,
      session_id: s
    } do
      primeira =
        resposta(%{"content" => "não sei"}, roteamento()) |> put_in(["usage", "costMicros"], 100)

      segunda =
        FakeEngineApiClient.tool_call_response("terminal", %{"command" => "ls"})
        |> put_in(["usage", "costMicros"], 30)

      Process.put(:fake_llm_turns, [primeira, segunda])

      assert {:ok, resp} = EngineApiClient.llm_turn(p, s, "dev-api", [], @tools)
      assert resp["usage"]["costMicros"] == 130
      assert resp["toolRouting"]["custoMicros"] == 52
      assert resp["toolRouting"]["repetidoComCatalogoInteiro"] == true
    end

    test "NÃO repete quando o modelo chamou ferramenta, quando o menu não foi restrito ou quando o provider errou",
         %{
           project_id: p,
           session_id: s
         } do
      for turno <- [
            resposta(%{"toolCalls" => [chamada("write_file")]}, roteamento()),
            resposta(%{"content" => "oi"}, roteamento(%{"aplicado" => false})),
            resposta(%{"content" => ""}, roteamento()) |> Map.put("error", "provider caiu")
          ] do
        Process.put(:fake_llm_turns, [
          turno,
          FakeEngineApiClient.final_response("NÃO DEVIA SER CHAMADO")
        ])

        assert {:ok, _} = EngineApiClient.llm_turn(p, s, "dev-api", [], @tools)
        refute_received {:llm_turn_catalogo_completo, _}
      end
    end

    test "texto que carrega uma chamada RECUPERÁVEL (ADR 0020) conta como ferramenta: não repete",
         %{
           project_id: p,
           session_id: s
         } do
      texto = ~s({"name": "write_file", "arguments": {"path": "a"}})
      Process.put(:fake_llm_turns, [resposta(%{"content" => texto}, roteamento())])
      assert {:ok, _} = EngineApiClient.llm_turn(p, s, "dev-api", [], @tools)
      refute_received {:llm_turn_catalogo_completo, _}
    end

    test "no stream só repete se NADA foi escrito para a pessoa", %{project_id: p, session_id: s} do
      Process.put(:fake_llm_turns, [
        resposta(%{"content" => "já escrevi isto para a pessoa"}, roteamento()),
        FakeEngineApiClient.final_response("NÃO DEVIA SER CHAMADO")
      ])

      assert {:ok, _} =
               EngineApiClient.llm_turn_stream(p, s, "criativo", [], @tools, fn _ -> :ok end)

      refute_received {:llm_turn_catalogo_completo, _}

      Process.put(:fake_llm_turns, [
        resposta(%{"content" => ""}, roteamento()),
        FakeEngineApiClient.tool_call_response("terminal", %{"command" => "ls"})
      ])

      assert {:ok, _} =
               EngineApiClient.llm_turn_stream(p, s, "criativo", [], @tools, fn _ -> :ok end)

      assert_received {:llm_turn_catalogo_completo, "criativo"}
    end
  end

  describe "ToolLoop" do
    setup %{project_id: p, session_id: s} do
      %{
        ctx: %{
          project_id: p,
          session_id: s,
          agent: "echo",
          messages: [%{"role" => "user", "content" => "faça a tarefa", :pinned => true}],
          context_window: 1_000_000
        }
      }
    end

    test "o custo do Jev entra no orçamento local do laço", %{ctx: ctx} do
      turno =
        FakeEngineApiClient.tool_call_response("search_workspace", %{"query" => "x"})
        |> put_in(["usage", "costMicros"], 100)
        |> Map.put("toolRouting", roteamento(%{"custoMicros" => 52}))

      Process.put(:fake_llm_turns, [turno, FakeEngineApiClient.final_response("pronto")])
      assert {:ok, out} = ToolLoop.run(ctx)
      assert out.tokens_spent_micros == 152
    end

    test "a política não muda: ferramenta escolhida pelo Jev que exige aprovação continua exigindo",
         %{ctx: ctx} do
      # O Jev escolheu `terminal`. Quem decide se ela executa é a
      # Proposed Action — o roteador não participa: a ação nasce `pending` e
      # o laço recebe o resultado da política, não um atalho.
      turno =
        FakeEngineApiClient.tool_call_response("terminal", %{"command" => "rm -rf /tmp/x"})
        |> Map.put(
          "toolRouting",
          roteamento(%{"escolha" => "terminal", "menuDepois" => ["terminal"]})
        )

      Process.put(:fake_llm_turns, [turno, FakeEngineApiClient.final_response("aguardando")])
      Process.put(:fake_propose_action, %{"id" => "pa-1", "status" => "pending"})

      # O laço PARA esperando a decisão humana: o Jev escolheu, mas quem aprova
      # continua sendo a política — nenhum resultado de `terminal` chega ao modelo.
      assert {:halted, {:awaiting_approval, "pa-1", _tool_call_id, "terminal"}, out} =
               ToolLoop.run(ctx)

      refute Enum.any?(out.messages, &(&1["role"] == "tool"))

      assert_received {:propose_action, "terminal", %{kind: "agent", id: "echo"},
                       %{command: "rm -rf /tmp/x"}}
    end

    test "o módulo do roteamento não conhece a política de aprovação" do
      fonte = File.read!("lib/engine/harness/roteamento_de_ferramenta.ex")
      refute fonte =~ "propose_action"
      refute fonte =~ "auto_approve"
      refute fonte =~ "permissions"
    end
  end

  test "custo_micros/1 lê o custo do Jev e ignora o que não é inteiro" do
    assert RoteamentoDeFerramenta.custo_micros(%{"toolRouting" => %{"custoMicros" => 52}}) == 52
    assert RoteamentoDeFerramenta.custo_micros(%{"toolRouting" => %{"custoMicros" => "52"}}) == 0
    assert RoteamentoDeFerramenta.custo_micros(%{}) == 0
  end
end
