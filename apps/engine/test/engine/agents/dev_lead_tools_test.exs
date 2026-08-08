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
    test "registra o plano como EVENTO, com o total somado", %{ctx: ctx} do
      assert {:ok, msg} =
               DevLeadTools.run(plano([modulo("api", 2), modulo("web", 1)]), ctx)

      assert msg =~ "3 agente(s)"
      assert msg =~ "2 módulo(s)"

      assert_received {:event_appended, _p, _s, evento}
      assert evento.type == "execution.plan_proposed"
      assert evento.payload.totalAgentes == 3
      assert evento.actorId == "dev-lead"
    end

    test "o PORQUÊ de cada módulo viaja no evento", %{ctx: ctx} do
      # É o que o usuário lê para decidir quando o plano passa do teto. Um
      # plano sem justificativa por módulo vira um número sem argumento.
      DevLeadTools.run(plano([modulo("api", 3)]), ctx)

      assert_received {:event_appended, _p, _s, evento}
      assert [%{porque: porque}] = evento.payload.modulos
      assert porque =~ "backlog de api"
    end

    test "plano VAZIO é recusado, sem gravar evento", %{ctx: ctx} do
      # Chegaria ao usuário como uma decisão sem conteúdo.
      assert {:error, msg} = DevLeadTools.run(plano([]), ctx)
      assert msg =~ "ao menos um módulo"
      refute_received {:event_appended, _, _, _}
    end

    test "zero agente num módulo é recusado, sem gravar evento", %{ctx: ctx} do
      assert {:error, msg} = DevLeadTools.run(plano([modulo("api", 0)]), ctx)
      assert msg =~ "api"
      assert msg =~ ">= 1"
      refute_received {:event_appended, _, _, _}
    end

    test "um módulo invalido no MEIO da lista nao grava nada", %{ctx: ctx} do
      # Validação antes de qualquer escrita: o event log é imutável, e um
      # plano meio gravado não teria como ser retratado.
      assert {:error, _} =
               DevLeadTools.run(
                 plano([modulo("api", 1), modulo("web", 0), modulo("infra", 1)]),
                 ctx
               )

      refute_received {:event_appended, _, _, _}
    end

    test "sem os campos obrigatorios: erro que diz quais", %{ctx: ctx} do
      assert {:error, msg} = DevLeadTools.run(%{"resumo" => "só o resumo"}, ctx)
      assert msg =~ "modulos"
    end
  end
end
