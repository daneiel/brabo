defmodule Engine.Agents.DevLeadToolsTest do
  # Sem DataCase — só o FakeEngineApiClient (scriptado por dicionário de
  # processo). async: false (Application env global).
  use ExUnit.Case, async: false

  alias Engine.Agents.DevLeadTools
  alias Engine.Gates.FakeGateDispatcher
  alias Engine.Sessions.FakeEngineApiClient

  setup do
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    # ADR 0090: `assess_implementability` dispara `Dispatcher.run_qa_estrategia/3`
    # quando não há plano ainda — o fake evita subir um `QaLeadServer` real
    # (mesmo motivo do `qa_lead_server_test.exs`).
    Application.put_env(:engine, :gate_dispatcher, FakeGateDispatcher)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :gate_dispatcher)
      Application.delete_env(:engine, :test_pid)
    end)

    %{ctx: %{project_id: "proj-1", session_id: "sess-1"}}
  end

  defp plano(modulos) do
    %{"modulos" => modulos, "resumo" => "um agente por módulo"}
  end

  defp modulo(nome, agentes) do
    %{"modulo" => nome, "agentes" => agentes, "porque" => "backlog de #{nome}"}
  end

  describe "propose_execution_plan" do
    test "propõe o plano como proposed_action, com o total somado (status auto_approved do fake)",
         %{ctx: ctx} do
      assert {:ok, msg} =
               DevLeadTools.run(plano([modulo("api", 2), modulo("web", 1)]), ctx)

      assert msg =~ "3 agente(s)"
      assert msg =~ "2 módulo(s)"

      assert_received {:propose_action, action_type, actor, payload}
      assert action_type == "propose_execution_plan"
      assert actor == %{kind: "agent", id: "dev-lead"}
      assert payload.totalAgentes == 3
    end

    test "o PORQUÊ de cada módulo viaja no payload da proposta", %{ctx: ctx} do
      # É o que o usuário lê para decidir quando o plano passa do teto. Um
      # plano sem justificativa por módulo vira um número sem argumento.
      DevLeadTools.run(plano([modulo("api", 3)]), ctx)

      assert_received {:propose_action, _action_type, _actor, payload}
      assert [%{porque: porque}] = payload.modulos
      assert porque =~ "backlog de api"
    end

    test "status pending devolve {:pending, action_id} — o chamador é quem suspende", %{ctx: ctx} do
      Process.put(:fake_propose_action, %{"id" => "pa-42", "status" => "pending"})

      assert {:pending, "pa-42"} = DevLeadTools.run(plano([modulo("api", 2)]), ctx)

      assert_received {:propose_action, "propose_execution_plan", _actor, _payload}
    end

    test "status executed também conta como sucesso", %{ctx: ctx} do
      Process.put(:fake_propose_action, %{"id" => "pa-9", "status" => "executed"})

      assert {:ok, msg} = DevLeadTools.run(plano([modulo("api", 1)]), ctx)
      assert msg =~ "1 agente(s)"
    end

    test "status denied vira {:error, _} — a proposta não é reencaminhada como sucesso", %{
      ctx: ctx
    } do
      Process.put(:fake_propose_action, %{"id" => "pa-7", "status" => "denied"})

      assert {:error, msg} = DevLeadTools.run(plano([modulo("api", 1)]), ctx)
      assert msg =~ "denied"
    end

    test "plano VAZIO é recusado, sem propor ação", %{ctx: ctx} do
      # Chegaria ao usuário como uma decisão sem conteúdo.
      assert {:error, msg} = DevLeadTools.run(plano([]), ctx)
      assert msg =~ "ao menos um módulo"
      refute_received {:propose_action, _, _, _}
    end

    test "zero agente num módulo é recusado, sem propor ação", %{ctx: ctx} do
      assert {:error, msg} = DevLeadTools.run(plano([modulo("api", 0)]), ctx)
      assert msg =~ "api"
      assert msg =~ ">= 1"
      refute_received {:propose_action, _, _, _}
    end

    test "um módulo invalido no MEIO da lista nao propõe nada", %{ctx: ctx} do
      # Validação antes de qualquer I/O: uma vez proposta, a ação é decisão
      # real do usuário — um plano meio proposto não teria como ser retratado.
      assert {:error, _} =
               DevLeadTools.run(
                 plano([modulo("api", 1), modulo("web", 0), modulo("infra", 1)]),
                 ctx
               )

      refute_received {:propose_action, _, _, _}
    end

    test "sem os campos obrigatorios: erro que diz quais", %{ctx: ctx} do
      assert {:error, msg} = DevLeadTools.run(%{"resumo" => "só o resumo"}, ctx)
      assert msg =~ "modulos"
    end
  end

  describe "assess_implementability (ADR 0090)" do
    defp assessment(story_id \\ "st-1") do
      %{
        "storyId" => story_id,
        "parecer" => "implementavel",
        "justificativa" => "critérios claros"
      }
    end

    defp plano_de_teste_event(story_id) do
      %{
        "type" => "artifact.plano_de_teste",
        "payload" => %{
          "storyId" => story_id,
          "planoDeTeste" => "cobrir X",
          "criteriosExecutaveis" => ["dado X, quando Y, então Z"],
          "estrategiaDeAutomacao" => "integração"
        }
      }
    end

    test "sem plano de teste: dispara a avaliação de QA-estratégia e devolve erro pedindo retentativa",
         %{ctx: ctx} do
      Process.put(:fake_events, [])

      assert {:error, msg} = DevLeadTools.run_assessment(assessment(), ctx)
      assert msg =~ "ainda não há plano de teste"
      assert msg =~ "instantes"

      assert_received {:qa_estrategia_dispatch, "proj-1", "sess-1", "st-1"}
      refute_received {:propose_action, "assess_implementability", _actor, _payload}
    end

    test "com plano de teste: propõe o parecer com o plano embutido no payload", %{ctx: ctx} do
      Process.put(:fake_events, [plano_de_teste_event("st-1")])

      assert {:ok, msg} = DevLeadTools.run_assessment(assessment(), ctx)
      assert msg =~ "implementavel"
      assert msg =~ "st-1"

      assert_received {:propose_action, "assess_implementability", actor, payload}
      assert actor == %{kind: "agent", id: "dev-lead"}
      assert payload.storyId == "st-1"
      assert payload.parecer == "implementavel"
      assert payload.justificativa == "critérios claros"
      assert payload.planoDeTeste == "cobrir X"
      assert payload.criteriosExecutaveis == ["dado X, quando Y, então Z"]
    end

    test "usa o plano MAIS RECENTE quando a story foi reavaliada", %{ctx: ctx} do
      antigo = plano_de_teste_event("st-1")
      novo = put_in(plano_de_teste_event("st-1")["payload"]["planoDeTeste"], "versão nova")
      Process.put(:fake_events, [antigo, novo])

      assert {:ok, _msg} = DevLeadTools.run_assessment(assessment(), ctx)

      assert_received {:propose_action, "assess_implementability", _actor, payload}
      assert payload.planoDeTeste == "versão nova"
    end

    test "plano de OUTRA story não conta", %{ctx: ctx} do
      Process.put(:fake_events, [plano_de_teste_event("st-outra")])

      assert {:error, msg} = DevLeadTools.run_assessment(assessment("st-1"), ctx)
      assert msg =~ "ainda não há plano de teste"
    end

    test "status pending devolve {:pending, action_id}", %{ctx: ctx} do
      Process.put(:fake_events, [plano_de_teste_event("st-1")])
      Process.put(:fake_propose_action, %{"id" => "pa-imp-1", "status" => "pending"})

      assert {:pending, "pa-imp-1"} = DevLeadTools.run_assessment(assessment(), ctx)
    end

    test "status denied vira {:error, _}", %{ctx: ctx} do
      Process.put(:fake_events, [plano_de_teste_event("st-1")])
      Process.put(:fake_propose_action, %{"id" => "pa-imp-2", "status" => "denied"})

      assert {:error, msg} = DevLeadTools.run_assessment(assessment(), ctx)
      assert msg =~ "denied"
    end

    test "sem os campos obrigatorios: erro que diz quais", %{ctx: ctx} do
      assert {:error, msg} = DevLeadTools.run_assessment(%{"storyId" => "st-1"}, ctx)
      assert msg =~ "storyId"
      assert msg =~ "parecer"
    end

    test "parecer fora do enum é recusado", %{ctx: ctx} do
      args = %{"storyId" => "st-1", "parecer" => "talvez", "justificativa" => "x"}
      assert {:error, _msg} = DevLeadTools.run_assessment(args, ctx)
    end
  end
end
