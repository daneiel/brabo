defmodule Engine.Anamnese.ToolsTest do
  # Sem DataCase — só o FakeEngineApiClient (scriptado por dicionário de
  # processo). async: false (Application env global).
  use ExUnit.Case, async: false

  alias Engine.Anamnese.Tools
  alias Engine.Anamnese.Tools.{EmitProficiency, ProposeInstructionPatch}
  alias Engine.Sessions.FakeEngineApiClient

  setup do
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :test_pid)
    end)

    ctx = %{
      project_id: "proj-1",
      session_id: "sess-1",
      window_from: ~U[2026-07-01 00:00:00Z],
      window_to: ~U[2026-07-24 00:00:00Z],
      event_count: 42,
      queued_ids: ["queue-1"]
    }

    %{ctx: ctx}
  end

  defp profile do
    %{
      "userId" => "user-1",
      "competency" => "nestjs",
      "level" => "avancado",
      "rationale" => "corrigiu o agente em injeção de dependência",
      "evidenceEventIds" => ["evt-1"]
    }
  end

  describe "emit_proficiency" do
    test "sucesso: repassa janela, contagem e ids da fila consumida", %{ctx: ctx} do
      assert {:ok, msg} = EmitProficiency.run(%{"profiles" => [profile()]}, ctx)
      assert msg =~ "1 perfil(is)"

      assert_received {:proficiency_recorded, payload}
      assert payload.eventCount == 42
      assert payload.consumedQueueIds == ["queue-1"]
      assert payload.windowFrom == "2026-07-01T00:00:00Z"
    end

    test "competência fora do catálogo: mensagem da api volta verbatim pro modelo",
         %{ctx: ctx} do
      Process.put(
        :fake_record_proficiency_error,
        {400,
         %{
           "message" => "perfil #1 (saúde mental): competência fora do catálogo permitido"
         }}
      )

      assert {:error, msg} = EmitProficiency.run(%{"profiles" => [profile()]}, ctx)
      assert msg =~ "perfis rejeitados"
      assert msg =~ "fora do catálogo permitido"
    end

    test "sem `profiles` retorna erro de uso", %{ctx: ctx} do
      assert {:error, msg} = EmitProficiency.run(%{}, ctx)
      assert msg =~ "profiles"
    end
  end

  describe "propose_instruction_patch" do
    test "sucesso: repassa agente, conteúdo e a hipótese de origem", %{ctx: ctx} do
      assert {:ok, msg} =
               ProposeInstructionPatch.run(
                 %{
                   "agent" => "dev-api",
                   "proposedContent" => "Você é o dev-api.\nSeja direto.\n",
                   "rationale" => "usuário é sênior",
                   "hypothesisId" => "hyp-7"
                 },
                 ctx
               )

      assert msg =~ "dev-api"
      assert_received {:instruction_patch_proposed, payload}
      assert payload.agent == "dev-api"
      assert payload.hypothesisId == "hyp-7"
    end

    test "patch já negado: a recusa da api volta verbatim", %{ctx: ctx} do
      Process.put(
        :fake_instruction_patch_error,
        {400, %{"message" => "este patch para \"dev-api\" já foi negado antes"}}
      )

      assert {:error, msg} =
               ProposeInstructionPatch.run(
                 %{
                   "agent" => "dev-api",
                   "proposedContent" => "x",
                   "rationale" => "y"
                 },
                 ctx
               )

      assert msg =~ "já foi negado antes"
    end

    test "sem os campos obrigatórios retorna erro de uso", %{ctx: ctx} do
      assert {:error, msg} = ProposeInstructionPatch.run(%{"agent" => "x"}, ctx)
      assert msg =~ "proposedContent"
    end
  end

  describe "registry" do
    test "não expõe terminal/write_file (restrição estrutural)" do
      names = Enum.map(Tools.registry(), & &1.spec().name)
      assert "emit_proficiency" in names
      assert "propose_instruction_patch" in names
      refute "terminal" in names
      refute "write_file" in names
    end
  end
end
