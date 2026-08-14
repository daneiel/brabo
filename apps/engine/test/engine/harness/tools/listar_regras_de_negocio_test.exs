defmodule Engine.Harness.Tools.ListarRegrasDeNegocioTest do
  @moduledoc """
  RN-164: a primeira ferramenta de LEITURA do PO. O que os testes travam é o
  que o modelo precisa ler para agir — o id (que vai em `business_rule_ids`),
  a marca de cobertura e o total de descobertas — e que "nenhuma regra" é
  resposta legítima com instrução de PERGUNTAR, nunca um erro.
  """

  use ExUnit.Case, async: false

  alias Engine.Harness.Tools.ListarRegrasDeNegocio

  setup do
    Application.put_env(:engine, :engine_api_client, Engine.Sessions.FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn -> Application.delete_env(:engine, :test_pid) end)

    %{ctx: %{project_id: "p1", session_id: "s1", agent: "po"}}
  end

  defp regras do
    %{
      "rules" => [
        %{
          "id" => "evt-1",
          "title" => "Só maiores de 18",
          "description" => "idade >= 18",
          "coveredByStoryIds" => [],
          "covered" => false
        },
        %{
          "id" => "evt-2",
          "title" => "Carrinho tem teto",
          "description" => "no máximo 50 itens",
          "coveredByStoryIds" => ["st-1"],
          "covered" => true
        }
      ],
      "uncoveredCount" => 1
    }
  end

  test "lista as regras com id, cobertura e o total de descobertas", %{ctx: ctx} do
    Process.put(:fake_business_rules, regras())

    assert {:ok, texto} = ListarRegrasDeNegocio.run(%{}, ctx)

    assert_received {:business_rules_listed, "p1"}

    assert texto =~ "2 regra(s) de negócio no projeto; 1 SEM cobertura."
    assert texto =~ "[ ] id=evt-1 | Só maiores de 18: idade >= 18"
    assert texto =~ "[x] id=evt-2"
    assert texto =~ "(coberta por: st-1)"
  end

  test "as descobertas vêm ANTES das cobertas — são elas que dão trabalho", %{ctx: ctx} do
    Process.put(:fake_business_rules, regras())

    assert {:ok, texto} = ListarRegrasDeNegocio.run(%{}, ctx)

    [_, corpo] = String.split(texto, "`[x]` = já coberta pelas histórias entre parênteses.")
    posicao_descoberta = :binary.match(corpo, "evt-1") |> elem(0)
    posicao_coberta = :binary.match(corpo, "evt-2") |> elem(0)

    assert posicao_descoberta < posicao_coberta
  end

  test "projeto sem regra nenhuma NÃO é erro — manda perguntar", %{ctx: ctx} do
    Process.put(:fake_business_rules, %{"rules" => [], "uncoveredCount" => 0})

    assert {:ok, texto} = ListarRegrasDeNegocio.run(%{}, ctx)
    assert texto =~ "Nenhuma regra de negócio capturada"
    assert texto =~ "ask_structured_questions"
  end

  test "falha da api vira tool-result de erro (não derruba o laço)", %{ctx: ctx} do
    Process.put(:fake_business_rules, {:error, {500, %{"message" => "boom"}}})

    assert {:error, texto} = ListarRegrasDeNegocio.run(%{}, ctx)
    assert texto =~ "falha ao listar regras de negócio"
  end

  test "corpo em formato inesperado é erro explícito, não lista vazia", %{ctx: ctx} do
    # Sem esta cláusula, um corpo estranho viraria "nenhuma regra" — e o PO
    # sairia perguntando ao usuário coisas que já estavam capturadas.
    Process.put(:fake_business_rules, %{"itens" => []})

    assert {:error, texto} = ListarRegrasDeNegocio.run(%{}, ctx)
    assert texto =~ "resposta inesperada"
  end
end
