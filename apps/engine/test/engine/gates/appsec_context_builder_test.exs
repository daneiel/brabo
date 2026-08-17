defmodule Engine.Gates.AppSecContextBuilderTest do
  use ExUnit.Case, async: true

  alias Engine.Gates.AppSecContextBuilder
  alias Engine.Sessions.FakeEngineApiClient

  setup do
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :fake_backlog)
      Application.delete_env(:engine, :fake_infra_context)
    end)

    :ok
  end

  defp backlog_com_story(story_fields) do
    [
      %{
        "id" => "ep-1",
        "title" => "Épico",
        "stories" => [
          Map.merge(
            %{"id" => "st-1", "title" => "Cadastro", "sessionId" => "sess-1"},
            story_fields
          )
        ]
      }
    ]
  end

  test "acha a story no backlog e o module_map vigente da sessão dela" do
    Process.put(:fake_backlog, backlog_com_story(%{"moduleIds" => ["api"]}))

    Process.put(:fake_infra_context, %{
      "moduleMap" => %{"modules" => [%{"name" => "api", "stack" => "nest"}]},
      "adrs" => []
    })

    assert {:ok, %{story: story, module_map: module_map}} =
             AppSecContextBuilder.fetch("proj-1", "st-1")

    assert story["id"] == "st-1"
    assert story["sessionId"] == "sess-1"
    assert module_map["modules"] == [%{"name" => "api", "stack" => "nest"}]
  end

  test "story inexistente no backlog: {:error, :story_nao_encontrada}" do
    Process.put(:fake_backlog, backlog_com_story(%{}))

    assert AppSecContextBuilder.fetch("proj-1", "st-nunca-existiu") ==
             {:error, :story_nao_encontrada}
  end

  test "story sem sessionId: {:error, :story_sem_sessao}" do
    Process.put(:fake_backlog, [
      %{"id" => "ep-1", "stories" => [%{"id" => "st-1", "title" => "Sem sessão"}]}
    ])

    assert AppSecContextBuilder.fetch("proj-1", "st-1") == {:error, :story_sem_sessao}
  end

  test "falha ao listar backlog propaga o erro" do
    Process.put(:fake_backlog, {:error, "api fora"})

    assert AppSecContextBuilder.fetch("proj-1", "st-1") == {:error, "api fora"}
  end
end
