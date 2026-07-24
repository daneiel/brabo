defmodule Engine.Infra.InfraAgentServerTest do
  # DataCase — o InfraAgentServer monta o system prompt via o harness (lê o
  # banco). async: false (Application env global). Callbacks exercitados
  # DIRETO no processo de teste (fake scriptado por dicionário de processo).
  use Engine.DataCase, async: false

  alias Engine.Infra.InfraAgentServer
  alias Engine.Sessions.FakeEngineApiClient

  setup do
    root =
      Path.join(
        System.tmp_dir!(),
        "brabo-infra-#{System.os_time(:microsecond)}-#{System.unique_integer([:positive])}"
      )

    Application.put_env(:engine, :project_workspaces_root, root)
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :gate_dispatcher, Engine.Gates.FakeGateDispatcher)
    Application.put_env(:engine, :hadolint_detector, Engine.Actions.HadolintDetector.Fake)
    Application.put_env(:engine, :hadolint_fake_available, false)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      File.rm_rf!(root)
      Application.delete_env(:engine, :project_workspaces_root)
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :gate_dispatcher)
      Application.delete_env(:engine, :hadolint_detector)
      Application.delete_env(:engine, :hadolint_fake_available)
      Application.delete_env(:engine, :test_pid)
    end)

    project_id = Ecto.UUID.generate()
    session_id = Ecto.UUID.generate()
    {:ok, state} = InfraAgentServer.init({session_id, project_id})
    %{state: state, session_id: session_id}
  end

  defp tool_turn(name, args) do
    %{
      "message" => %{
        "role" => "assistant",
        "content" => "",
        "toolCalls" => [%{"id" => "tc-#{name}", "name" => name, "arguments" => args}]
      },
      "usage" => %{"estimated" => true},
      "error" => nil
    }
  end

  test "kickoff: valida o Dockerfile e propõe a PR de infra (fluxo feliz, N arquivos)", %{
    state: state
  } do
    Process.put(:fake_infra_context, %{
      "moduleMap" => %{
        "modules" => [
          %{"name" => "api", "stack" => "node", "responsibility" => "backend"}
        ]
      },
      "adrs" => [%{"title" => "Usar Postgres", "content" => "# ADR"}]
    })

    files = [
      %{"path" => "Dockerfile", "content" => "FROM node:20"},
      %{"path" => "docker-compose.yml", "content" => "services: {}"}
    ]

    Process.put(:fake_propose_action, %{
      "id" => "pa-infra-1",
      "status" => "executed",
      "executionResult" => %{"pullRequestUrl" => "local://repo/pull/1"}
    })

    Process.put(:fake_llm_turns, [
      tool_turn("validate_infra_file", %{"content" => "FROM node:20"}),
      tool_turn("propose_infra_pr", %{"title" => "infra setup", "files" => files}),
      FakeEngineApiClient.final_response("Artefatos de infra propostos.")
    ])

    assert {:noreply, _new_state} = InfraAgentServer.handle_cast(:kickoff, state)

    assert_received {:propose_action, "open_infra_pr", %{kind: "agent", id: "infra"},
                     %{title: "infra setup", files: ^files}}

    assert_received {:infra_gate_dispatch, :qa, _project_id, _session_id, "pa-infra-1"}
  end

  test "hadolint indisponível não quebra o turno — o modelo segue e propõe a PR mesmo assim", %{
    state: state
  } do
    Process.put(:fake_infra_context, %{"moduleMap" => nil, "adrs" => []})

    Process.put(:fake_propose_action, %{"id" => "pa-1", "status" => "pending"})

    Process.put(:fake_llm_turns, [
      tool_turn("validate_infra_file", %{"content" => "FROM node:20"}),
      FakeEngineApiClient.final_response("ok")
    ])

    assert {:noreply, new_state} = InfraAgentServer.handle_cast(:kickoff, state)

    tool_msgs = Enum.filter(new_state.messages, &(&1["role"] == "tool"))
    assert Enum.any?(tool_msgs, &String.contains?(&1["content"], "indisponível"))
  end

  test "gate reprovado: correct instrui o modelo a corrigir e propor de novo", %{state: state} do
    Process.put(:fake_propose_action, %{
      "id" => "pa-infra-2",
      "status" => "executed",
      "executionResult" => %{"pullRequestUrl" => "local://repo/pull/1"}
    })

    Process.put(:fake_llm_turns, [
      tool_turn("propose_infra_pr", %{
        "title" => "infra setup",
        "files" => [%{"path" => "Dockerfile", "content" => "FROM node:20-fixed"}]
      }),
      FakeEngineApiClient.final_response("Corrigido.")
    ])

    findings = %{gate: "qa", reason: "lint falhou", diagnosis: "DL3006: pin a versão"}
    assert {:noreply, _new_state} = InfraAgentServer.handle_cast({:correct, findings}, state)

    assert_received {:propose_action, "open_infra_pr", _actor, _payload}
  end

  test "deltas e status são rebroadcastados no canal Phoenix", %{
    state: state,
    session_id: session_id
  } do
    Phoenix.PubSub.subscribe(Engine.PubSub, "session:" <> session_id)
    Process.put(:fake_deltas, ["Gerando", " Dockerfile"])
    Process.put(:fake_llm_turns, [FakeEngineApiClient.final_response("feito")])

    assert {:reply, :ok, _} =
             InfraAgentServer.handle_call({:user_message, "gere os artefatos"}, self(), state)

    assert_received %Phoenix.Socket.Broadcast{
      event: "agent.status",
      payload: %{status: "working"}
    }

    assert_received %Phoenix.Socket.Broadcast{
      event: "agent.delta",
      payload: %{text: "Gerando"}
    }

    assert_received %Phoenix.Socket.Broadcast{event: "agent.done"}
    assert_received %Phoenix.Socket.Broadcast{event: "agent.status", payload: %{status: "idle"}}
  end

  test "rehydration: reconstrói o histórico do event log no init", %{} do
    Process.put(:fake_events, [
      %{"type" => "chat.message", "payload" => %{"text" => "oi"}},
      %{"type" => "agent.response", "payload" => %{"content" => "olá"}}
    ])

    {:ok, state} = InfraAgentServer.init({Ecto.UUID.generate(), Ecto.UUID.generate()})

    roles = Enum.map(state.messages, & &1["role"])
    assert roles == ["system", "user", "assistant"]
  end
end
