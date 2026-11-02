defmodule Engine.Actions.GitleaksRelatorioTest do
  @moduledoc """
  RN-796 (AT-470): o item do parecer leva a regra do gitleaks e o trecho
  acusado com o segredo MASCARADO. O relatório é montado em tempo de execução,
  com valor neutro, para nenhum literal deste arquivo parecer segredo.
  """

  use ExUnit.Case, async: true

  alias Engine.Actions.GitleaksDetector.Live

  @raiz "/w"

  defp relatorio(campos), do: Jason.encode!([Map.merge(base(), campos)])

  defp base,
    do: %{"File" => @raiz <> "/src/db.ts", "StartLine" => 3, "Description" => "Generic"}

  test "caminho feliz: regra e trecho com o valor trocado por ***" do
    valor = Enum.join(["valor", "neutro", "xyz"], "-")
    trecho = "conexao = '" <> valor <> "'"

    assert {:ok, [item]} =
             Live.parse_content(
               relatorio(%{"RuleID" => "generic-api-key", "Match" => trecho, "Secret" => valor}),
               @raiz
             )

    assert item.path == "src/db.ts"
    assert item.message =~ "regra `generic-api-key`"
    assert item.message =~ "conexao = '***'"
    refute item.message =~ valor
  end

  test "falha: sem o valor para mascarar, o trecho não entra" do
    trecho = "conexao = '" <> Enum.join(["a", "b"], "-") <> "'"

    assert {:ok, [item]} =
             Live.parse_content(relatorio(%{"RuleID" => "r", "Match" => trecho}), @raiz)

    assert item.message =~ "regra `r`"
    refute item.message =~ "trecho"
  end
end
