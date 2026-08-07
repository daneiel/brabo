defmodule Engine.Harness.ToolsTest do
  # async: false — mexe em Application env global (:engine_api_client, :test_pid,
  # :project_workspaces_root).
  use ExUnit.Case, async: false

  alias Engine.Harness.Tools.{WriteFile, EmitArtifact}
  alias Engine.Harness.Hooks.ActionPipeline
  alias Engine.Harness.ArtifactSchemas
  alias Engine.Actions.Workspace

  setup do
    root =
      Path.join(
        System.tmp_dir!(),
        "brabo-tools-test-#{System.os_time(:microsecond)}-#{System.unique_integer([:positive])}"
      )

    project_id = "proj-#{System.unique_integer([:positive])}"

    # A env PRECISA ser setada antes de Workspace.workspace_dir/1, que a
    # lê com fetch_env! — antes, este setup dependia de outro teste ter
    # vazado :project_workspaces_root, e quebrava quando rodava depois de
    # um que limpa (ex.: os workers do Psicólogo/Anamnese).
    Application.put_env(:engine, :project_workspaces_root, root)
    Application.put_env(:engine, :engine_api_client, Engine.Sessions.FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    File.mkdir_p!(Workspace.workspace_dir(project_id))

    on_exit(fn ->
      File.rm_rf!(root)
      Application.delete_env(:engine, :project_workspaces_root)
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :test_pid)
    end)

    %{
      project_id: project_id,
      session_id: "sess-1",
      ctx_base: %{project_id: project_id, session_id: "sess-1", agent: "echo"}
    }
  end

  test "write_file dentro da whitelist escreve direto", %{project_id: pid, ctx_base: ctx} do
    assert {:ok, _} = WriteFile.run(%{"path" => "scratch/n.txt", "content" => "oi"}, ctx)
    assert File.read!(Path.join(Workspace.workspace_dir(pid), "scratch/n.txt")) == "oi"
  end

  @doc """
  Antes este teste afirmava que a ferramenta pendente devolvia um RESULTADO com
  a palavra "pending". Era o defeito do ADR 0052: o modelo lia aquilo como se
  fosse a resposta do comando, não aprendia nada, e cada tentativa queimava uma
  iteração até a task morrer no teto.

  Agora o hook sinaliza espera, e quem para é o ToolLoop.
  """
  test "write_file fora da whitelist SUSPENDE o laço em vez de responder 'pending'", %{
    ctx_base: base
  } do
    Process.put(:fake_propose_action, %{"id" => "pa-9", "status" => "pending"})

    ctx =
      base
      |> Map.put(:tool, "write_file")
      |> Map.put(:args, %{"path" => "src/app.ex", "content" => "x"})

    assert {:cont, out} = ActionPipeline.call(ctx)

    # Marca de espera, e NENHUM resultado: o lugar da mensagem de ferramenta
    # fica vago para o desfecho de verdade ocupar na retomada.
    assert out[:aguardando_aprovacao] == "pa-9"
    refute Map.has_key?(out, :result)

    assert_received {:propose_action, "write_file", %{kind: "agent", id: "echo"},
                     %{path: "src/app.ex", content: "x"}}
  end

  test "terminal sempre vira proposed_action (via hook), auto-executado retorna o resultado", %{
    ctx_base: base
  } do
    Process.put(:fake_propose_action, %{
      "id" => "pa-1",
      "status" => "executed",
      "executionResult" => %{"exitCode" => 0, "stdout" => "oi\n"}
    })

    ctx =
      base
      |> Map.put(:tool, "terminal")
      |> Map.put(:args, %{"command" => "echo oi"})

    assert {:cont, out} = ActionPipeline.call(ctx)
    assert out[:result] =~ "exit 0"
    assert out[:result] =~ "oi"

    assert_received {:propose_action, "terminal", %{kind: "agent", id: "echo"},
                     %{command: "echo oi"}}
  end

  test "emit_artifact válido emite artifact.<tipo> no event log", %{
    project_id: pid,
    ctx_base: ctx
  } do
    assert {:ok, _} =
             EmitArtifact.run(
               %{"type" => "note", "payload" => %{"title" => "t", "body" => "b"}},
               ctx
             )

    assert_received {:event_appended, ^pid, "sess-1",
                     %{type: "artifact.note", payload: %{"title" => "t"}}}
  end

  test "emit_artifact inválido (chave faltando) falha, sem emitir", %{ctx_base: ctx} do
    assert {:error, _} =
             EmitArtifact.run(%{"type" => "note", "payload" => %{"title" => "só título"}}, ctx)

    refute_received {:event_appended, _, _, _}
  end

  test "ArtifactSchemas.validate cobre ok / chave faltando / tipo desconhecido" do
    assert ArtifactSchemas.validate("note", %{"title" => "t", "body" => "b"}) == :ok

    assert {:error, {:missing_keys, ["body"]}} =
             ArtifactSchemas.validate("note", %{"title" => "t"})

    assert {:error, {:unknown_type, "xyz"}} = ArtifactSchemas.validate("xyz", %{})
  end
end
