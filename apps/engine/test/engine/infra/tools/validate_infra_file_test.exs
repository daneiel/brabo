defmodule Engine.Infra.Tools.ValidateInfraFileTest do
  # Sem DataCase — puro, só os detectors (.Fake) scriptados via Application.env.
  use ExUnit.Case, async: false

  alias Engine.Infra.Tools.ValidateInfraFile

  setup do
    Application.put_env(:engine, :hadolint_detector, Engine.Actions.HadolintDetector.Fake)
    Application.put_env(:engine, :actionlint_detector, Engine.Actions.ActionlintDetector.Fake)

    on_exit(fn ->
      Application.delete_env(:engine, :hadolint_detector)
      Application.delete_env(:engine, :hadolint_fake_available)
      Application.delete_env(:engine, :hadolint_fake_result)
      Application.delete_env(:engine, :actionlint_detector)
      Application.delete_env(:engine, :actionlint_fake_available)
      Application.delete_env(:engine, :actionlint_fake_result)
    end)

    :ok
  end

  describe "Dockerfile -> hadolint" do
    test "hadolint indisponível: mensagem informativa, NUNCA quebra o turno (:ok)" do
      Application.put_env(:engine, :hadolint_fake_available, false)

      assert {:ok, msg} =
               ValidateInfraFile.run(%{"path" => "Dockerfile", "content" => "FROM node:20"}, %{})

      assert msg =~ "indisponível"
    end

    test "hadolint disponível sem achados: aprova" do
      Application.put_env(:engine, :hadolint_fake_available, true)
      Application.put_env(:engine, :hadolint_fake_result, {:ok, []})

      assert {:ok, msg} =
               ValidateInfraFile.run(%{"path" => "Dockerfile", "content" => "FROM node:20"}, %{})

      assert msg =~ "nenhum achado"
    end

    test "hadolint disponível com achado: lista o achado" do
      Application.put_env(:engine, :hadolint_fake_available, true)

      Application.put_env(
        :engine,
        :hadolint_fake_result,
        {:ok,
         [%{tool: "hadolint", path: "Dockerfile", line: 1, message: "pin a versão da imagem"}]}
      )

      assert {:ok, msg} =
               ValidateInfraFile.run(%{"path" => "Dockerfile", "content" => "FROM node"}, %{})

      assert msg =~ "1 achado"
      assert msg =~ "pin a versão da imagem"
    end
  end

  describe "workflow do GitHub Actions -> actionlint (Fase 8c)" do
    test "actionlint indisponível: mensagem informativa, NUNCA quebra o turno" do
      Application.put_env(:engine, :actionlint_fake_available, false)

      assert {:ok, msg} =
               ValidateInfraFile.run(
                 %{"path" => ".github/workflows/ci.yml", "content" => "on: pull_request"},
                 %{}
               )

      assert msg =~ "indisponível"
    end

    test "actionlint disponível sem achados: aprova" do
      Application.put_env(:engine, :actionlint_fake_available, true)
      Application.put_env(:engine, :actionlint_fake_result, {:ok, []})

      assert {:ok, msg} =
               ValidateInfraFile.run(
                 %{"path" => ".github/workflows/ci.yml", "content" => "on: pull_request"},
                 %{}
               )

      assert msg =~ "nenhum achado"
    end

    test "actionlint disponível com achado: lista o achado" do
      Application.put_env(:engine, :actionlint_fake_available, true)

      Application.put_env(
        :engine,
        :actionlint_fake_result,
        {:ok,
         [
           %{
             tool: "actionlint",
             path: ".github/workflows/ci.yml",
             line: 3,
             message: "ação desatualizada"
           }
         ]}
      )

      assert {:ok, msg} =
               ValidateInfraFile.run(
                 %{"path" => ".github/workflows/ci.yml", "content" => "on: push"},
                 %{}
               )

      assert msg =~ "1 achado"
      assert msg =~ "ação desatualizada"
    end

    test "hadolint disponível não é chamado pra um workflow — não deve linkar Dockerfile com CI" do
      Application.put_env(:engine, :hadolint_fake_available, true)
      Application.put_env(:engine, :hadolint_fake_result, {:error, :nao_deveria_rodar})
      Application.put_env(:engine, :actionlint_fake_available, true)
      Application.put_env(:engine, :actionlint_fake_result, {:ok, []})

      assert {:ok, msg} =
               ValidateInfraFile.run(
                 %{"path" => ".github/workflows/ci.yml", "content" => "on: push"},
                 %{}
               )

      assert msg =~ "actionlint"
    end
  end

  describe ".gitlab-ci.yml — gap documentado (Fase 8c/ADR 0039)" do
    test "sem linter estático local — segue sem validar, nunca quebra o turno" do
      assert {:ok, msg} =
               ValidateInfraFile.run(
                 %{"path" => ".gitlab-ci.yml", "content" => "stages: [build]"},
                 %{}
               )

      assert msg =~ "sem linter estático local"
    end
  end

  describe "qualquer outro caminho (ex.: compose)" do
    test "nada a validar localmente aqui — o gate de infra cobre YAML genérico depois" do
      assert {:ok, msg} =
               ValidateInfraFile.run(
                 %{"path" => "docker-compose.yml", "content" => "services: {}"},
                 %{}
               )

      assert msg =~ "nada a validar"
    end
  end

  test "sem `path`/`content` retorna erro" do
    assert {:error, msg} = ValidateInfraFile.run(%{}, %{})
    assert msg =~ "path"
    assert msg =~ "content"
  end
end
