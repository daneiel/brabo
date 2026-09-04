defmodule Engine.Sessions.EngineApiClientRagTest do
  @moduledoc """
  As duas funções novas da frente `rag_search`: `rag_search/4` (POST
  `/internal/rag/search`) e `get_prompt_template/2` (GET
  `/internal/graph/prompt-templates/:name`). O contrato das duas rotas é
  fechado por uma frente PARALELA em `apps/api` (N2) — o roundtrip real
  depende dela terminar.

  Duas camadas testadas, mesmo padrão dos vizinhos:

    1. `describe "delegação"` — `Engine.Sessions.EngineApiClient` (o módulo
       de comportamento) chama o impl configurado; aqui trocado por
       `Engine.Sessions.FakeEngineApiClient`, o "mock da camada HTTP" que o
       resto da suite já usa em vez de Bypass/Mox.
    2. `describe "Live — forma da chamada"` — como `engine_api_client_headers_test.exs`/
       `engine_api_client_timeout_test.exs` ao lado: nada aqui faz HTTP real
       (o módulo não tem teste de nível HTTP hoje, e montar um stub só para
       isto seria desproporcional); o que se afirma é a FORMA da chamada —
       rota, corpo, o 404 virando `:not_found`.
  """

  use ExUnit.Case, async: false

  alias Engine.Sessions.EngineApiClient

  @caminho "lib/engine/sessions/engine_api_client.ex"

  describe "delegação (Engine.Sessions.EngineApiClient -> impl configurado)" do
    setup do
      Application.put_env(:engine, :engine_api_client, Engine.Sessions.FakeEngineApiClient)
      Application.put_env(:engine, :test_pid, self())

      on_exit(fn -> Application.delete_env(:engine, :test_pid) end)

      :ok
    end

    test "rag_search/3 usa opts default [] e devolve hits/degraded" do
      Process.put(:fake_rag_search, %{
        "hits" => [%{"path" => "a.md", "excerpt" => "x"}],
        "degraded" => false
      })

      assert {:ok, %{"hits" => [%{"path" => "a.md"}], "degraded" => false}} =
               EngineApiClient.rag_search("p1", "termo", 5)

      assert_received {:rag_search, "p1", "termo", 5}
    end

    test "rag_search/4 propaga erro da api sem esconder o motivo" do
      Process.put(:fake_rag_search, {:error, :timeout})

      assert {:error, :timeout} = EngineApiClient.rag_search("p1", "termo", 3, [])
    end

    test "get_prompt_template/1 usa version nil por padrão (versão vigente)" do
      Process.put(:fake_prompt_template, %{
        "name" => "x",
        "version" => "v1",
        "body" => "corpo",
        "hash" => "h1"
      })

      assert {:ok, %{"name" => "x", "body" => "corpo"}} = EngineApiClient.get_prompt_template("x")
      assert_received {:prompt_template_fetched, "x", nil}
    end

    test "get_prompt_template/2 encaminha a version pedida" do
      Process.put(:fake_prompt_template, %{
        "name" => "x",
        "version" => "v2",
        "body" => "corpo",
        "hash" => "h2"
      })

      assert {:ok, %{"version" => "v2"}} = EngineApiClient.get_prompt_template("x", "v2")
      assert_received {:prompt_template_fetched, "x", "v2"}
    end

    test "get_prompt_template propaga :not_found sem virar erro genérico" do
      Process.put(:fake_prompt_template, {:error, :not_found})

      assert {:error, :not_found} = EngineApiClient.get_prompt_template("nao-existe")
    end
  end

  describe "Live — forma da chamada" do
    setup do
      %{fonte: File.read!(Path.join(File.cwd!(), @caminho))}
    end

    test "rag_search POSTa para /internal/rag/search com projectId/query/topK", %{fonte: fonte} do
      assert fonte =~ ~s("/internal/rag/search")
      assert fonte =~ "%{projectId: project_id, query: query, topK: top_k}"
    end

    test "rag_search (Live) passa pelo funil de POST (post_returning)", %{fonte: fonte} do
      # Âncora com "@impl true" na frente: o outro `def rag_search(project_id`
      # do arquivo é o DELEGADOR da behaviour (sem @impl), que vem antes deste
      # no arquivo — sem a âncora, o split pegaria o trecho errado.
      corpo_da_live = corpo_da_funcao_live(fonte, "rag_search")

      assert corpo_da_live =~ "post_returning("
      assert corpo_da_live =~ "opts"
    end

    test "get_prompt_template GETa /internal/graph/prompt-templates/:name", %{fonte: fonte} do
      assert fonte =~ "/internal/graph/prompt-templates/"
    end

    test "get_prompt_template só acrescenta ?version= quando a version não é nil", %{
      fonte: fonte
    } do
      corpo_da_live = corpo_da_funcao_live(fonte, "get_prompt_template")

      assert corpo_da_live =~ ~s(if version, do: "?version=)
    end

    test "get_prompt_template mapeia 404 para {:error, :not_found}, sem cair no genérico", %{
      fonte: fonte
    } do
      corpo_da_live = corpo_da_funcao_live(fonte, "get_prompt_template")

      assert corpo_da_live =~ "status: 404"
      assert corpo_da_live =~ "{:error, :not_found}"
    end

    test "todo Req.get do módulo (inclusive o novo) passa pelo funil de headers", %{
      fonte: fonte
    } do
      for linha <- String.split(fonte, "\n"),
          String.contains?(linha, "Req.get(") do
        assert String.contains?(linha, "headers: headers()"),
               "Req.get sem o funil de headers: #{String.trim(linha)}"
      end
    end
  end

  # Isola o CORPO da implementação `.Live` de `nome_fn/N` (a que tem
  # `@impl true` na linha de cima) do resto do arquivo. Corta no próximo
  # `@impl true` quando existe (função seguinte); `get_prompt_template` é a
  # ÚLTIMA função `@impl` do arquivo, então cai no fallback (janela fixa) em
  # vez de tentar casar um delimitador que não existe depois dela.
  defp corpo_da_funcao_live(fonte, nome_fn) do
    ancora = "@impl true\n  def #{nome_fn}("
    [_, depois] = String.split(fonte, ancora, parts: 2)

    case String.split(depois, "@impl true", parts: 2) do
      [corpo, _resto] -> corpo
      [unico] -> String.slice(unico, 0, 800)
    end
  end
end
