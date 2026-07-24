defmodule Engine.Psychologist.Tools.EmitHypothesesTest do
  # Sem DataCase — só o FakeEngineApiClient (scriptado por dicionário de
  # processo). async: false (Application env global).
  use ExUnit.Case, async: false

  alias Engine.Psychologist.Tools.EmitHypotheses
  alias Engine.Sessions.FakeEngineApiClient

  setup do
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :test_pid)
    end)

    ctx = %{
      project_id: "proj-1",
      session_id: "sess-1",
      agent: "psicologo",
      tier: :pesada,
      triggered_by: "auto",
      event_count: 42
    }

    %{ctx: ctx}
  end

  defp hypothesis do
    %{
      "agenteAlvo" => "dev-api",
      "observacao" => "obs",
      "hipotese" => "hip",
      "sugestao" => "sug",
      "confiancaPercent" => 70,
      "evidenceEventIds" => ["evt-1"]
    }
  end

  test "sucesso: repassa tier/triggered_by/event_count e confirma o registro", %{ctx: ctx} do
    assert {:ok, msg} = EmitHypotheses.run(%{"hypotheses" => [hypothesis()]}, ctx)
    assert msg =~ "1 hipótese(s) registrada(s)"

    assert_received {:hypotheses_proposed, "pesada", "auto", 42, [_h]}
  end

  test "evidência inválida: a mensagem da api volta como {:error, ...} pro modelo corrigir",
       %{ctx: ctx} do
    Process.put(
      :fake_propose_hypotheses_error,
      {400,
       %{
         "message" =>
           "hipótese #1 (dev-api): evidência \"evt-x\" não corresponde a um evento real desta sessão"
       }}
    )

    assert {:error, msg} = EmitHypotheses.run(%{"hypotheses" => [hypothesis()]}, ctx)
    assert msg =~ "hipóteses rejeitadas"
    # A mensagem da api é preservada verbatim — é ELA que guia a correção
    # do modelo no próximo turno do ToolLoop.
    assert msg =~ "não corresponde a um evento real desta sessão"
  end

  test "erro com message em lista (class-validator) também é extraído", %{ctx: ctx} do
    Process.put(
      :fake_propose_hypotheses_error,
      {400, %{"message" => ["confiancaPercent deve ser um inteiro entre 0 e 100"]}}
    )

    assert {:error, msg} = EmitHypotheses.run(%{"hypotheses" => [hypothesis()]}, ctx)
    assert msg =~ "confiancaPercent"
  end

  test "sem `hypotheses` retorna erro de uso", %{ctx: ctx} do
    assert {:error, msg} = EmitHypotheses.run(%{}, ctx)
    assert msg =~ "hypotheses"
  end

  test "tier leve é repassado como string pra api", %{ctx: ctx} do
    assert {:ok, _} =
             EmitHypotheses.run(
               %{"hypotheses" => [hypothesis()]},
               %{ctx | tier: :leve, agent: "psicologo-leve"}
             )

    assert_received {:hypotheses_proposed, "leve", "auto", 42, _}
  end
end
