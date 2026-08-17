defmodule Engine.Agents.DevLeadToolsTest do
  # Sem DataCase — só o FakeEngineApiClient (scriptado por dicionário de
  # processo). async: false (Application env global).
  use ExUnit.Case, async: false

  alias Engine.Agents.DevLeadTools
  alias Engine.Sessions.FakeEngineApiClient

  setup do
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
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
end
