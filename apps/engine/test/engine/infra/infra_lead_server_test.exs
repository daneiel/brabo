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

  # --- Regressão: `{:ok, %{"error" => erro}}` não crasha o GenServer ---

  test "api narra erro no próprio frame final: NÃO crasha, turno conclui, agent.error é gravado",
       %{state: state} do
    Process.put(:fake_infra_context, %{
      "moduleMap" => nil,
      "adrs" => [],
      "gitProvider" => "github"
    })

    Process.put(:fake_llm_turns, [%{"error" => "budget excedido"}])

    # Antes da correção, `run_turn/2` devolvia `{state, ""}` — um 2-tuple com
    # MAPA na primeira posição — que não casava com NENHUMA cláusula de
    # `conclude/1` (só `{:proposed, _, _, _}` e `{:done, _}`), e o
    # `FunctionClauseError` matava o processo `:temporary` pra sempre.
    assert {:noreply, _new_state} = InfraLeadServer.handle_cast(:kickoff, state)

    assert_received {:event_appended, _pid, _sid,
                     %{type: "agent.error", payload: %{mensagem: mensagem}}}

    assert mensagem =~ "budget excedido"

    refute_received {:propose_action, _, _, _}
  end

  # --- `propose_container_start` (ADR 0131/RN-487) ---

  test "propose_container_start é interceptada, chama propose_action com container_start, e NÃO halts",
       %{state: state} do
    Process.put(:fake_infra_context, %{
      "moduleMap" => nil,
      "adrs" => [],
      "gitProvider" => "github"
    })

    Process.put(:fake_propose_action, %{"id" => "pa-cs-1", "status" => "pending"})

    Process.put(:fake_llm_turns, [
      tool_turn("propose_container_start", %{
        "imagem" => "node:22-bookworm-slim",
        "network" => "none",
        "resources" => %{"cpus" => 1},
        "rationale" => "candidata roteada pelo Arquiteto para o módulo api"
      }),
      # Só é consumida se `dispatch_calls/2` NÃO fez halt — prova que o loop
      # continuou (diferente de `propose_infra_pr`, que consolida e para).
      FakeEngineApiClient.final_response("pronto-cs")
    ])

    assert {:noreply, _new_state} = InfraLeadServer.handle_cast(:kickoff, state)

    assert_received {:propose_action, "container_start", %{kind: "agent", id: "infra"}, payload}
    assert payload.imagem == "node:22-bookworm-slim"
    assert payload.network == "none"
    assert payload.resources == %{"cpus" => 1}
    assert payload.rationale == "candidata roteada pelo Arquiteto para o módulo api"

    # Diferente de propose_infra_pr, nenhuma PR consolidada foi aberta.
    refute_received {:propose_action, "open_infra_pr", _, _}

    # A segunda resposta scriptada só é alcançada se o loop CONTINUOU.
    assert_received {:event_appended, _pid, _sid,
                     %{type: "agent.response", payload: %{content: "pronto-cs"}}}
  end

  # --- `container_start_via_runner` (RN-508, ADR 0145) ---

  defp insert_project!(project_id, execution_mode) do
    Repo.query!(
      "INSERT INTO public.projects (id, name, slug, execution_mode) VALUES ($1, 'proj', $2, $3)",
      [Ecto.UUID.dump!(project_id), "proj-#{System.unique_integer([:positive])}", execution_mode]
    )
  end

  test "projeto runner COM runner conectado: propõe container_start_via_runner, sem halt", %{
    state: state
  } do
    insert_project!(state.project_id, "runner")
    :ok = Engine.Runners.Registry.register(state.project_id, self())
    on_exit(fn -> Engine.Runners.Registry.unregister(state.project_id) end)

    Process.put(:fake_infra_context, %{
      "moduleMap" => nil,
      "adrs" => [],
      "gitProvider" => "github"
    })

    Process.put(:fake_propose_action, %{"id" => "pa-csvr-1", "status" => "pending"})

    Process.put(:fake_llm_turns, [
      tool_turn("container_start_via_runner", %{"rationale" => "subir agora"}),
      FakeEngineApiClient.final_response("pronto-csvr")
    ])

    assert {:noreply, _new_state} = InfraLeadServer.handle_cast(:kickoff, state)

    assert_received {:propose_action, "container_start_via_runner", %{kind: "agent", id: "infra"},
                     payload}

    assert payload.rationale == "subir agora"

    # Mesmo desenho de `propose_container_start`: sem HALT, o loop continua.
    assert_received {:event_appended, _pid, _sid,
                     %{type: "agent.response", payload: %{content: "pronto-csvr"}}}
  end

  test "projeto runner SEM runner conectado: recusa nomeada, NUNCA chama propose_action", %{
    state: state
  } do
    insert_project!(state.project_id, "runner")
    # SEM Engine.Runners.Registry.register/2 — nenhum runner conectado.

    Process.put(:fake_infra_context, %{
      "moduleMap" => nil,
      "adrs" => [],
      "gitProvider" => "github"
    })

    Process.put(:fake_llm_turns, [
      tool_turn("container_start_via_runner", %{"rationale" => "subir agora"}),
      FakeEngineApiClient.final_response("depois-de-recusar")
    ])

    assert {:noreply, _new_state} = InfraLeadServer.handle_cast(:kickoff, state)

    refute_received {:propose_action, "container_start_via_runner", _, _}

    assert_received {:event_appended, _pid, _sid,
                     %{
                       type: "agent.response",
                       payload: %{content: "depois-de-recusar"}
                     }}
  end

  test "projeto NÃO runner (container): recusa nomeada apontando pra propose_container_start", %{
    state: state
  } do
    insert_project!(state.project_id, "container")

    Process.put(:fake_infra_context, %{
      "moduleMap" => nil,
      "adrs" => [],
      "gitProvider" => "github"
    })

    Process.put(:fake_llm_turns, [
      tool_turn("container_start_via_runner", %{}),
      FakeEngineApiClient.final_response("depois-de-recusar")
    ])

    assert {:noreply, _new_state} = InfraLeadServer.handle_cast(:kickoff, state)

    refute_received {:propose_action, "container_start_via_runner", _, _}
  end

  # --- `build_kickoff/1`: bloco ROTEAMENTO DE MÓDULOS ---

  test "kickoff inclui o roteamento de módulos quando o Arquiteto roteou", %{state: state} do
    Process.put(:fake_infra_context, %{
      "moduleMap" => nil,
      "adrs" => [],
      "gitProvider" => "github",
      "moduleRouting" => %{
        "status" => "roteado",
        "roteamento" => [
          %{
            "modulo" => "api",
            "imagemCandidata" => "node:22-bookworm-slim",
            "porque" => "estabilidade e LTS"
          }
        ],
        "version" => 2,
        "eventId" => "evt-routing-1",
        "createdAt" => "2026-01-01T00:00:00Z"
      }
    })

    Process.put(:fake_llm_turns, [FakeEngineApiClient.final_response("ok")])

    assert {:noreply, new_state} = InfraLeadServer.handle_cast(:kickoff, state)

    user_msg = Enum.find(new_state.messages, &(&1["role"] == "user"))
    assert user_msg["content"] =~ "api: node:22-bookworm-slim — estabilidade e LTS"
  end

  test "kickoff degrada quando não há roteamento vigente", %{state: state} do
    Process.put(:fake_infra_context, %{
      "moduleMap" => nil,
      "adrs" => [],
      "gitProvider" => "github",
      "moduleRouting" => %{"status" => "sem_roteamento", "roteamento" => [], "version" => 0}
    })

    Process.put(:fake_llm_turns, [FakeEngineApiClient.final_response("ok")])

    assert {:noreply, new_state} = InfraLeadServer.handle_cast(:kickoff, state)

    user_msg = Enum.find(new_state.messages, &(&1["role"] == "user"))

    assert user_msg["content"] =~
             "(sem roteamento vigente — o Arquiteto não rodou route_modules_to_infra nesta sessão)"
  end

  test "kickoff degrada quando o contexto não traz moduleRouting nenhum", %{state: state} do
    Process.put(:fake_infra_context, %{
      "moduleMap" => nil,
      "adrs" => [],
      "gitProvider" => "github"
    })

    Process.put(:fake_llm_turns, [FakeEngineApiClient.final_response("ok")])

    assert {:noreply, new_state} = InfraLeadServer.handle_cast(:kickoff, state)

    user_msg = Enum.find(new_state.messages, &(&1["role"] == "user"))

    assert user_msg["content"] =~
             "(sem roteamento vigente — o Arquiteto não rodou route_modules_to_infra nesta sessão)"
  end
end
