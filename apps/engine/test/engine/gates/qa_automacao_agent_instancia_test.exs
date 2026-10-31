defmodule Engine.Gates.QaAutomacaoAgentInstanciaTest do
  # AT-612 (RN-935): a instância de QA efêmera em volta do laço.
  use Engine.DataCase, async: false

  alias Engine.Dev.DevAgentState
  alias Engine.Gates.QaAutomacaoAgent
  alias Engine.Sessions.FakeEngineApiClient

  setup do
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :test_pid)
      Application.delete_env(:engine, :tool_loop_max_iterations)
    end)

    project_id = Ecto.UUID.generate()
    task_id = Ecto.UUID.generate()

    dev_state = %DevAgentState{
      project_id: project_id,
      agent_id: "dev-api",
      session_id: Ecto.UUID.generate(),
      task_id: task_id,
      worktree_path: pasta_temporaria_propria!(),
      task_budget_micros: 1_000_000,
      max_gate_corrections: 3
    }

    dev_context = %{
      task: %{"id" => task_id, "title" => "Cadastro", "description" => ""},
      story: %{"id" => "st-1", "title" => "Cadastro", "rf" => [], "rnf" => []},
      business_rules_units: [],
      task_state_units: []
    }

    %{p: project_id, t: task_id, dev_state: dev_state, ctx: dev_context}
  end

  defp projeto!(id, modo) do
    Repo.query!(
      "INSERT INTO public.projects (id, name, slug, execution_mode, workspace_dir_name) " <>
        "VALUES ($1, 'p', 'p', '#{modo}', 'ws-#{System.unique_integer([:positive])}')",
      [Ecto.UUID.dump!(id)]
    )
  end

  defp rodar(%{p: p, t: t, dev_state: d, ctx: c}),
    do: QaAutomacaoAgent.run(p, d.session_id, t, d, c)

  test "container: sobe antes do laço, terminal leva o alvo e remove no fim", s do
    projeto!(s.p, "container")
    Process.put(:fake_propose_action, %{"id" => "pa-1", "status" => "executed"})

    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.tool_call_response("terminal", %{"command" => "npm test"})
    ])

    assert {:blocked, _} = rodar(s)
    t = s.t

    assert_received {:propose_action, "qa_environment_start", %{id: "qa-automacao"},
                     %{taskId: ^t}}

    assert_received {:propose_action, "terminal", _, %{alvo: %{qa: true, taskId: ^t}}}
    p = s.p
    assert_received {:qa_remove, ^p, ^t}
  end

  test "falha da subida termina o gate com desfecho nomeado de origem infra", s do
    projeto!(s.p, "mounted")

    Process.put(:fake_propose_action, %{
      "id" => "pa-1",
      "status" => "failed",
      "executionResult" => %{"motivo" => "broker recusou"}
    })

    assert {:blocked, %{origin: "infra", diagnosis: "broker recusou"}} = rodar(s)
    refute_received {:qa_remove, _, _}
  end

  test "remove mesmo quando o laço levanta exceção", s do
    projeto!(s.p, "container")
    Process.put(:fake_propose_action, %{"id" => "pa-1", "status" => "executed"})
    Process.put(:fake_llm_turns, :nao_e_lista)

    # Levante ou devolva `{:blocked, _}`, a instância tem de sair.
    try do
      rodar(s)
    rescue
      _ -> :ok
    end

    t = s.t
    assert_received {:qa_remove, _, ^t}
  end

  test "runner e projeto sem modo de instância seguem como antes", s do
    projeto!(s.p, "runner")
    Process.put(:fake_llm_turns, [])
    assert {:blocked, _} = rodar(s)
    refute_received {:propose_action, "qa_environment_start", _, _}
    refute_received {:qa_remove, _, _}
  end
end
