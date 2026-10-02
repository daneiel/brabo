defmodule Engine.Anamnese.ReportAgentDeviationTest do
  # RN-717 (ADR 0205): o desvio do agente vira sinal do PRODUTO, sem dado pessoal.
  use ExUnit.Case, async: false

  alias Engine.Anamnese.Tools
  alias Engine.Anamnese.Tools.ReportAgentDeviation
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

  test "está no registro da Anamnese" do
    assert ReportAgentDeviation in Tools.registry()
  end

  test "reparo do usuário vira anamnese.agent_deviation do AGENTE, só com agente, tipo e evidência",
       %{ctx: ctx} do
    args = %{
      "agente" => "po",
      "tipo" => "reparo_pelo_usuario",
      "evidenceEventIds" => ["evt-1", "evt-1", "evt-2"],
      # campos que o modelo inventasse com dado pessoal são descartados
      "userId" => "user-1",
      "nome" => "Dani",
      "email" => "d@x.dev",
      "traco" => "driver de continuidade"
    }

    assert {:ok, msg} = ReportAgentDeviation.run(args, ctx)
    assert msg =~ "po"

    assert_received {:event_appended, "proj-1", "sess-1", event}
    assert event.type == "anamnese.agent_deviation"
    assert event.actorKind == "agent"
    assert event.actorId == "anamnese"

    assert event.payload == %{
             agente: "po",
             tipo: "reparo_pelo_usuario",
             evidenceEventIds: ["evt-1", "evt-2"]
           }

    # nunca vira perfil
    refute_received {:proficiency_recorded, _}
  end

  test "tipo fora do vocabulário é recusado e nada é gravado", %{ctx: ctx} do
    args = %{"agente" => "po", "tipo" => "usuario_impaciente", "evidenceEventIds" => ["evt-1"]}

    assert {:error, msg} = ReportAgentDeviation.run(args, ctx)
    assert msg =~ "tipo de desvio inválido"
    refute_received {:event_appended, _, _, _}
  end

  test "sem evidência é recusado", %{ctx: ctx} do
    args = %{"agente" => "po", "tipo" => "laco", "evidenceEventIds" => []}

    assert {:error, msg} = ReportAgentDeviation.run(args, ctx)
    assert msg =~ "sem evidência"
    refute_received {:event_appended, _, _, _}
  end
end
