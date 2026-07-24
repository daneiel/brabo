defmodule Engine.Infra.Tools.ValidateInfraFileTest do
  # Sem DataCase — puro, só o detector (.Fake) scriptado via Application.env.
  use ExUnit.Case, async: false

  alias Engine.Infra.Tools.ValidateInfraFile

  setup do
    Application.put_env(:engine, :hadolint_detector, Engine.Actions.HadolintDetector.Fake)

    on_exit(fn ->
      Application.delete_env(:engine, :hadolint_detector)
      Application.delete_env(:engine, :hadolint_fake_available)
      Application.delete_env(:engine, :hadolint_fake_result)
    end)

    :ok
  end

  test "hadolint indisponível: mensagem informativa, NUNCA quebra o turno (:ok)" do
    Application.put_env(:engine, :hadolint_fake_available, false)

    assert {:ok, msg} = ValidateInfraFile.run(%{"content" => "FROM node:20"}, %{})
    assert msg =~ "indisponível"
  end

  test "hadolint disponível sem achados: aprova" do
    Application.put_env(:engine, :hadolint_fake_available, true)
    Application.put_env(:engine, :hadolint_fake_result, {:ok, []})

    assert {:ok, msg} = ValidateInfraFile.run(%{"content" => "FROM node:20"}, %{})
    assert msg =~ "nenhum achado"
  end

  test "hadolint disponível com achado: lista o achado" do
    Application.put_env(:engine, :hadolint_fake_available, true)

    Application.put_env(
      :engine,
      :hadolint_fake_result,
      {:ok, [%{tool: "hadolint", path: "Dockerfile", line: 1, message: "pin a versão da imagem"}]}
    )

    assert {:ok, msg} = ValidateInfraFile.run(%{"content" => "FROM node"}, %{})
    assert msg =~ "1 achado"
    assert msg =~ "pin a versão da imagem"
  end

  test "sem `content` retorna erro" do
    assert {:error, msg} = ValidateInfraFile.run(%{}, %{})
    assert msg =~ "content"
  end
end
