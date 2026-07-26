defmodule Engine.Actions.HadolintDetectorTest do
  @moduledoc """
  Testes do detector REAL contra o binário do container. São a regressão do
  achado do ADR 0021: o `hadolint` não estava instalado, e como
  `InfraGateRunner.lint_dockerfiles/1` trata a ausência como "pulado", o gate
  de QA de infra aprovava QUALQUER Dockerfile — inclusive um que nem parseia.

  Também fixam a separação de severidade, que é o que torna o gate utilizável:
  erro de sintaxe reprova, nit de estilo não.
  """
  use ExUnit.Case, async: true

  @moduletag :hadolint

  alias Engine.Actions.HadolintDetector.Live

  test "Dockerfile plausível não produz NENHUM achado de nível error" do
    # É o caso que decide se o gate é usável: este Dockerfile é perfeitamente
    # razoável e ainda assim colhe o warning DL3018 ("pin versions in apk add").
    # Se `warning` reprovasse, nenhum Dockerfile gerado por LLM passaria e o
    # InfraAgent circularia até estourar o teto de correções.
    conteudo = """
    FROM node:24-alpine
    RUN apk add --no-cache git
    CMD ["node"]
    """

    assert {:ok, findings} = Live.lint(conteudo)
    refute Enum.any?(findings, &(&1.level == "error"))
  end

  test "Dockerfile que não parseia produz achado de nível error" do
    assert {:ok, findings} = Live.lint("ISTO NAO E UM DOCKERFILE\nFROM\n")

    erro = Enum.find(findings, &(&1.level == "error"))
    assert erro, "esperava um achado de nível error, veio: #{inspect(findings)}"
    assert erro.tool == "hadolint"
    assert erro.path == "Dockerfile"
    assert is_integer(erro.line)
    assert erro.message =~ "DL1000"
  end

  test "todo achado carrega level — sem isso o gate não sabe o que reprova" do
    assert {:ok, findings} = Live.lint("FROM node\nRUN cd /app && npm install\n")
    assert findings != []
    assert Enum.all?(findings, &is_binary(&1.level))
  end
end
