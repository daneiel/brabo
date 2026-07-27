defmodule Engine.Actions.YamlLintDetectorTest do
  @moduledoc """
  Testes do detector REAL contra o binário do container. Antes do ADR 0021 o
  gate de QA de infra só olhava Dockerfile: uma PR só com compose e pipeline de
  CI era aprovada sem checagem nenhuma.

  O caso do YAML sem quebra de linha final é o que fixa a escolha da config:
  com o perfil `relaxed` do yamllint isso sai como `[error]`, e como YAML
  gerado por LLM raramente termina com newline, o gate reprovaria toda PR.
  """
  use ExUnit.Case, async: true

  @moduletag :yamllint

  alias Engine.Actions.YamlLintDetector.Live

  test "compose válido não produz achado" do
    conteudo = """
    services:
      api:
        image: node:24-alpine
        ports:
          - "3000:3000"
    """

    assert {:ok, []} = Live.lint(conteudo)
  end

  test "YAML válido SEM quebra de linha final continua limpo" do
    assert {:ok, []} = Live.lint("services:\n  api:\n    image: node:24-alpine")
  end

  test "estilo não reprova: linha longa e ausência de --- passam" do
    longa = String.duplicate("a", 200)
    assert {:ok, []} = Live.lint("services:\n  api:\n    command: #{longa}\n")
  end

  test "YAML que não parseia produz achado de nível error" do
    assert {:ok, [finding]} = Live.lint("services:\n  api:\n   image: node\n     ports: [\n")

    assert finding.tool == "yamllint"
    assert finding.level == "error"
    assert is_integer(finding.line)
    assert finding.message =~ "syntax error"
  end
end
