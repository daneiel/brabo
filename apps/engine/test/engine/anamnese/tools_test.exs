defmodule Engine.Anamnese.ToolsTest do
  # Sem DataCase — só o FakeEngineApiClient (scriptado por dicionário de
  # processo). async: false (Application env global).
  use ExUnit.Case, async: false

  alias Engine.Anamnese.Tools
  alias Engine.Anamnese.Tools.{EmitProficiency, ProposeInstructionPatch, ProposeMaxParallel}
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
      # Ids de HIPÓTESE — é o que o patch pode referenciar.
      queued_hypothesis_ids: ["hyp-7"]
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
      refute Map.has_key?(payload, :consumedQueueIds)
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

  describe "propose_max_parallel" do
    test "sucesso: manda area, teto proposto e razao", %{ctx: ctx} do
      assert {:ok, msg} =
               ProposeMaxParallel.run(
                 %{
                   "area" => "dev",
                   "proposto" => 4,
                   "rationale" => "quatro aprovacoes na janela, nenhuma negacao"
                 },
                 ctx
               )

      assert msg =~ "aguardando o usuário decidir"

      assert_received {:max_parallel_proposed, payload}
      assert payload.area == "dev"
      assert payload.proposto == 4
      assert payload.rationale =~ "quatro aprovacoes"
    end

    test "a recusa da api volta VERBATIM pro modelo corrigir", %{ctx: ctx} do
      # A api recusa propor um teto que nao sobe nada. A mensagem dela e o que
      # guia o proximo turno — virar `inspect/1` de tuple perderia isso.
      Process.put(
        :fake_max_parallel_error,
        {400, %{"message" => "o teto da área \"dev\" já é 4; propor 3 não sobe nada"}}
      )

      assert {:error, msg} =
               ProposeMaxParallel.run(
                 %{"area" => "dev", "proposto" => 3, "rationale" => "porque sim"},
                 ctx
               )

      assert msg =~ "já é 4"
    end

    test "sem os campos obrigatorios: erro que diz QUAIS", %{ctx: ctx} do
      assert {:error, msg} = ProposeMaxParallel.run(%{"area" => "dev"}, ctx)
      assert msg =~ "proposto"
      assert msg =~ "rationale"
    end

    test "esta no registro da Anamnese" do
      assert ProposeMaxParallel in Tools.registry()
    end
  end
end
