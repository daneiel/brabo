defmodule Engine.Harness.Tools.RagSearchTest do
  @moduledoc """
  `rag_search`: leitura sem efeito externo (`:direct`) que busca no RAG do
  projeto (ADR 0080/0082) e devolve trechos CITÁVEIS. Duas regras importam
  mais que o resto:

    1. degradação (`degraded: true` — léxico-only, sem embedding) NUNCA fica
       escondida do modelo, e vai no INÍCIO do texto, onde um teto de bytes
       não pode cortá-la fora;
    2. o teto de bytes é PRÓPRIO desta tool (RN-150) — variável
       `:rag_search_max_bytes`, nunca reaproveita `:search_workspace_max_bytes`
       nem `:read_file_max_bytes`.

  O `EngineApiClient` é mockado via `Engine.Sessions.FakeEngineApiClient`
  (mesmo padrão de `listar_backlog_test.exs`) — o roundtrip real contra
  `POST /internal/rag/search` depende da frente paralela N2 (api) terminar.
  """

  use ExUnit.Case, async: false

  alias Engine.Harness.Tools.RagSearch

  setup do
    Application.put_env(:engine, :engine_api_client, Engine.Sessions.FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      Application.delete_env(:engine, :test_pid)
      Application.delete_env(:engine, :rag_search_max_bytes)
    end)

    %{ctx: %{project_id: "p1", session_id: "s1", agent: "po"}}
  end

  test "hits formatados com citação de path (e chunk/excerpt)", %{ctx: ctx} do
    Process.put(:fake_rag_search, %{
      "hits" => [
        %{"path" => "docs/adr/0080.md", "excerpt" => "trecho do ADR", "score" => 0.9},
        %{"path" => "docs/business-rules.md", "chunk" => "RN-150 diz isto", "score" => 0.7}
      ],
      "degraded" => false
    })

    assert {:ok, texto} = RagSearch.run(%{"query" => "rag hibrido"}, ctx)

    assert_received {:rag_search, "p1", "rag hibrido", 5}
    assert texto =~ "2 trecho(s) encontrado(s)"
    assert texto =~ "fonte: docs/adr/0080.md"
    assert texto =~ "trecho do ADR"
    assert texto =~ "fonte: docs/business-rules.md"
    assert texto =~ "RN-150 diz isto"
    refute texto =~ "AVISO"
  end

  test "top_k é clampado no teto PRÓPRIO da tool, nunca ultrapassa o máximo", %{ctx: ctx} do
    Process.put(:fake_rag_search, %{"hits" => [], "degraded" => false})

    RagSearch.run(%{"query" => "x", "top_k" => 999}, ctx)

    assert_received {:rag_search, "p1", "x", 10}
  end

  test "top_k ausente usa o default (5)", %{ctx: ctx} do
    Process.put(:fake_rag_search, %{"hits" => [], "degraded" => false})

    RagSearch.run(%{"query" => "x"}, ctx)

    assert_received {:rag_search, "p1", "x", 5}
  end

  test "top_k inválido (não inteiro/negativo) cai no default", %{ctx: ctx} do
    Process.put(:fake_rag_search, %{"hits" => [], "degraded" => false})

    RagSearch.run(%{"query" => "x", "top_k" => "muitos"}, ctx)

    assert_received {:rag_search, "p1", "x", 5}
  end

  test "degraded: true aparece EXPLICITAMENTE, no início do texto", %{ctx: ctx} do
    Process.put(:fake_rag_search, %{
      "hits" => [%{"path" => "a.md", "excerpt" => "trecho"}],
      "degraded" => true
    })

    assert {:ok, texto} = RagSearch.run(%{"query" => "x"}, ctx)
    assert texto =~ "AVISO"
    assert texto =~ "DEGRADADA"
    assert texto =~ "léxico"

    {posicao, _} = :binary.match(texto, "AVISO")
    assert posicao == 1
  end

  test "sem hits, resposta legítima dizendo pra refinar (não é erro)", %{ctx: ctx} do
    Process.put(:fake_rag_search, %{"hits" => [], "degraded" => false})

    assert {:ok, texto} = RagSearch.run(%{"query" => "termo raro"}, ctx)
    assert texto =~ "nenhum resultado"
    assert texto =~ "termo raro"
  end

  test "sem hits E degradado: o aviso ainda aparece", %{ctx: ctx} do
    Process.put(:fake_rag_search, %{"hits" => [], "degraded" => true})

    assert {:ok, texto} = RagSearch.run(%{"query" => "x"}, ctx)
    assert texto =~ "AVISO"
    assert texto =~ "nenhum resultado"
  end

  test "falha de rede/api vira tool-result de erro, sem crashar o ToolLoop", %{ctx: ctx} do
    Process.put(:fake_rag_search, {:error, :timeout})

    assert {:error, texto} = RagSearch.run(%{"query" => "x"}, ctx)
    assert texto =~ "falha ao buscar no RAG"
    assert texto =~ "timeout"
  end

  test "resposta em formato inesperado vira erro legível, não crash", %{ctx: ctx} do
    Process.put(:fake_rag_search, %{"algo" => "diferente"})

    assert {:error, texto} = RagSearch.run(%{"query" => "x"}, ctx)
    assert texto =~ "resposta inesperada"
  end

  test "sem `query`, recusa dizendo o que falta", %{ctx: ctx} do
    assert {:error, texto} = RagSearch.run(%{}, ctx)
    assert texto =~ "exige o argumento `query`"
  end

  test "`query` vazia é tratada como ausente", %{ctx: ctx} do
    assert {:error, texto} = RagSearch.run(%{"query" => ""}, ctx)
    assert texto =~ "exige o argumento `query`"
  end

  describe "teto de bytes (RN-150 — variável própria desta tool)" do
    test "resultado grande é truncado com marca dirigida ao modelo", %{ctx: ctx} do
      Application.put_env(:engine, :rag_search_max_bytes, 200)

      hits =
        for i <- 1..5 do
          %{"path" => "arquivo-#{i}.md", "excerpt" => String.duplicate("x", 200)}
        end

      Process.put(:fake_rag_search, %{"hits" => hits, "degraded" => false})

      assert {:ok, texto} = RagSearch.run(%{"query" => "x"}, ctx)
      assert byte_size(texto) < 5 * 200
      assert texto =~ "resultado truncado"
      assert texto =~ "refine a busca"
    end

    test "resultado pequeno passa intacto, sem marca de truncagem", %{ctx: ctx} do
      Application.put_env(:engine, :rag_search_max_bytes, 10_000)

      Process.put(:fake_rag_search, %{
        "hits" => [%{"path" => "a.md", "excerpt" => "curto"}],
        "degraded" => false
      })

      assert {:ok, texto} = RagSearch.run(%{"query" => "x"}, ctx)
      refute texto =~ "truncado"
    end

    test "degradação sobrevive à truncagem porque vai no início", %{ctx: ctx} do
      Application.put_env(:engine, :rag_search_max_bytes, 60)

      hits = [%{"path" => "a.md", "excerpt" => String.duplicate("y", 500)}]
      Process.put(:fake_rag_search, %{"hits" => hits, "degraded" => true})

      assert {:ok, texto} = RagSearch.run(%{"query" => "x"}, ctx)
      assert texto =~ "AVISO"
      assert texto =~ "DEGRADADA"
    end
  end
end
