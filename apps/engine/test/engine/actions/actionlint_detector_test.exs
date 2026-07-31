defmodule Engine.Actions.ActionlintDetectorTest do
  @moduledoc """
  Testes do detector REAL contra o binário do container. Mesma regressão do
  ADR 0021 aplicada ao subagente Workflows (Fase 8c/ADR 0039): sem
  actionlint, um pipeline de CI gerado com sintaxe/ação inválida seria
  proposto sem NENHUMA validação — o gap só é aceitável documentado
  (`ValidateInfraFile` degrada com uma mensagem explícita), nunca silencioso.
  """
  use ExUnit.Case, async: true

  @moduletag :actionlint

  alias Engine.Actions.ActionlintDetector.Live

  test "workflow plausível não produz achado nenhum" do
    conteudo = """
    on:
      pull_request:
        branches: [dev, qa, main]
    jobs:
      build:
        runs-on: ubuntu-latest
        steps:
          - uses: actions/checkout@v4
          - run: echo "hello"
    """

    assert {:ok, []} = Live.lint(conteudo)
  end

  test "action desatualizada produz achado" do
    conteudo = """
    on: push
    jobs:
      build:
        runs-on: ubuntu-latest
        steps:
          - uses: actions/checkout@v2
    """

    assert {:ok, findings} = Live.lint(conteudo)
    assert findings != []
    achado = hd(findings)
    assert achado.tool == "actionlint"
    assert achado.level == "error"
    assert is_integer(achado.line)
    assert achado.message =~ "checkout"
  end

  test "YAML que não parseia produz achado" do
    assert {:ok, findings} = Live.lint("isto: [nao fecha\n")
    assert findings != []
  end
end
