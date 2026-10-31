defmodule Engine.Harness.Tools.CompleteStoryTest do
  @moduledoc "RN-720: o PO completa a história existente em vez de recriá-la."

  use ExUnit.Case, async: false

  alias Engine.Harness.Tools.CompleteStory

  setup do
    Application.put_env(:engine, :engine_api_client, Engine.Sessions.FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())
    on_exit(fn -> Application.delete_env(:engine, :test_pid) end)
    %{ctx: %{project_id: "p1", session_id: "s1", agent: "po"}}
  end

  test "manda só os campos informados e diz o desfecho", %{ctx: ctx} do
    Process.put(:fake_complete_story, %{
      "id" => "st-1",
      "status" => "draft",
      "proposedReady" => true
    })

    assert {:ok, texto} =
             CompleteStory.run(%{"story_id" => "st-1", "business_rule_ids" => ["r1"]}, ctx)

    assert texto =~ "história completada: id=st-1"
    assert texto =~ "aguardando a promoção"
    assert_received {:story_completed, "st-1", %{businessRuleIds: ["r1"]} = campos}
    refute Map.has_key?(campos, :rf)
  end

  test "a recusa da api vira erro nomeado", %{ctx: ctx} do
    Process.put(:fake_complete_story_error, {409, %{"message" => "não é draft"}})
    assert {:error, texto} = CompleteStory.run(%{"story_id" => "st-1"}, ctx)
    assert texto =~ "falha ao completar história"
    assert {:error, _} = CompleteStory.run(%{}, ctx)
  end
end
