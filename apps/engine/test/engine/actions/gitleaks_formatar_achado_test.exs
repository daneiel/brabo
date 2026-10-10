defmodule Engine.Actions.GitleaksFormatarAchadoTest do
  @moduledoc """
  RN-796 (AT-470): o item do parecer do gitleaks leva a regra (`RuleID`) e o
  trecho acusado com o segredo MASCARADO — sem binário, sobre o JSON do
  relatório do `gitleaks dir`.
  """
  use ExUnit.Case, async: true

  alias Engine.Actions.GitleaksDetector.Live

  @wt "/data/project-workspaces/app/.worktrees/dev-api"

  test "caminho feliz: regra e trecho com o Secret trocado por ***" do
    achado =
      Live.formatar_achado(
        %{
          "RuleID" => "generic-api-key",
          "Description" => "Detected a Generic API Key",
          "File" => @wt <> "/test/auth.test.js",
          "StartLine" => 13,
          "Match" => "PASSWORD = 'senha-correta-123'",
          "Secret" => "senha-correta-123"
        },
        @wt
      )

    assert achado.path == "test/auth.test.js"
    assert achado.line == 13
    assert achado.message =~ "[generic-api-key] Detected a Generic API Key"
    assert achado.message =~ "PASSWORD = '***'"
    refute achado.message =~ "senha-correta-123"
  end

  test "falha: sem Secret no relatório, o trecho não vaza o Match em claro" do
    achado =
      Live.formatar_achado(
        %{"RuleID" => "x", "File" => @wt <> "/a.js", "StartLine" => 1, "Match" => "K = 'abc'"},
        @wt
      )

    refute achado.message =~ "abc"
    assert achado.message =~ "trecho: ***"
  end
end
