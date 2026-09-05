defmodule Engine.Infra.Tools.ProposeContainerStartViaRunnerTest do
  @moduledoc """
  A tool em si é uma SALVAGUARDA de `@behaviour` (RN-506, ADR 0145) —
  `Engine.Infra.InfraLeadServer.dispatch_calls/2` intercepta o nome
  `container_start_via_runner` ANTES de `run_tool/3` existir para ela, então
  o que este arquivo prova é o CONTRATO (spec só com `rationale` opcional,
  `run/2` nunca deveria ser alcançado) — o comportamento de verdade
  (consultar `execution_mode`/runner conectado, chamar `propose_action`)
  está em `Engine.Infra.InfraLeadServerTest`.
  """
  use ExUnit.Case, async: true

  alias Engine.Infra.Tools.ProposeContainerStartViaRunner

  test "spec/0: nome, e schema só com rationale opcional — SEM imagem/network/resources" do
    spec = ProposeContainerStartViaRunner.spec()

    assert spec.name == "container_start_via_runner"

    propriedades = spec.parameters["properties"]
    assert Map.keys(propriedades) == ["rationale"]
    refute Map.has_key?(propriedades, "imagem")
    refute Map.has_key?(propriedades, "network")
    refute Map.has_key?(propriedades, "resources")

    # Diferente de `propose_container_start`, nada é obrigatório: a imagem já
    # está decidida, não há candidata pra eleger, e `rationale` é só contexto.
    assert spec.parameters["required"] == []
  end

  test "category/0: :direct — mesmo calibre de propose_container_start" do
    assert ProposeContainerStartViaRunner.category() == :direct
  end

  test "run/2: nunca deveria ser chamado — devolve erro nomeando o motivo" do
    assert {:error, mensagem} = ProposeContainerStartViaRunner.run(%{}, %{})
    assert mensagem =~ "InfraLeadServer"
  end
end
