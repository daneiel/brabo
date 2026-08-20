defmodule Engine.Psychologist.ContextBuilderTest do
  # Mesma serialização de Engine.Workers.PsychologistWorkerTest: mutamos
  # Application.put_env(:engine, :engine_api_client/:test_pid, ...), estado
  # global que dois arquivos de teste rodando ao mesmo tempo corromperiam.
  use Engine.DataCase, async: false

  alias Engine.Psychologist.ContextBuilder
  alias Engine.Sessions.FakeEngineApiClient

  setup do
    Engine.GlobalSessionTestLock.acquire()

    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :test_pid)
      Engine.GlobalSessionTestLock.release()
    end)

    %{project_id: Ecto.UUID.generate(), session_id: Ecto.UUID.generate()}
  end

  defp psychologist_context(overrides \\ %{}) do
    Map.merge(
      %{
        "alreadyAnalyzed" => false,
        "sessionStatus" => "closed",
        "terminationReason" => nil,
        "businessRules" => [],
        "priorHypotheses" => []
      },
      overrides
    )
  end

  defp hit(path \\ "docs/algo.md", excerpt \\ "trecho relevante") do
    %{"path" => path, "chunk" => excerpt, "excerpt" => excerpt, "score" => 0.9}
  end

  test "rag_search com hits: os trechos entram no contexto ao lado das contagens", %{
    project_id: project_id,
    session_id: session_id
  } do
    Process.put(:fake_psychologist_context, psychologist_context())
    Process.put(:fake_rag_search, %{"hits" => [hit()], "degraded" => false})

    assert {:ok, context} = ContextBuilder.fetch(project_id, session_id)

    assert context.relevant_excerpts == [hit()]
    assert context.rag_degraded == false

    # A query do RAG é derivada do GATILHO (causa de término classificada),
    # não um texto arbitrário — aqui "closed"/nil classifica :normal.
    assert_received {:rag_search, ^project_id, query, top_k}
    assert query =~ "encerramento normal"
    assert top_k == Engine.Psychologist.Triage.rag_top_k()
  end

  test "rag_search falhando ({:error, _}): degrada pro comportamento atual sem erro", %{
    project_id: project_id,
    session_id: session_id
  } do
    Process.put(:fake_psychologist_context, psychologist_context())
    Process.put(:fake_rag_search, {:error, :api_fora})

    assert {:ok, context} = ContextBuilder.fetch(project_id, session_id)

    # ADITIVO: falha do RAG nunca vira {:error, _} do fetch/2 — a api do
    # get_psychologist_context respondeu, e é só isso que decide o resultado.
    assert context.relevant_excerpts == []
    assert context.rag_degraded == nil
    assert context.event_count == 0
  end

  test "rag_search degraded: true aparece de forma legível no contexto (nunca escondido)", %{
    project_id: project_id,
    session_id: session_id
  } do
    Process.put(:fake_psychologist_context, psychologist_context())
    Process.put(:fake_rag_search, %{"hits" => [hit()], "degraded" => true})

    assert {:ok, context} = ContextBuilder.fetch(project_id, session_id)

    assert context.rag_degraded == true
    assert context.relevant_excerpts == [hit()]
  end

  test "gatilho da query reflete a causa de término anormal", %{
    project_id: project_id,
    session_id: session_id
  } do
    Process.put(
      :fake_psychologist_context,
      psychologist_context(%{
        "sessionStatus" => "closed_abnormally",
        "terminationReason" => "killed"
      })
    )

    Process.put(:fake_rag_search, %{"hits" => [], "degraded" => false})

    assert {:ok, _context} = ContextBuilder.fetch(project_id, session_id)

    assert_received {:rag_search, ^project_id, query, _top_k}
    assert query =~ "processo morto externamente"
  end

  test "top_k é clampado ao teto declarado por Triage.rag_top_k/0, mesmo se a api devolver mais",
       %{
         project_id: project_id,
         session_id: session_id
       } do
    Process.put(:fake_psychologist_context, psychologist_context())

    excedente = for i <- 1..(Engine.Psychologist.Triage.rag_top_k() + 5), do: hit("d#{i}.md")
    Process.put(:fake_rag_search, %{"hits" => excedente, "degraded" => false})

    assert {:ok, context} = ContextBuilder.fetch(project_id, session_id)

    assert length(context.relevant_excerpts) == Engine.Psychologist.Triage.rag_top_k()
  end

  test "contexto indisponível da api continua {:error, _} e nunca chama o RAG", %{
    project_id: project_id,
    session_id: session_id
  } do
    Process.put(:fake_psychologist_context, {:error, :api_fora})

    assert {:error, :api_fora} = ContextBuilder.fetch(project_id, session_id)

    refute_received {:rag_search, _project_id, _query, _top_k}
  end
end
