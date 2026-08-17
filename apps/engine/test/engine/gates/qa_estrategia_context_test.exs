defmodule Engine.Gates.QaEstrategiaContextTest do
  # Sem DataCase — só o FakeEngineApiClient (scriptado por dicionário de
  # processo). async: false (Application env global).
  use ExUnit.Case, async: false

  alias Engine.Gates.QaEstrategiaContext
  alias Engine.Sessions.FakeEngineApiClient

  setup do
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :test_pid)
    end)

    :ok
  end

  defp epico(stories) do
    %{"id" => "ep-1", "title" => "Épico", "stories" => stories}
  end

  defp story(id, extra \\ %{}) do
    Map.merge(%{"id" => id, "title" => "Story #{id}"}, extra)
  end

  test "acha a story pelo id, dentro da árvore de épicos" do
    Process.put(:fake_backlog, [
      epico([story("st-1"), story("st-2")]),
      epico([story("st-3")])
    ])

    assert {:ok, %{story: %{"id" => "st-2"}, module_map: nil}} =
             QaEstrategiaContext.fetch("proj-1", "sess-1", "st-2")
  end

  test "story inexistente devolve :story_not_found" do
    Process.put(:fake_backlog, [epico([story("st-1")])])

    assert {:error, :story_not_found} =
             QaEstrategiaContext.fetch("proj-1", "sess-1", "st-999")
  end

  test "module_map vigente vem do infra-context, quando presente" do
    Process.put(:fake_backlog, [epico([story("st-1")])])

    Process.put(:fake_infra_context, %{
      "moduleMap" => %{"modules" => [%{"name" => "api"}]},
      "adrs" => []
    })

    assert {:ok, %{module_map: %{"modules" => [%{"name" => "api"}]}}} =
             QaEstrategiaContext.fetch("proj-1", "sess-1", "st-1")
  end

  test "falha ao listar o backlog propaga o erro" do
    Process.put(:fake_backlog, {:error, :api_fora})

    assert {:error, :api_fora} = QaEstrategiaContext.fetch("proj-1", "sess-1", "st-1")
  end
end
