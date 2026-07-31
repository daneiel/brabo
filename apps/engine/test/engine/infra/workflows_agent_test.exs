defmodule Engine.Infra.WorkflowsAgentTest do
  use Engine.DataCase, async: false

  alias Engine.Infra.WorkflowsAgent
  alias Engine.Sessions.FakeEngineApiClient

  setup do
    root =
      Path.join(
        System.tmp_dir!(),
        "brabo-workflows-#{System.os_time(:microsecond)}-#{System.unique_integer([:positive])}"
      )

    Application.put_env(:engine, :project_workspaces_root, root)
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :hadolint_detector, Engine.Actions.HadolintDetector.Fake)
    Application.put_env(:engine, :actionlint_detector, Engine.Actions.ActionlintDetector.Fake)
    Application.put_env(:engine, :actionlint_fake_available, false)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      File.rm_rf!(root)
      Application.delete_env(:engine, :project_workspaces_root)
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :hadolint_detector)
      Application.delete_env(:engine, :actionlint_detector)
      Application.delete_env(:engine, :actionlint_fake_available)
      Application.delete_env(:engine, :test_pid)
    end)

    %{project_id: Ecto.UUID.generate(), session_id: Ecto.UUID.generate()}
  end

  defp ctx(git_provider) do
    %{
      "moduleMap" => %{
        "modules" => [%{"name" => "api", "stack" => "node", "responsibility" => "backend"}]
      },
      "gitProvider" => git_provider
    }
  end

  test "reusa o registro de ferramentas sem Terminal, sem worktree" do
    nomes = WorkflowsAgent.tools() |> Enum.map(fn m -> m.spec().name end)
    refute "terminal" in nomes
    refute "write_file" in nomes
    refute "read_file" in nomes
    assert "validate_infra_file" in nomes
    assert "emit_infra_delegation_result" in nomes
  end

  test "provider github: gera .github/workflows/ci.yml", %{project_id: pid, session_id: sid} do
    files = [%{"path" => ".github/workflows/ci.yml", "content" => "on: pull_request"}]

    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("validate_infra_file", %{
        "path" => ".github/workflows/ci.yml",
        "content" => "on: pull_request"
      }),
      FakeEngineApiClient.tool_call_response("emit_infra_delegation_result", %{
        "summary" => "pipeline de CI",
        "files" => files
      })
    ])

    assert {:ok, %{files: ^files, summary: "pipeline de CI"}} =
             WorkflowsAgent.run(pid, sid, ctx("github"))

    assert_received {:llm_turn, "infra-workflows", messages, _tools}
    assert Enum.any?(messages, &String.contains?(&1["content"] || "", "(github)"))
  end

  test "provider local (sem repositório provisionado): gera GitHub Actions por padrão", %{
    project_id: pid,
    session_id: sid
  } do
    files = [%{"path" => ".github/workflows/ci.yml", "content" => "on: pull_request"}]

    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("validate_infra_file", %{
        "path" => ".github/workflows/ci.yml",
        "content" => "x"
      }),
      FakeEngineApiClient.tool_call_response("emit_infra_delegation_result", %{
        "summary" => "pipeline de CI",
        "files" => files
      })
    ])

    assert {:ok, _} = WorkflowsAgent.run(pid, sid, ctx(nil))
  end

  test "provider gitlab: gera .gitlab-ci.yml", %{project_id: pid, session_id: sid} do
    files = [%{"path" => ".gitlab-ci.yml", "content" => "stages: [build]"}]

    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("validate_infra_file", %{
        "path" => ".gitlab-ci.yml",
        "content" => "stages: [build]"
      }),
      FakeEngineApiClient.tool_call_response("emit_infra_delegation_result", %{
        "summary" => "pipeline de CI (GitLab)",
        "files" => files
      })
    ])

    assert {:ok, %{files: ^files}} = WorkflowsAgent.run(pid, sid, ctx("gitlab"))

    assert_received {:llm_turn, "infra-workflows", messages, _tools}
    assert Enum.any?(messages, &String.contains?(&1["content"] || "", "(gitlab)"))
  end

  test "recusa terminar sem validate_infra_file prévio", %{project_id: pid, session_id: sid} do
    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("emit_infra_delegation_result", %{
        "summary" => "pipeline de CI",
        "files" => [%{"path" => ".github/workflows/ci.yml", "content" => "x"}]
      })
    ])

    assert {:blocked, info} = WorkflowsAgent.run(pid, sid, ctx("github"))
    assert info.origin == "modelo"
  end

  test "actionlint indisponível degrada sem quebrar o turno", %{project_id: pid, session_id: sid} do
    files = [%{"path" => ".github/workflows/ci.yml", "content" => "on: pull_request"}]

    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("validate_infra_file", %{
        "path" => ".github/workflows/ci.yml",
        "content" => "on: pull_request"
      }),
      FakeEngineApiClient.tool_call_response("emit_infra_delegation_result", %{
        "summary" => "pipeline de CI",
        "files" => files
      })
    ])

    assert {:ok, _} = WorkflowsAgent.run(pid, sid, ctx("github"))
  end

  test "não termina -> {:blocked, ...}, com origem modelo", %{project_id: pid, session_id: sid} do
    Process.put(:fake_llm_turns, [])

    assert {:blocked, %{reason: reason, diagnosis: diagnosis, origin: "modelo"}} =
             WorkflowsAgent.run(pid, sid, ctx("github"))

    assert reason =~ "Workflows"
    assert diagnosis =~ "emit_infra_delegation_result"
  end
end
