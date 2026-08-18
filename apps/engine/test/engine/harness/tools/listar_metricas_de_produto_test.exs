defmodule Engine.Harness.Tools.ListarMetricasDeProdutoTest do
  @moduledoc """
  RN-407: a terceira ferramenta de LEITURA do PO, e a última pendência da
  auditoria fluxo.yml × código (item B4). O que os testes travam é que o PO
  consegue ler o funil/DORA parcial pelo mesmo shape que a api devolve, e que
  as três ausências permanentes ("Não medido, de propósito") sempre aparecem
  no texto — nunca só nos números, que sozinhos deixariam o modelo concluir
  por omissão que não há lacuna.
  """

  use ExUnit.Case, async: false

  alias Engine.Harness.Tools.ListarMetricasDeProduto

  setup do
    Application.put_env(:engine, :engine_api_client, Engine.Sessions.FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn -> Application.delete_env(:engine, :test_pid) end)

    %{ctx: %{project_id: "p1", session_id: "s1", agent: "po"}}
  end

  defp relatorio do
    %{
      "project" => %{"id" => "p1", "name" => "exp003"},
      "totalActionsConsidered" => 3,
      "funnel" => %{
        "etapas" => [
          %{"etapa" => "sessão produziu commit", "sessoes" => 1, "taxaDaEtapaAnterior" => nil},
          %{"etapa" => "commit → PR aberta", "sessoes" => 1, "taxaDaEtapaAnterior" => 1.0},
          %{"etapa" => "PR aberta → merge", "sessoes" => 1, "taxaDaEtapaAnterior" => 1.0}
        ],
        "sessoesComCommit" => ["s1"],
        "sessoesComPr" => ["s1"],
        "sessoesComMerge" => ["s1"]
      },
      "leadTimes" => %{
        "perSession" => [
          %{
            "sessionId" => "s1",
            "primeiroCommitEm" => "2026-08-01T10:00:00.000Z",
            "primeiroMergeEm" => "2026-08-01T12:00:00.000Z",
            "leadTimeMs" => 2 * 60 * 60 * 1000
          }
        ],
        "averageMs" => 2 * 60 * 60 * 1000
      },
      "deploymentFrequency" => [%{"dia" => "2026-08-01", "merges" => 1}]
    }
  end

  test "lista o funil, o lead time médio e a deployment frequency", %{ctx: ctx} do
    Process.put(:fake_product_metrics, relatorio())

    assert {:ok, texto} = ListarMetricasDeProduto.run(%{}, ctx)

    assert_received {:product_metrics_listed, "p1"}

    assert texto =~ "Funil de entrega e DORA parcial — exp003"
    assert texto =~ "Ações git consideradas"
    assert texto =~ "sessão produziu commit: 1 sessão(ões)"
    assert texto =~ "média: 2h00m"
    assert texto =~ "s1: 2h00m"
    assert texto =~ "2026-08-01: 1 merge(s)"
  end

  test "as três ausências permanentes SEMPRE aparecem no texto", %{ctx: ctx} do
    Process.put(:fake_product_metrics, relatorio())

    assert {:ok, texto} = ListarMetricasDeProduto.run(%{}, ctx)

    assert texto =~ "Não medido, de propósito"
    assert texto =~ "Funil de produto completo (ideação → commit)"
    assert texto =~ "Evidência de adoção por feature"
    assert texto =~ "MTTR e change failure rate"
  end

  test "projeto sem ação git nenhuma não é erro — diz média ausente e nenhum deploy", %{
    ctx: ctx
  } do
    vazio = %{
      "project" => %{"id" => "p1", "name" => "vazio"},
      "totalActionsConsidered" => 0,
      "funnel" => %{
        "etapas" => [
          %{"etapa" => "sessão produziu commit", "sessoes" => 0, "taxaDaEtapaAnterior" => nil},
          %{"etapa" => "commit → PR aberta", "sessoes" => 0, "taxaDaEtapaAnterior" => nil},
          %{"etapa" => "PR aberta → merge", "sessoes" => 0, "taxaDaEtapaAnterior" => nil}
        ],
        "sessoesComCommit" => [],
        "sessoesComPr" => [],
        "sessoesComMerge" => []
      },
      "leadTimes" => %{"perSession" => [], "averageMs" => nil},
      "deploymentFrequency" => []
    }

    Process.put(:fake_product_metrics, vazio)

    assert {:ok, texto} = ListarMetricasDeProduto.run(%{}, ctx)
    assert texto =~ "média: — (nenhuma sessão com commit E merge)"
    assert texto =~ "nenhum merge em branch protegida."
  end

  test "falha da api vira tool-result de erro (não derruba o laço)", %{ctx: ctx} do
    Process.put(:fake_product_metrics, {:error, {500, %{"message" => "boom"}}})

    assert {:error, texto} = ListarMetricasDeProduto.run(%{}, ctx)
    assert texto =~ "falha ao listar métricas de produto"
  end

  test "corpo em formato inesperado é erro explícito", %{ctx: ctx} do
    Process.put(:fake_product_metrics, ["não é mapa"])

    assert {:error, texto} = ListarMetricasDeProduto.run(%{}, ctx)
    assert texto =~ "resposta inesperada"
  end
end
