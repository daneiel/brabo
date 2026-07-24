defmodule Engine.Infra.InfraGateRunnerTest do
  # Sem DataCase — DETERMINÍSTICO, sem GenServer/LLM: só o
  # FakeEngineApiClient (scriptado por dicionário de processo) + os
  # detectors (.Fake). async: false (Application env global).
  use ExUnit.Case, async: false

  alias Engine.Infra.InfraGateRunner
  alias Engine.Sessions.FakeEngineApiClient

  setup do
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :gate_dispatcher, Engine.Gates.FakeGateDispatcher)
    Application.put_env(:engine, :hadolint_detector, Engine.Actions.HadolintDetector.Fake)
    Application.put_env(:engine, :semgrep_detector, Engine.Actions.SemgrepDetector.Fake)
    Application.put_env(:engine, :gitleaks_detector, Engine.Actions.GitleaksDetector.Fake)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :gate_dispatcher)
      Application.delete_env(:engine, :hadolint_detector)
      Application.delete_env(:engine, :semgrep_detector)
      Application.delete_env(:engine, :gitleaks_detector)
      Application.delete_env(:engine, :hadolint_fake_available)
      Application.delete_env(:engine, :hadolint_fake_result)
      Application.delete_env(:engine, :semgrep_fake_available)
      Application.delete_env(:engine, :semgrep_fake_result)
      Application.delete_env(:engine, :gitleaks_fake_available)
      Application.delete_env(:engine, :gitleaks_fake_result)
      Application.delete_env(:engine, :fake_infra_pr_files)
      Application.delete_env(:engine, :test_pid)
    end)

    :ok
  end

  test "run_qa: Dockerfile com erro de lint vira changes_requested" do
    Process.put(:fake_infra_pr_files, %{
      "title" => "infra",
      "files" => [%{"path" => "Dockerfile", "content" => "FROM node"}]
    })

    Application.put_env(:engine, :hadolint_fake_available, true)

    Application.put_env(
      :engine,
      :hadolint_fake_result,
      {:ok, [%{tool: "hadolint", path: "Dockerfile", line: 1, message: "pin a versão da imagem"}]}
    )

    Process.put(:fake_infra_gate_verdict_response, %{"nextAction" => "correct"})

    InfraGateRunner.run_qa("proj-1", "sess-1", "pa-1")

    assert_received {:infra_pr_files_fetched, "pa-1"}

    assert_received {:event_appended, "proj-1", "sess-1",
                     %{type: "artifact.qa_verdict", payload: %{veredito: "changes_requested"}}}

    assert_received {:infra_gate_verdict_recorded, "pa-1", "qa", "changes_requested", _resumo,
                     itens, _max}

    assert Enum.any?(itens, &(&1 =~ "pin a versão da imagem"))
  end

  test "run_qa: Dockerfile limpo aprova e dispara run_secops" do
    Process.put(:fake_infra_pr_files, %{
      "title" => "infra",
      "files" => [%{"path" => "Dockerfile", "content" => "FROM node:20"}]
    })

    Application.put_env(:engine, :hadolint_fake_available, true)
    Application.put_env(:engine, :hadolint_fake_result, {:ok, []})
    Process.put(:fake_infra_gate_verdict_response, %{"nextAction" => "run_secops"})

    InfraGateRunner.run_qa("proj-1", "sess-1", "pa-1")

    assert_received {:infra_gate_verdict_recorded, "pa-1", "qa", "approved", _, [], _}
    assert_received {:infra_gate_dispatch, :secops, "proj-1", "sess-1", "pa-1"}
  end

  test "run_qa: sem Dockerfile entre os arquivos, aprova sem rodar hadolint" do
    Process.put(:fake_infra_pr_files, %{
      "title" => "infra",
      "files" => [%{"path" => "docker-compose.yml", "content" => "services: {}"}]
    })

    Process.put(:fake_infra_gate_verdict_response, %{"nextAction" => "run_secops"})

    InfraGateRunner.run_qa("proj-1", "sess-1", "pa-1")

    assert_received {:infra_gate_verdict_recorded, "pa-1", "qa", "approved", _, [], _}
  end

  test "run_secops: segredo achado pelo gitleaks vira changes_requested, pede correção ao InfraAgent" do
    Process.put(:fake_infra_pr_files, %{
      "title" => "infra",
      "files" => [%{"path" => "Dockerfile", "content" => "ENV AWS_KEY=abc123"}]
    })

    Application.put_env(:engine, :gitleaks_fake_available, true)

    Application.put_env(
      :engine,
      :gitleaks_fake_result,
      {:ok, [%{tool: "gitleaks", path: "Dockerfile", line: 1, message: "AWS key hardcoded"}]}
    )

    Application.put_env(:engine, :semgrep_fake_available, false)
    Process.put(:fake_infra_gate_verdict_response, %{"nextAction" => "correct"})

    InfraGateRunner.run_secops("proj-1", "sess-1", "pa-1")

    assert_received {:event_appended, "proj-1", "sess-1",
                     %{type: "artifact.secops_verdict", payload: %{veredito: "changes_requested"}}}

    assert_received {:infra_gate_verdict_recorded, "pa-1", "secops", "changes_requested", _,
                     itens, _}

    assert Enum.any?(itens, &(&1 =~ "AWS key hardcoded"))
  end

  test "run_secops: sem achados, aprova (chega em awaiting_user)" do
    Process.put(:fake_infra_pr_files, %{
      "title" => "infra",
      "files" => [%{"path" => "Dockerfile", "content" => "FROM node:20"}]
    })

    Application.put_env(:engine, :gitleaks_fake_available, true)
    Application.put_env(:engine, :gitleaks_fake_result, {:ok, []})
    Application.put_env(:engine, :semgrep_fake_available, true)
    Application.put_env(:engine, :semgrep_fake_result, {:ok, []})
    Process.put(:fake_infra_gate_verdict_response, %{"nextAction" => "done"})

    InfraGateRunner.run_secops("proj-1", "sess-1", "pa-1")

    assert_received {:infra_gate_verdict_recorded, "pa-1", "secops", "approved", _, [], _}
  end

  test "scanner ausente: pula, registra no resumo, NUNCA quebra o gate" do
    Process.put(:fake_infra_pr_files, %{
      "title" => "infra",
      "files" => [%{"path" => "Dockerfile", "content" => "FROM node:20"}]
    })

    Application.put_env(:engine, :gitleaks_fake_available, false)
    Application.put_env(:engine, :semgrep_fake_available, false)
    Process.put(:fake_infra_gate_verdict_response, %{"nextAction" => "done"})

    InfraGateRunner.run_secops("proj-1", "sess-1", "pa-1")

    assert_received {:infra_gate_verdict_recorded, "pa-1", "secops", "approved", resumo, [], _}
    assert resumo =~ "indisponível"
  end
end
