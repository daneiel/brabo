defmodule Engine.Harness.Tools.RagFeedbackTest do
  @moduledoc """
  `rag_feedback` (RN-480): o voto do agente sobre um trecho que o `rag_search`
  devolveu. Duas regras importam mais que o resto:

    1. é `:direct` — dar nota a um trecho NÃO é efeito externo e não vira
       `proposed_action`;
    2. a RECUSA por id desconhecido volta como **tool-result de erro**, com o
       motivo que a api mandou, nunca como crash (RN-061/RN-163) — o modelo
       tem com o que corrigir na próxima iteração.

  O `EngineApiClient` é mockado via `Engine.Sessions.FakeEngineApiClient`,
  mesmo padrão de `rag_search_test.exs`.
  """

  use ExUnit.Case, async: false

  alias Engine.Harness.Tools.RagFeedback

  setup do
    Application.put_env(:engine, :engine_api_client, Engine.Sessions.FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      Application.delete_env(:engine, :test_pid)
      Process.delete(:fake_rag_feedback)
    end)

    %{ctx: %{project_id: "p1", session_id: "s1", agent: "qa"}}
  end

  test "é :direct — votar não passa pelo pipeline de ações" do
    assert RagFeedback.category() == :direct
  end

  test "o spec anuncia os dois vereditos e os dois ids que a busca devolve" do
    spec = RagFeedback.spec()

    assert spec.name == "rag_feedback"
    props = spec.parameters["properties"]
    assert props["verdict"]["enum"] == ["util", "irrelevante"]
    assert Map.has_key?(props, "search_id")
    assert Map.has_key?(props, "chunk_id")
    assert Enum.sort(spec.parameters["required"]) == ["chunk_id", "search_id", "verdict"]
  end

  test "caminho feliz: encaminha o voto com o agente do ctx e devolve o RANK", %{ctx: ctx} do
    Process.put(:fake_rag_feedback, %{
      "searchId" => "b-1",
      "chunkId" => "c-9",
      "verdict" => "util",
      "rank" => 4
    })

    assert {:ok, texto} =
             RagFeedback.run(
               %{"search_id" => "b-1", "chunk_id" => "c-9", "verdict" => "util"},
               ctx
             )

    assert_received {:rag_feedback, "p1", "b-1", "c-9", "util", "qa"}
    assert texto =~ "c-9"
    assert texto =~ "util"
    # O rank é a informação que o MODELO não tinha e o servidor tinha.
    assert texto =~ "4º"
  end

  test "sem rank na resposta, a confirmação não inventa posição nenhuma", %{ctx: ctx} do
    Process.put(:fake_rag_feedback, %{"searchId" => "b-1", "chunkId" => "c-9"})

    assert {:ok, texto} =
             RagFeedback.run(
               %{"search_id" => "b-1", "chunk_id" => "c-9", "verdict" => "irrelevante"},
               ctx
             )

    assert texto =~ "irrelevante"
    refute texto =~ "na busca"
  end

  test "CASO DE FALHA: id desconhecido volta como TOOL-RESULT de erro, com o motivo da api", %{
    ctx: ctx
  } do
    Process.put(
      :fake_rag_feedback,
      {:error, {400, %{"message" => "busca `b-x` não existe neste projeto"}}}
    )

    assert {:error, motivo} =
             RagFeedback.run(
               %{"search_id" => "b-x", "chunk_id" => "c-9", "verdict" => "util"},
               ctx
             )

    # A mensagem da api chega inteira: trocá-la por um "falhou" genérico
    # deixaria o modelo adivinhando o que corrigir.
    assert motivo =~ "não existe neste projeto"
    assert motivo =~ "recusado"
  end

  test "CASO DE FALHA: api fora do ar não derruba o turno, vira erro de ferramenta", %{ctx: ctx} do
    Process.put(:fake_rag_feedback, {:error, :timeout})

    assert {:error, motivo} =
             RagFeedback.run(
               %{"search_id" => "b-1", "chunk_id" => "c-9", "verdict" => "util"},
               ctx
             )

    assert motivo =~ "falha ao registrar o feedback do RAG"
  end

  test "CASO DE FALHA: verdict fora dos dois valores é recusado SEM chamar a api", %{ctx: ctx} do
    assert {:error, motivo} =
             RagFeedback.run(
               %{"search_id" => "b-1", "chunk_id" => "c-9", "verdict" => "mais ou menos"},
               ctx
             )

    assert motivo =~ "util"
    assert motivo =~ "irrelevante"
    refute_received {:rag_feedback, _, _, _, _, _}
  end

  test "CASO DE FALHA: argumento faltando vira erro que ENSINA a forma certa", %{ctx: ctx} do
    assert {:error, motivo} = RagFeedback.run(%{"chunk_id" => "c-9"}, ctx)

    assert motivo =~ "search_id"
    assert motivo =~ "rag_search"
    refute_received {:rag_feedback, _, _, _, _, _}
  end

  test "entra nos registros que já tinham `rag_search` — buscar e votar andam juntos" do
    registros = [
      Engine.Harness.Tools.registry(),
      Engine.Dev.Tools.registry(),
      Engine.Gates.QaTools.registry(),
      Engine.Gates.QaEstrategiaAgent.tools(),
      Engine.Gates.QaPerformanceSegurancaAgent.tools(),
      Engine.Gates.AppSecAgent.tools()
    ]

    for registro <- registros do
      nomes = Enum.map(registro, fn modulo -> modulo.spec().name end)
      assert "rag_search" in nomes
      assert "rag_feedback" in nomes
    end
  end
end
