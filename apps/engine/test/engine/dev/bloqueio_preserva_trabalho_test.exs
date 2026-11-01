defmodule Engine.Dev.BloqueioPreservaTrabalhoTest do
  # RN-743 (AT-429): o bloqueio diz onde ficou o trabalho e a próxima task
  # parte dele.
  use ExUnit.Case, async: false

  alias Engine.Dev.AgentIo
  alias Engine.Sessions.FakeEngineApiClient

  setup do
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :worktree_manager, Engine.Dev.FakeWorktreeManager)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :worktree_manager)
      Application.delete_env(:engine, :test_pid)
    end)

    %{
      state: %{
        project_id: Ecto.UUID.generate(),
        session_id: Ecto.UUID.generate(),
        agent_id: "dev-api",
        module: "api",
        task_id: "t-1",
        worktree: System.tmp_dir!(),
        branch: "feature/task-t1"
      }
    }
  end

  test "com trabalho preservado, o dev.blocked diz a branch e o state guarda a base", %{
    state: state
  } do
    Process.put(:fake_preservar, {:ok, "0123456789abcdef"})
    novo = AgentIo.block_task(state, "orçamento", "teto", "politica")

    assert novo.base_preservada == "feature/task-t1"

    assert_receive {:event_appended, _, _,
                    %{
                      type: "dev.blocked",
                      payload: %{
                        trabalhoPreservado: %{branch: "feature/task-t1"},
                        diagnosis: diagnosis
                      }
                    }}

    assert diagnosis =~ "preservado em feature/task-t1"
  end

  test "se preservar falha, o bloqueio segue e diz que não preservou", %{state: state} do
    Process.put(:fake_preservar, {:error, "git explodiu"})
    novo = AgentIo.block_task(state, "orçamento", "teto", "politica")

    refute Map.has_key?(novo, :base_preservada)

    assert_receive {:event_appended, _, _,
                    %{type: "dev.blocked", payload: %{trabalhoPreservado: nil, diagnosis: d}}}

    assert d =~ "Não foi possível preservar"
  end

  # RN-760 (AT-447): aprovada ou bloqueada pelo gate (sem `block_task/4`), a
  # branch segue para a próxima task, com o que sobrou no worktree commitado.
  describe "levar_branch_para_a_proxima/1 e criar_worktree/2" do
    test "aprovada nos gates: a próxima task nasce da branch dela", %{state: state} do
      novo = AgentIo.levar_branch_para_a_proxima(state)
      assert novo.base_preservada == "feature/task-t1"

      {{:ok, _}, depois} = AgentIo.criar_worktree(novo, "task-t2")
      assert_receive {:worktree_created_from, _, "dev-api", "task-t2", "feature/task-t1"}
      refute Map.has_key?(depois, :base_preservada)
    end

    test "o ponteiro de block_task/4 não é sobrescrito, e sem branch nada muda", %{state: state} do
      com_base = Map.put(state, :base_preservada, "feature/outra")
      assert AgentIo.levar_branch_para_a_proxima(com_base).base_preservada == "feature/outra"

      sem = AgentIo.levar_branch_para_a_proxima(%{state | branch: nil})
      refute Map.has_key?(sem, :base_preservada)

      {{:ok, _}, _} = AgentIo.criar_worktree(sem, "task-t3")
      assert_receive {:worktree_created, _, "dev-api", "task-t3"}
    end
  end
end
