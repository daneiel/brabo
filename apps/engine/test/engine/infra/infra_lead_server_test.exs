defmodule Engine.Infra.InfraLeadServerTest do
  # DataCase — o InfraLeadServer monta o system prompt via o harness (lê o
  # banco). async: false (Application env global). Callbacks exercitados
  # DIRETO no processo de teste (fake scriptado por dicionário de processo) —
  # `Workflows.run/3` roda SÍNCRONO no mesmo processo (sem Task.async, mesma
  # lição do `QaLeadServer`/Fase 8b: o dicionário de processo não atravessa
  # fronteira de processo, e o fake depende dele).
  use Engine.DataCase, async: false

  alias Engine.Infra.InfraLeadServer
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
    Application.put_env(:engine, :actionlint_detector, Engine.Actions.ActionlintDetector.Fake)
    Application.put_env(:engine, :actionlint_fake_available, false)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      File.rm_rf!(root)
      Application.delete_env(:engine, :project_workspaces_root)
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :gate_dispatcher)
      Application.delete_env(:engine, :hadolint_detector)
      Application.delete_env(:engine, :hadolint_fake_available)
      Application.delete_env(:engine, :actionlint_detector)
      Application.delete_env(:engine, :actionlint_fake_available)
      Application.delete_env(:engine, :test_pid)
    end)

    project_id = Ecto.UUID.generate()
    session_id = Ecto.UUID.generate()
    {:ok, state} = InfraLeadServer.init({session_id, project_id})
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

  defp dockerfile_files, do: [%{"path" => "Dockerfile", "content" => "FROM node:20"}]

  defp ci_files(path \\ ".github/workflows/ci.yml"),
    do: [%{"path" => path, "content" => "on: pull_request"}]

  test "kickoff feliz: Lead + Workflows consolidam numa PR SÓ, duas delegações registradas", %{
    state: state
  } do
    Process.put(:fake_infra_context, %{
      "moduleMap" => %{
        "modules" => [%{"name" => "api", "stack" => "node", "responsibility" => "backend"}]
      },
      "adrs" => [],
      "gitProvider" => "github"
    })

    Process.put(:fake_propose_action, %{
      "id" => "pa-infra-1",
      "status" => "executed",
      "executionResult" => %{"pullRequestUrl" => "local://repo/pull/1"}
    })

    Process.put(:fake_llm_turns, [
      tool_turn("validate_infra_file", %{"path" => "Dockerfile", "content" => "FROM node:20"}),
      tool_turn("propose_infra_pr", %{"title" => "infra setup", "files" => dockerfile_files()}),
      tool_turn("validate_infra_file", %{
        "path" => ".github/workflows/ci.yml",
        "content" => "on: pull_request"
      }),
      tool_turn("emit_infra_delegation_result", %{
        "summary" => "pipeline de CI",
        "files" => ci_files()
      })
    ])

    assert {:noreply, _new_state} = InfraLeadServer.handle_cast(:kickoff, state)

    assert_received {:propose_action, "open_infra_pr", %{kind: "agent", id: "infra"}, payload}
    paths = Enum.map(payload.files, & &1["path"])
    assert "Dockerfile" in paths
    assert ".github/workflows/ci.yml" in paths

    assert_received {:infra_gate_dispatch, :qa, _project_id, _session_id, "pa-infra-1"}

    assert_received {:delegation_recorded, %{subagent: "infra-lead", status: "completed"} = d1}
    assert d1.area == "infra"
    assert d1.lead_agent == "infra-lead"
    refute Map.has_key?(d1, :task_id)

    assert_received {:delegation_recorded, %{subagent: "infra-workflows", status: "completed"}}
  end

  test "gitProvider gitlab: o arquivo consolidado é .gitlab-ci.yml, não workflow do Actions", %{
    state: state
  } do
    Process.put(:fake_infra_context, %{
      "moduleMap" => nil,
      "adrs" => [],
      "gitProvider" => "gitlab"
    })

    Process.put(:fake_propose_action, %{"id" => "pa-infra-2", "status" => "executed"})

    Process.put(:fake_llm_turns, [
      tool_turn("propose_infra_pr", %{"title" => "infra setup", "files" => dockerfile_files()}),
      tool_turn("validate_infra_file", %{
        "path" => ".gitlab-ci.yml",
        "content" => "stages: [build]"
      }),
      tool_turn("emit_infra_delegation_result", %{
        "summary" => "pipeline de CI (GitLab)",
        "files" => ci_files(".gitlab-ci.yml")
      })
    ])

    assert {:noreply, _} = InfraLeadServer.handle_cast(:kickoff, state)

    assert_received {:propose_action, "open_infra_pr", _actor, payload}
    paths = Enum.map(payload.files, & &1["path"])
    assert ".gitlab-ci.yml" in paths
    refute ".github/workflows/ci.yml" in paths
  end

  test "Workflows não conclui: NENHUMA PR abre, delegação failed registrada, sem crash", %{
    state: state
  } do
    Process.put(:fake_infra_context, %{
      "moduleMap" => nil,
      "adrs" => [],
      "gitProvider" => "github"
    })

    Process.put(:fake_llm_turns, [
      tool_turn("propose_infra_pr", %{"title" => "infra setup", "files" => dockerfile_files()})
      # fila esgota aqui — o Workflows não recebe tool call nenhuma, o
      # ToolLoop encerra com {:ok, ctx} (sem emit_infra_delegation_result).
    ])

    assert {:noreply, _} = InfraLeadServer.handle_cast(:kickoff, state)

    refute_received {:propose_action, "open_infra_pr", _, _}

    assert_received {:delegation_recorded, %{subagent: "infra-lead", status: "completed"}}

    assert_received {:delegation_recorded,
                     %{subagent: "infra-workflows", status: "failed", failure_origin: "modelo"}}

    assert_received {:event_appended, _pid, _sid,
                     %{type: "dev.error", payload: %{agentId: "infra-lead"}}}
  end

  test "tool call escrita em TEXTO é recuperada — o Lead não tem ToolLoop no próprio turno", %{
    state: state
  } do
    Process.put(:fake_infra_context, %{
      "moduleMap" => nil,
      "adrs" => [],
      "gitProvider" => "github"
    })

    Process.put(:fake_propose_action, %{
      "id" => "pa-infra-txt",
      "status" => "executed",
      "executionResult" => %{"pullRequestUrl" => "local://repo/pull/9"}
    })

    texto = """
    ```json
    {"name": "propose_infra_pr", "arguments": {"title": "infra setup", "files": [{"path": "Dockerfile", "content": "FROM node:24-alpine"}]}}
    ```
    """

    Process.put(:fake_llm_turns, [
      %{
        "message" => %{"role" => "assistant", "content" => texto},
        "usage" => %{"estimated" => true},
        "error" => nil
      },
      tool_turn("validate_infra_file", %{
        "path" => ".github/workflows/ci.yml",
        "content" => "on: pull_request"
      }),
      tool_turn("emit_infra_delegation_result", %{
        "summary" => "pipeline de CI",
        "files" => ci_files()
      })
    ])

    assert {:noreply, _} = InfraLeadServer.handle_cast(:kickoff, state)

    assert_received {:propose_action, "open_infra_pr", %{kind: "agent", id: "infra"}, _payload}
  end

  test "texto que NÃO é tool call não vira PR nenhuma", %{state: state} do
    Process.put(:fake_infra_context, %{
      "moduleMap" => nil,
      "adrs" => [],
      "gitProvider" => "github"
    })

    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.final_response("Ainda estou analisando os módulos.")
    ])

    assert {:noreply, _} = InfraLeadServer.handle_cast(:kickoff, state)

    refute_received {:propose_action, "open_infra_pr", _, _}
  end

  test "hadolint indisponível não quebra o turno — o Lead segue e propõe mesmo assim", %{
    state: state
  } do
    Process.put(:fake_infra_context, %{
      "moduleMap" => nil,
      "adrs" => [],
      "gitProvider" => "github"
    })

    Process.put(:fake_propose_action, %{"id" => "pa-1", "status" => "pending"})

    Process.put(:fake_llm_turns, [
      tool_turn("validate_infra_file", %{"path" => "Dockerfile", "content" => "FROM node:20"}),
      tool_turn("propose_infra_pr", %{"title" => "infra setup", "files" => dockerfile_files()}),
      tool_turn("emit_infra_delegation_result", %{
        "summary" => "pipeline de CI",
        "files" => ci_files()
      })
    ])

    assert {:noreply, new_state} = InfraLeadServer.handle_cast(:kickoff, state)

    tool_msgs = Enum.filter(new_state.messages, &(&1["role"] == "tool"))
    assert Enum.any?(tool_msgs, &String.contains?(&1["content"], "indisponível"))
  end

  test "gate reprovado: :correct reroda os DOIS delegados e propõe de novo", %{state: state} do
    Process.put(:fake_infra_context, %{
      "moduleMap" => nil,
      "adrs" => [],
      "gitProvider" => "github"
    })

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
      tool_turn("validate_infra_file", %{
        "path" => ".github/workflows/ci.yml",
        "content" => "on: pull_request"
      }),
      tool_turn("emit_infra_delegation_result", %{
        "summary" => "pipeline de CI",
        "files" => ci_files()
      })
    ])

    findings = %{gate: "qa", reason: "lint falhou", diagnosis: "DL3006: pin a versão"}
    assert {:noreply, _new_state} = InfraLeadServer.handle_cast({:correct, findings}, state)

    assert_received {:propose_action, "open_infra_pr", _actor, _payload}
    assert_received {:delegation_recorded, %{subagent: "infra-lead"}}
    assert_received {:delegation_recorded, %{subagent: "infra-workflows"}}
  end

  test "deltas e status são rebroadcastados no canal Phoenix", %{
    state: state,
    session_id: session_id
  } do
    Phoenix.PubSub.subscribe(Engine.PubSub, "session:" <> session_id)
    Process.put(:fake_deltas, ["Gerando", " Dockerfile"])
    Process.put(:fake_llm_turns, [FakeEngineApiClient.final_response("feito")])

    assert {:reply, :ok, _} =
             InfraLeadServer.handle_call({:user_message, "gere os artefatos"}, self(), state)

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

    {:ok, state} = InfraLeadServer.init({Ecto.UUID.generate(), Ecto.UUID.generate()})

    roles = Enum.map(state.messages, & &1["role"])
    assert roles == ["system", "user", "assistant"]
  end
end
