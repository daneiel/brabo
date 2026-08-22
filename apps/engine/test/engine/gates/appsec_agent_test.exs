defmodule Engine.Gates.AppSecAgentTest do
  # DataCase — ToolLoop monta a camada `:contexto_projeto` do prompt lendo o
  # projeto do banco (Engine.Harness.ProjectContext), mesmo motivo de
  # QaPerformanceSegurancaAgentTest usar DataCase. async: false — mexe em
  # Application env global (:project_workspaces_root e companhia): o appsec
  # não passa `:workspace_root` (sem worktree — RN-360), então
  # `InstructionFiles.Live.build/3` cai no fallback
  # `Workspace.workspace_dir/1`, que PRECISA da env (mesmo motivo de
  # `tool_loop_test.exs`/`tools_test.exs`).
  use Engine.DataCase, async: false

  alias Engine.Gates.AppSecAgent
  alias Engine.Sessions.FakeEngineApiClient

  setup do
    root =
      Path.join(
        System.tmp_dir!(),
        "brabo-appsec-test-#{System.os_time(:microsecond)}-#{System.unique_integer([:positive])}"
      )

    Application.put_env(:engine, :project_workspaces_root, root)
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      File.rm_rf!(root)
      Application.delete_env(:engine, :project_workspaces_root)
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :test_pid)
      Application.delete_env(:engine, :tool_loop_max_iterations)
    end)

    project_id = Ecto.UUID.generate()

    story = %{
      "id" => "st-1",
      "sessionId" => Ecto.UUID.generate(),
      "title" => "Login social",
      "description" => "Como usuário, quero entrar com GitHub/GitLab.",
      "rf" => ["Aceita e-mail já verificado pelo provider"],
      "rnf" => [],
      "moduleIds" => ["api"]
    }

    module_map = %{
      "modules" => [
        %{"name" => "api", "stack" => "nest", "responsibility" => "auth"},
        %{"name" => "web", "stack" => "react", "responsibility" => "ui"}
      ]
    }

    %{project_id: project_id, story: story, module_map: module_map}
  end

  test "reusa o registro de ferramentas sem Terminal, de propósito" do
    nomes = AppSecAgent.tools() |> Enum.map(fn modulo -> modulo.spec().name end)

    refute "terminal" in nomes
    refute "write_file" in nomes
    assert "read_file" in nomes
    assert "search_workspace" in nomes
    assert "emit_threat_model" in nomes
  end

  test "emite o threat model com o checklist STRIDE-lite", %{
    project_id: project_id,
    story: story,
    module_map: module_map
  } do
    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("emit_threat_model", %{
        "threatModel" => "Spoofing: coberto pelo login social. Tampering: ...",
        "requisitosSeguranca" => ["Validar e-mail verificado pelo provider antes de vincular"],
        "riscos" => []
      })
    ])

    assert {:ok, resultado} = AppSecAgent.run(project_id, story, module_map)
    assert resultado.threat_model =~ "Spoofing"

    assert resultado.requisitos_de_seguranca == [
             "Validar e-mail verificado pelo provider antes de vincular"
           ]

    assert resultado.riscos == []

    assert_received {:llm_turn, "appsec", _messages, _tools}
  end

  test "lê o workspace antes de concluir, quando o modelo pedir", %{
    project_id: project_id,
    story: story,
    module_map: module_map
  } do
    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("read_file", %{"path" => "docs/adr/0031.md"}),
      FakeEngineApiClient.tool_call_response("emit_threat_model", %{
        "threatModel" => "checklist completo",
        "requisitosSeguranca" => [],
        "riscos" => ["conta sem senha herda o estado pendente da migração"]
      })
    ])

    assert {:ok, resultado} = AppSecAgent.run(project_id, story, module_map)
    assert resultado.riscos == ["conta sem senha herda o estado pendente da migração"]
  end

  test "não conclui -> {:blocked, ...}, origem modelo", %{
    project_id: project_id,
    story: story,
    module_map: module_map
  } do
    Process.put(:fake_llm_turns, [])

    assert {:blocked, %{reason: reason, diagnosis: diagnosis, origin: "modelo"}} =
             AppSecAgent.run(project_id, story, module_map)

    assert reason =~ "appsec"
    assert diagnosis =~ "emit_threat_model"
  end

  test "story sem módulo do module_map presente: avisa em vez de inventar", %{
    project_id: project_id,
    story: story
  } do
    module_map = %{"modules" => [%{"name" => "outro-modulo", "stack" => "go"}]}

    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("emit_threat_model", %{
        "threatModel" => "ok",
        "requisitosSeguranca" => [],
        "riscos" => []
      })
    ])

    assert {:ok, _} = AppSecAgent.run(project_id, story, module_map)

    assert_received {:llm_turn, "appsec", messages, _tools}
    prompt = Enum.map_join(messages, "\n", &Map.get(&1, "content", ""))
    assert prompt =~ "nenhum módulo do module_map bate"
  end

  test "sem module_map vigente: prompt avisa, não quebra", %{project_id: project_id, story: story} do
    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("emit_threat_model", %{
        "threatModel" => "ok",
        "requisitosSeguranca" => [],
        "riscos" => []
      })
    ])

    assert {:ok, _} = AppSecAgent.run(project_id, story, nil)

    assert_received {:llm_turn, "appsec", messages, _tools}
    prompt = Enum.map_join(messages, "\n", &Map.get(&1, "content", ""))
    assert prompt =~ "sem module_map vigente"
  end
end
