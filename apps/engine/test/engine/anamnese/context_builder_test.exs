defmodule Engine.Anamnese.ContextBuilderTest do
  @moduledoc """
  `ContextBuilder.fetch/1` compõe a janela temporal (Postgres) com trechos
  relevantes do RAG do projeto (`rag_search`, ADR 0099/0100, RN-414) —
  EM COMPOSIÇÃO, nunca em substituição. As regras que mais importam:

    1. sucesso do `rag_search` entra em `relevant_snippets`/
       `relevant_snippets_degraded`;
    2. qualquer falha (api fora, formato inesperado) degrada pro
       comportamento ATUAL (`relevant_snippets: nil`) sem erro nenhum na
       rodada — a chamada é ADITIVA, nunca requisito;
    3. a QUERY nunca usa texto livre (hipótese/rationale) — só nomes de
       competência do catálogo fechado, pra nunca abrir brecha pra inferir
       saúde/personalidade/idade/gênero (proibição já estabelecida do
       produto).
  """

  use Engine.DataCase, async: false

  alias Engine.Anamnese.ContextBuilder
  alias Engine.Sessions.FakeEngineApiClient

  setup do
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :test_pid)
    end)

    %{project_id: Ecto.UUID.generate()}
  end

  defp anamnese_context(overrides \\ %{}) do
    Map.merge(
      %{
        "competencyCatalog" => ["nestjs", "git"],
        "members" => [],
        "queuedHypotheses" => [],
        "currentProfiles" => [],
        "instructions" => [],
        "windowFrom" => nil
      },
      overrides
    )
  end

  test "com rag_search retornando hits, o contexto inclui os trechos relevantes", %{
    project_id: project_id
  } do
    Process.put(:fake_anamnese_context, anamnese_context())

    Process.put(:fake_rag_search, %{
      "hits" => [%{"path" => "docs/adr/0080.md", "excerpt" => "trecho relevante do ADR"}],
      "degraded" => false
    })

    assert {:ok, ctx} = ContextBuilder.fetch(project_id)

    assert [%{"path" => "docs/adr/0080.md", "excerpt" => "trecho relevante do ADR"}] =
             ctx.relevant_snippets

    refute ctx.relevant_snippets_degraded
    assert_received {:rag_search, ^project_id, _query, 5}
  end

  test "rag_search falhando: degrada pro comportamento atual (só a janela), sem erro na rodada",
       %{project_id: project_id} do
    Process.put(:fake_anamnese_context, anamnese_context())
    Process.put(:fake_rag_search, {:error, :api_fora})

    assert {:ok, ctx} = ContextBuilder.fetch(project_id)

    assert ctx.relevant_snippets == nil
    refute ctx.relevant_snippets_degraded
    # A janela temporal continua presente — é ISSO que "comportamento atual"
    # quer dizer: a falha do RAG não derruba o resto do contexto.
    assert ctx.window_from
    assert ctx.window_to
  end

  test "resposta do rag_search em formato inesperado também degrada, sem crashar", %{
    project_id: project_id
  } do
    Process.put(:fake_anamnese_context, anamnese_context())
    Process.put(:fake_rag_search, %{"algo" => "diferente"})

    assert {:ok, ctx} = ContextBuilder.fetch(project_id)

    assert ctx.relevant_snippets == nil
  end

  test "degraded: true chega ao contexto de forma legível (não escondido)", %{
    project_id: project_id
  } do
    Process.put(:fake_anamnese_context, anamnese_context())

    Process.put(:fake_rag_search, %{
      "hits" => [%{"path" => "a.md", "excerpt" => "x"}],
      "degraded" => true
    })

    assert {:ok, ctx} = ContextBuilder.fetch(project_id)

    assert ctx.relevant_snippets_degraded == true
    assert length(ctx.relevant_snippets) == 1
  end

  test "catálogo sem competência descoberta: nenhuma query possível, rag_search NÃO é chamado",
       %{project_id: project_id} do
    Process.put(:fake_anamnese_context, anamnese_context(%{"competencyCatalog" => []}))

    assert {:ok, ctx} = ContextBuilder.fetch(project_id)

    assert ctx.relevant_snippets == nil
    refute_received {:rag_search, _, _, _}
  end

  test "a query usa só competência SEM perfil ainda, nunca texto livre de hipótese/rationale",
       %{project_id: project_id} do
    Process.put(
      :fake_anamnese_context,
      anamnese_context(%{
        "competencyCatalog" => ["nestjs", "git", "elixir"],
        "currentProfiles" => [
          %{
            "userId" => "u1",
            "competency" => "nestjs",
            "level" => "avancado",
            "rationale" => "corrigiu o modelo sobre transações e explicou o motivo com calma"
          }
        ],
        "queuedHypotheses" => [
          %{
            "queueId" => "q1",
            "hypothesisId" => "hyp-1",
            "agenteAlvo" => "dev-api",
            "hipotese" => "o usuário parece cansado nas últimas mensagens",
            "sugestao" => "encurtar respostas",
            "confiancaPercent" => 50
          }
        ]
      })
    )

    Process.put(:fake_rag_search, %{"hits" => [], "degraded" => false})

    assert {:ok, _ctx} = ContextBuilder.fetch(project_id)

    assert_received {:rag_search, ^project_id, query, 5}

    # Só as competências AINDA sem perfil ("nestjs" já tem) entram na query.
    assert query =~ "git"
    assert query =~ "elixir"
    refute query =~ "nestjs"

    # Nunca o texto livre da hipótese/rationale (RN da proibição de inferir
    # saúde/personalidade/idade/gênero) — mesmo quando ele contém uma palavra
    # como "cansado", que NUNCA pode vazar pra dentro da query do RAG.
    refute query =~ "cansado"
    refute query =~ "transações"
    refute query =~ ~r/saude|saúde|personalidade|idade|genero|gênero|sexo/i
  end

  test "todas as competências já têm perfil: usa o catálogo inteiro (revisão ainda é sinal)", %{
    project_id: project_id
  } do
    Process.put(
      :fake_anamnese_context,
      anamnese_context(%{
        "competencyCatalog" => ["nestjs", "git"],
        "currentProfiles" => [
          %{"userId" => "u1", "competency" => "nestjs", "level" => "basico"},
          %{"userId" => "u1", "competency" => "git", "level" => "basico"}
        ]
      })
    )

    Process.put(:fake_rag_search, %{"hits" => [], "degraded" => false})

    assert {:ok, _ctx} = ContextBuilder.fetch(project_id)

    assert_received {:rag_search, ^project_id, query, 5}
    assert query =~ "nestjs"
    assert query =~ "git"
  end
end
