defmodule Engine.Harness.Tools.CorrigirHistoriaTest do
  @moduledoc "RN-727: o PO corrige o título e arquiva a história duplicada."

  use ExUnit.Case, async: false

  alias Engine.Harness.Tools.{ArchiveStory, UpdateStory}

  setup do
    Application.put_env(:engine, :engine_api_client, Engine.Sessions.FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())
    on_exit(fn -> Application.delete_env(:engine, :test_pid) end)
    %{ctx: %{project_id: "p1", session_id: "s1", agent: "po"}}
  end

  test "update_story manda só os campos informados", %{ctx: ctx} do
    assert {:ok, texto} =
             UpdateStory.run(%{"story_id" => "st-1", "title" => "Cadastrar usuário"}, ctx)

    assert texto =~ "história corrigida: id=st-1"
    assert_received {:story_updated, "st-1", %{title: "Cadastrar usuário"} = campos}
    refute Map.has_key?(campos, :description)
  end

  test "update_story sem campo nenhum não chama a api", %{ctx: ctx} do
    assert {:error, texto} = UpdateStory.run(%{"story_id" => "st-1"}, ctx)
    assert texto =~ "exige `title` ou `description`"
    refute_received {:story_updated, _, _}
  end

  test "archive_story arquiva com o motivo", %{ctx: ctx} do
    assert {:ok, texto} =
             ArchiveStory.run(%{"story_id" => "st-1", "reason" => "duplicada"}, ctx)

    assert texto =~ "história arquivada: id=st-1"
    assert_received {:story_archived, "st-1", %{reason: "duplicada"}}
  end

  test "a recusa nomeada da api chega ao modelo com o motivo", %{ctx: ctx} do
    Process.put(
      :fake_archive_story_error,
      {409,
       %{
         "reason" => "historia_com_tarefa_em_execucao",
         "message" => "tem 1 tarefa(s) em execução"
       }}
    )

    assert {:error, texto} = ArchiveStory.run(%{"story_id" => "st-1"}, ctx)
    assert texto =~ "falha ao arquivar história: historia_com_tarefa_em_execucao"
    assert texto =~ "em execução"
    assert {:error, _} = ArchiveStory.run(%{}, ctx)
  end
end
