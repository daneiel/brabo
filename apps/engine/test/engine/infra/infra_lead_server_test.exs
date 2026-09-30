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
  import Engine.Agents.TurnoAssincronoCase, only: [sync_call: 3, sync_cast: 3]

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
    # Desde a RN-577 `propose_infra_pr` só chega ao HALT com repositório: o
    # projeto do setup TEM um, porque é o que todo teste que propõe PR supõe.
    # O teste da recusa o apaga explicitamente.
    insert_repo!(project_id)
    {:ok, state} = InfraLeadServer.init({session_id, project_id})
    %{state: state, session_id: session_id}
  end

  defp insert_repo!(project_id) do
    Repo.query!(
      """
      INSERT INTO public.project_repositories
        (id, project_id, provider, external_id, url, default_branch, visibility, provisioned_by)
      VALUES ($1, $2, 'local', '/tmp/repo.git', 'file:///tmp/repo.git', 'main', 'private', $3)
      """,
      [
        Ecto.UUID.dump!(Ecto.UUID.generate()),
        Ecto.UUID.dump!(project_id),
        Ecto.UUID.dump!(Ecto.UUID.generate())
      ]
    )
  end

  defp delete_repo!(project_id) do
    Repo.query!("DELETE FROM public.project_repositories WHERE project_id = $1", [
      Ecto.UUID.dump!(project_id)
    ])
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

    assert {:noreply, _new_state} = sync_cast(InfraLeadServer, :kickoff, state)

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

    assert {:noreply, _} = sync_cast(InfraLeadServer, :kickoff, state)

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

    assert {:noreply, _} = sync_cast(InfraLeadServer, :kickoff, state)

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

    assert {:noreply, _} = sync_cast(InfraLeadServer, :kickoff, state)

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

    assert {:noreply, _} = sync_cast(InfraLeadServer, :kickoff, state)

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

    assert {:noreply, new_state} = sync_cast(InfraLeadServer, :kickoff, state)

    tool_msgs = Enum.filter(new_state.messages, &(&1["role"] == "tool"))
    assert Enum.any?(tool_msgs, &String.contains?(&1["content"], "indisponível"))

    # RN-593: o desfecho de `validate_infra_file` vai para o event log pelo
    # módulo comum dos conversacionais (RN-589) — antes só o `tool.call` ia,
    # e o Infra Lead reidratado lia "o log não registra o desfecho".
    assert_received {:event_appended, _pid, _sid,
                     %{type: "tool.result", payload: %{tool: "validate_infra_file"} = r}}

    assert r.resultado =~ "indisponível"
    assert Map.has_key?(r, :ok)
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
    assert {:noreply, _new_state} = sync_cast(InfraLeadServer, {:correct, findings}, state)

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
             sync_call(InfraLeadServer, {:user_message, "gere os artefatos"}, state)

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

  test "rehydration (RN-580): sessão com mais de 200 eventos traz a CAUDA, não o começo" do
    Process.put(
      :fake_events,
      Enum.map(1..250, &%{"type" => "chat.message", "payload" => %{"text" => "m#{&1}"}})
    )

    Process.put(:fake_list_events_calls, [])

    {:ok, state} = InfraLeadServer.init({Ecto.UUID.generate(), Ecto.UUID.generate()})

    textos = state.messages |> Enum.map(& &1["content"]) |> Enum.join("\n")
    assert textos =~ "m250"
    refute textos =~ "\nm1\n"
    assert textos =~ "50"

    assert [primeira | _] = Process.get(:fake_list_events_calls)
    assert primeira[:latest] == true
    assert primeira[:limit] == 200
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
    assert {:noreply, _new_state} = sync_cast(InfraLeadServer, :kickoff, state)

    assert_received {:event_appended, _pid, _sid,
                     %{type: "agent.error", payload: %{mensagem: mensagem}}}

    assert mensagem =~ "budget excedido"

    refute_received {:propose_action, _, _, _}
  end

  # --- `propose_container_start` (ADR 0131/RN-487; recusa por modo: RN-566) ---

  test "propose_container_start é interceptada, chama propose_action com container_start, e NÃO halts",
       %{state: state} do
    # Desde a RN-566 o dispatch LÊ o projeto antes de propor: sem linha no
    # banco a recusa é "projeto não encontrado", e nada seria proposto.
    insert_project!(state.project_id, "container")

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

    assert {:noreply, _new_state} = sync_cast(InfraLeadServer, :kickoff, state)

    assert_received {:propose_action, "container_start", %{kind: "agent", id: "infra"}, payload}
    assert payload.imagem == "node:22-bookworm-slim"
    assert payload.network == "none"
    assert payload.resources == %{"cpus" => 1}
    assert payload.rationale == "candidata roteada pelo Arquiteto para o módulo api"

    # Diferente de propose_infra_pr, nenhuma PR consolidada foi aberta.
    refute_received {:propose_action, "open_infra_pr", _, _}

    # RN-593: a proposta aceita pela api deixa `tool.result` com `ok: true` e
    # o texto que o modelo leu.
    assert_received {:event_appended, _pid, _sid,
                     %{type: "tool.result", payload: %{tool: "propose_container_start"} = r}}

    assert r.ok == true
    assert r.resultado =~ "container_start proposto (status pending)"

    # A segunda resposta scriptada só é alcançada se o loop CONTINUOU.
    assert_received {:event_appended, _pid, _sid,
                     %{type: "agent.response", payload: %{content: "pronto-cs"}}}
  end

  test "propose_container_start em projeto `mounted`: PROPÕE — o broker atende os dois (ADR 0144)",
       %{state: state} do
    insert_project!(state.project_id, "mounted")

    Process.put(:fake_infra_context, %{
      "moduleMap" => nil,
      "adrs" => [],
      "gitProvider" => "github"
    })

    Process.put(:fake_propose_action, %{"id" => "pa-cs-mounted", "status" => "pending"})

    Process.put(:fake_llm_turns, [
      tool_turn("propose_container_start", %{
        "imagem" => "node:22-bookworm-slim",
        "rationale" => "candidata roteada pelo Arquiteto para o módulo api"
      }),
      FakeEngineApiClient.final_response("pronto-cs-mounted")
    ])

    assert {:noreply, _new_state} = sync_cast(InfraLeadServer, :kickoff, state)

    assert_received {:propose_action, "container_start", %{kind: "agent", id: "infra"}, payload}
    assert payload.imagem == "node:22-bookworm-slim"
  end

  test "propose_container_start em projeto `runner`: recusa NOMEADA apontando a tool irmã, NUNCA propõe (RN-566)",
       %{state: state} do
    insert_project!(state.project_id, "runner")

    Process.put(:fake_infra_context, %{
      "moduleMap" => nil,
      "adrs" => [],
      "gitProvider" => "github"
    })

    Process.put(:fake_llm_turns, [
      tool_turn("propose_container_start", %{
        "imagem" => "node:22-bookworm-slim",
        "rationale" => "candidata roteada pelo Arquiteto para o módulo api"
      }),
      FakeEngineApiClient.final_response("depois-de-recusar-cs")
    ])

    assert {:noreply, new_state} = sync_cast(InfraLeadServer, :kickoff, state)

    # A metade que importa: a api NUNCA foi chamada.
    refute_received {:propose_action, "container_start", _, _}

    # A recusa é ENTRADA do laço (RN-163) — texto de resultado de ferramenta,
    # NOMEANDO o caminho certo. O loop continuou e o turno concluiu.
    recusa =
      Enum.find(new_state.messages, &(&1["name"] == "propose_container_start"))

    assert recusa["role"] == "tool"
    assert recusa["content"] =~ "runner"
    assert recusa["content"] =~ "container_start_via_runner"

    assert_received {:event_appended, _pid, _sid,
                     %{type: "agent.response", payload: %{content: "depois-de-recusar-cs"}}}

    # E a recusa NÃO é silêncio no event log: a chamada de ferramenta que o
    # modelo fez continua narrada, mesmo tendo sido recusada localmente.
    assert_received {:event_appended, _pid, _sid,
                     %{type: "tool.call", payload: %{tool: "propose_container_start"}}}

    # E o MOTIVO também (RN-593): recusa local é `ok: false` com o texto.
    assert_received {:event_appended, _pid, _sid,
                     %{type: "tool.result", payload: %{tool: "propose_container_start"} = r}}

    assert r.ok == false
    assert r.erro =~ "container_start_via_runner"
    refute Map.has_key?(r, :resultado)
  end

  test "propose_container_start sem broker na instalação: a recusa 409 da api chega ao modelo como TEXTO, não como tupla crua (AT-105)",
       %{state: state} do
    insert_project!(state.project_id, "container")

    Process.put(:fake_infra_context, %{
      "moduleMap" => nil,
      "adrs" => [],
      "gitProvider" => "github"
    })

    Process.put(
      :fake_propose_action_erro,
      {409,
       %{
         "code" => "sem_broker_na_instalacao",
         "message" => "Esta instalação não tem broker de container (BROKER_URL vazia)."
       }}
    )

    Process.put(:fake_llm_turns, [
      tool_turn("propose_container_start", %{
        "imagem" => "node:22-bookworm-slim",
        "rationale" => "candidata roteada"
      }),
      FakeEngineApiClient.final_response("depois-do-409")
    ])

    assert {:noreply, new_state} = sync_cast(InfraLeadServer, :kickoff, state)

    recusa = Enum.find(new_state.messages, &(&1["name"] == "propose_container_start"))
    assert recusa["content"] =~ "container_start recusado: Esta instalação não tem broker"
    refute recusa["content"] =~ "{409"

    assert_received {:event_appended, _pid, _sid,
                     %{type: "agent.response", payload: %{content: "depois-do-409"}}}
  end

  # --- `propose_infra_pr` sem repositório (RN-577, AT-088) ---

  test "propose_infra_pr SEM repositório: recusa NOMEADA antes do HALT, NUNCA propõe nem roda o Workflows (RN-577)",
       %{state: state} do
    delete_repo!(state.project_id)

    Process.put(:fake_infra_context, %{
      "moduleMap" => nil,
      "adrs" => [],
      "gitProvider" => "github"
    })

    Process.put(:fake_propose_action, %{"id" => "pa-nunca", "status" => "executed"})

    Process.put(:fake_llm_turns, [
      tool_turn("propose_infra_pr", %{"title" => "infra setup", "files" => dockerfile_files()}),
      FakeEngineApiClient.final_response("depois-de-recusar-pr")
    ])

    assert {:noreply, new_state} = sync_cast(InfraLeadServer, :kickoff, state)

    # A api NUNCA foi chamada, e o Workflows (um laço de LLM pago) nunca rodou:
    # nenhuma delegação registrada para uma PR que não pode existir.
    refute_received {:propose_action, "open_infra_pr", _, _}
    refute_received {:delegation_recorded, _}

    # A recusa é ENTRADA do laço (RN-163): resultado de ferramenta dizendo o
    # que falta e quando passa a existir. O laço continuou e o turno concluiu.
    recusa = Enum.find(new_state.messages, &(&1["name"] == "propose_infra_pr"))
    assert recusa["role"] == "tool"
    assert recusa["content"] =~ "sem repositório provisionado"
    assert recusa["content"] =~ "handoff ao Arquiteto é aceito (RN-582)"

    assert_received {:event_appended, _pid, _sid,
                     %{type: "agent.response", payload: %{content: "depois-de-recusar-pr"}}}

    # Rastro durável: a chamada (com os caminhos, nunca o conteúdo) e o motivo.
    assert_received {:event_appended, _pid, _sid,
                     %{
                       type: "tool.call",
                       payload: %{tool: "propose_infra_pr", args: %{paths: ["Dockerfile"]}}
                     }}

    assert_received {:event_appended, _pid, _sid,
                     %{type: "tool.result", payload: %{tool: "propose_infra_pr", ok: false} = r}}

    assert r.erro =~ "sem repositório provisionado"
  end

  test "propose_container_start com projeto inexistente: recusa, NUNCA propõe", %{state: state} do
    # SEM insert_project!/2 — nenhuma linha em public.projects.
    Process.put(:fake_infra_context, %{
      "moduleMap" => nil,
      "adrs" => [],
      "gitProvider" => "github"
    })

    Process.put(:fake_llm_turns, [
      tool_turn("propose_container_start", %{
        "imagem" => "node:22-bookworm-slim",
        "rationale" => "candidata roteada pelo Arquiteto para o módulo api"
      }),
      FakeEngineApiClient.final_response("depois-de-recusar-sem-projeto")
    ])

    assert {:noreply, new_state} = sync_cast(InfraLeadServer, :kickoff, state)

    refute_received {:propose_action, "container_start", _, _}

    recusa = Enum.find(new_state.messages, &(&1["name"] == "propose_container_start"))
    assert recusa["content"] =~ "projeto não encontrado"
  end

  # --- `container_start_via_runner` (RN-508, ADR 0145) ---

  defp insert_project!(project_id, execution_mode) do
    Repo.query!(
      "INSERT INTO public.projects (id, name, slug, execution_mode) VALUES ($1, 'proj', $2, $3)",
      [Ecto.UUID.dump!(project_id), "proj-#{System.unique_integer([:positive])}", execution_mode]
    )
  end

  # RN-610: o que a `/containers` exige de um projeto `runner` antes de
  # oferecer a subida — pasta confirmada por um agente local e imagem decidida
  # (um `artifact.project_image` em QUALQUER sessão do projeto).
  defp confirmar_pasta!(project_id) do
    Repo.query!("UPDATE public.projects SET workspace_verified_at = now() WHERE id = $1", [
      Ecto.UUID.dump!(project_id)
    ])
  end

  defp decidir_imagem!(project_id) do
    # Numa sessão DIFERENTE da do Infra Lead, de propósito: o artefato do
    # Arquiteto vive na sessão dele, e a leitura é por projeto.
    sessao = Ecto.UUID.generate()

    Repo.query!("INSERT INTO public.sessions (id, project_id) VALUES ($1, $2)", [
      Ecto.UUID.dump!(sessao),
      Ecto.UUID.dump!(project_id)
    ])

    Repo.query!(
      "INSERT INTO public.session_events (id, session_id, seq, type, actor_kind, actor_id, payload) " <>
        "VALUES ($1, $2, 1, 'artifact.project_image', 'agent', 'arquiteto', $3)",
      [
        "evt-img-#{System.unique_integer([:positive])}",
        Ecto.UUID.dump!(sessao),
        %{"image" => "node:22-bookworm-slim", "version" => 1}
      ]
    )
  end

  defp registrar_container!(project_id, status) do
    Repo.query!(
      "INSERT INTO public.project_containers " <>
        "(id, project_id, status, image_version, cpus, memory_mb, pids_limit) " <>
        "VALUES ($1, $2, $3, 1, 1.0, 512, 128)",
      [Ecto.UUID.dump!(Ecto.UUID.generate()), Ecto.UUID.dump!(project_id), status]
    )
  end

  # O projeto `runner` que passa por TODAS as cláusulas de estado, menos as
  # que o teste desliga.
  defp runner_pronto!(project_id, opts \\ []) do
    insert_project!(project_id, "runner")
    if Keyword.get(opts, :pasta, true), do: confirmar_pasta!(project_id)
    if Keyword.get(opts, :imagem, true), do: decidir_imagem!(project_id)

    if Keyword.get(opts, :runner, true) do
      :ok = Engine.Runners.Registry.register(project_id, self())
      on_exit(fn -> Engine.Runners.Registry.unregister(project_id) end)
    end
  end

  # Roda um turno com UMA chamada de `container_start_via_runner` e devolve o
  # `tool.result` gravado e a mensagem `role: "tool"` que o modelo leu.
  defp turno_via_runner(state) do
    Process.put(:fake_infra_context, %{
      "moduleMap" => nil,
      "adrs" => [],
      "gitProvider" => "github"
    })

    Process.put(:fake_propose_action, %{"id" => "pa-csvr", "status" => "pending"})

    Process.put(:fake_llm_turns, [
      tool_turn("container_start_via_runner", %{"rationale" => "subir agora"}),
      FakeEngineApiClient.final_response("depois-do-via-runner")
    ])

    assert {:noreply, new_state} = sync_cast(InfraLeadServer, :kickoff, state)

    assert_received {:event_appended, _pid, _sid,
                     %{type: "tool.call", payload: %{tool: "container_start_via_runner"}}}

    assert_received {:event_appended, _pid, _sid,
                     %{type: "tool.result", payload: %{tool: "container_start_via_runner"} = r}}

    # A recusa é ENTRADA do laço (RN-163): o modelo a lê como resultado de
    # ferramenta e o turno segue até a resposta final, sem `agent.error`.
    assert_received {:event_appended, _pid, _sid,
                     %{type: "agent.response", payload: %{content: "depois-do-via-runner"}}}

    refute_received {:event_appended, _pid, _sid, %{type: "agent.error"}}

    mensagem = Enum.find(new_state.messages, &(&1["name"] == "container_start_via_runner"))
    {r, mensagem}
  end

  # --- RN-610: recusas locais por ESTADO, uma cláusula por teste ---

  test "RN-610 via_runner: container já registrado `running` — recusa, NUNCA propõe", %{
    state: state
  } do
    runner_pronto!(state.project_id)
    registrar_container!(state.project_id, "running")

    {r, mensagem} = turno_via_runner(state)

    refute_received {:propose_action, "container_start_via_runner", _, _}
    assert r.ok == false
    assert r.erro =~ "já está REGISTRADO como `running`"
    assert mensagem["role"] == "tool"
    assert mensagem["content"] =~ "página `/containers`"
  end

  test "RN-610 via_runner: container `provisioning` também recusa", %{state: state} do
    runner_pronto!(state.project_id)
    registrar_container!(state.project_id, "provisioning")

    {r, _} = turno_via_runner(state)

    refute_received {:propose_action, "container_start_via_runner", _, _}
    assert r.erro =~ "`provisioning`"
  end

  test "RN-610 via_runner: container `stopped` NÃO recusa — subir é a próxima ação", %{
    state: state
  } do
    runner_pronto!(state.project_id)
    registrar_container!(state.project_id, "stopped")

    {r, _} = turno_via_runner(state)

    assert_received {:propose_action, "container_start_via_runner", _, _}
    assert r.ok == true
  end

  test "RN-610 via_runner: sem imagem decidida — recusa nomeando o Arquiteto", %{state: state} do
    runner_pronto!(state.project_id, imagem: false)

    {r, _} = turno_via_runner(state)

    refute_received {:propose_action, "container_start_via_runner", _, _}
    assert r.ok == false
    assert r.erro =~ "nenhuma imagem de container foi decidida"
    assert r.erro =~ "choose_project_image"
  end

  test "RN-610 via_runner: pasta nunca confirmada — recusa mesmo com runner conectado", %{
    state: state
  } do
    runner_pronto!(state.project_id, pasta: false)

    {r, _} = turno_via_runner(state)

    refute_received {:propose_action, "container_start_via_runner", _, _}
    assert r.ok == false
    assert r.erro =~ "nunca foi confirmada por um agente local"
    assert r.erro =~ "brabo-runner --project #{state.project_id}"
  end

  test "RN-610 propose_container_start: container já `running` — recusa, NUNCA propõe", %{
    state: state
  } do
    insert_project!(state.project_id, "container")
    registrar_container!(state.project_id, "running")

    Process.put(:fake_infra_context, %{
      "moduleMap" => nil,
      "adrs" => [],
      "gitProvider" => "github"
    })

    Process.put(:fake_llm_turns, [
      tool_turn("propose_container_start", %{
        "imagem" => "node:22-bookworm-slim",
        "rationale" => "candidata roteada pelo Arquiteto para o módulo api"
      }),
      FakeEngineApiClient.final_response("depois-de-recusar-de-pe")
    ])

    assert {:noreply, new_state} = sync_cast(InfraLeadServer, :kickoff, state)

    refute_received {:propose_action, "container_start", _, _}

    assert_received {:event_appended, _pid, _sid,
                     %{type: "tool.result", payload: %{tool: "propose_container_start"} = r}}

    assert r.ok == false
    assert r.erro =~ "`propose_container_start` não foi proposta"

    recusa = Enum.find(new_state.messages, &(&1["name"] == "propose_container_start"))
    assert recusa["content"] =~ "já está REGISTRADO como `running`"
  end

  test "RN-610 propose_container_start SEM imagem decidida: PROPÕE — eleger é o que ela faz (RN-491)",
       %{state: state} do
    # Nenhum `artifact.project_image` no projeto, de propósito.
    insert_project!(state.project_id, "container")

    Process.put(:fake_infra_context, %{
      "moduleMap" => nil,
      "adrs" => [],
      "gitProvider" => "github"
    })

    Process.put(:fake_propose_action, %{"id" => "pa-cs-sem-img", "status" => "pending"})

    Process.put(:fake_llm_turns, [
      tool_turn("propose_container_start", %{
        "imagem" => "node:22-bookworm-slim",
        "rationale" => "candidata roteada pelo Arquiteto para o módulo api"
      }),
      FakeEngineApiClient.final_response("pronto-sem-img")
    ])

    assert {:noreply, _new_state} = sync_cast(InfraLeadServer, :kickoff, state)

    assert_received {:propose_action, "container_start", _, _}
  end

  test "projeto runner COM runner conectado: propõe container_start_via_runner, sem halt", %{
    state: state
  } do
    # RN-610: pasta confirmada e imagem decidida — o projeto que a
    # `/containers` também deixaria subir.
    runner_pronto!(state.project_id)

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

    assert {:noreply, _new_state} = sync_cast(InfraLeadServer, :kickoff, state)

    assert_received {:propose_action, "container_start_via_runner", %{kind: "agent", id: "infra"},
                     payload}

    assert payload.rationale == "subir agora"

    # Mesmo desenho de `propose_container_start`: sem HALT, o loop continua.
    assert_received {:event_appended, _pid, _sid,
                     %{type: "agent.response", payload: %{content: "pronto-csvr"}}}

    assert_received {:event_appended, _pid, _sid,
                     %{type: "tool.result", payload: %{tool: "container_start_via_runner"} = r}}

    assert r.ok == true
    assert r.resultado =~ "container_start_via_runner proposto"
  end

  test "projeto runner SEM runner conectado: recusa nomeada, NUNCA chama propose_action", %{
    state: state
  } do
    # Pasta confirmada e imagem decidida (RN-610), mas SEM
    # Engine.Runners.Registry.register/2 — nenhum runner conectado.
    runner_pronto!(state.project_id, runner: false)

    Process.put(:fake_infra_context, %{
      "moduleMap" => nil,
      "adrs" => [],
      "gitProvider" => "github"
    })

    Process.put(:fake_llm_turns, [
      tool_turn("container_start_via_runner", %{"rationale" => "subir agora"}),
      FakeEngineApiClient.final_response("depois-de-recusar")
    ])

    assert {:noreply, _new_state} = sync_cast(InfraLeadServer, :kickoff, state)

    refute_received {:propose_action, "container_start_via_runner", _, _}

    assert_received {:event_appended, _pid, _sid,
                     %{
                       type: "agent.response",
                       payload: %{content: "depois-de-recusar"}
                     }}

    # RN-566: a recusa deixou de ser silêncio no event log — a chamada que o
    # modelo fez é narrada mesmo quando recusada localmente, como no
    # `dispatch_tool/2` genérico.
    assert_received {:event_appended, _pid, _sid,
                     %{type: "tool.call", payload: %{tool: "container_start_via_runner"}}}

    assert_received {:event_appended, _pid, _sid,
                     %{type: "tool.result", payload: %{tool: "container_start_via_runner"} = r}}

    assert r.ok == false
    assert r.erro =~ "nenhum runner está conectado"
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

    assert {:noreply, _new_state} = sync_cast(InfraLeadServer, :kickoff, state)

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

    assert {:noreply, new_state} = sync_cast(InfraLeadServer, :kickoff, state)

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

    assert {:noreply, new_state} = sync_cast(InfraLeadServer, :kickoff, state)

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

    assert {:noreply, new_state} = sync_cast(InfraLeadServer, :kickoff, state)

    user_msg = Enum.find(new_state.messages, &(&1["role"] == "user"))

    assert user_msg["content"] =~
             "(sem roteamento vigente — o Arquiteto não rodou route_modules_to_infra nesta sessão)"
  end

  # RN-617 (ADR 0175, AT-141): o Infra Lead vira o SÉTIMO conversacional. Antes
  # o turno dele inteiro rodava DENTRO do `handle_call`: o clique esperava o
  # turno, "Parar" nunca era atendido e uma segunda mensagem ficava na fila.
  # --- RN-668 (AT-264): a Infra não anuncia subida que não fez ---

  defp lote(calls, content \\ "") do
    %{
      "message" => %{
        "role" => "assistant",
        "content" => content,
        "toolCalls" =>
          for {name, args} <- calls do
            %{
              "id" => "tc-#{name}-#{System.unique_integer([:positive])}",
              "name" => name,
              "arguments" => args
            }
          end
      },
      "usage" => %{"estimated" => true},
      "error" => nil
    }
  end

  defp contexto_sem_modulos do
    Process.put(:fake_infra_context, %{
      "moduleMap" => nil,
      "adrs" => [],
      "gitProvider" => "github"
    })
  end

  # As `agent.response` gravadas até aqui, na ordem.
  defp respostas_gravadas(acc \\ []) do
    receive do
      {:event_appended, _pid, _sid, %{type: "agent.response", payload: %{content: c}}} ->
        respostas_gravadas([c | acc])

      {:event_appended, _pid, _sid, _outro} ->
        respostas_gravadas(acc)
    after
      0 -> Enum.reverse(acc)
    end
  end

  describe "a subida anunciada é a que o código fez (RN-668)" do
    test "subida pedida DEPOIS de propose_infra_pr na mesma resposta é despachada, não descartada",
         %{state: state} do
      insert_project!(state.project_id, "container")
      contexto_sem_modulos()
      Process.put(:fake_propose_action, %{"id" => "pa-lote", "status" => "pending"})

      Process.put(:fake_llm_turns, [
        lote(
          [
            {"propose_infra_pr", %{"title" => "infra", "files" => dockerfile_files()}},
            {"propose_container_start",
             %{"imagem" => "node:22-bookworm-slim", "rationale" => "candidata do Arquiteto"}}
          ],
          "Proponho a PR e subo o container em paralelo."
        )
      ])

      assert {:noreply, _} = sync_cast(InfraLeadServer, :kickoff, state)

      # Antes da RN-668 o `reduce_while` parava na PR e esta chamada sumia
      # sem `tool.call` nenhum.
      assert_received {:propose_action, "container_start", %{kind: "agent", id: "infra"}, payload}

      assert payload.imagem == "node:22-bookworm-slim"

      assert_received {:event_appended, _pid, _sid,
                       %{type: "tool.call", payload: %{tool: "propose_container_start"}}}

      # A subida FOI proposta: o fecho não diz que não foi.
      refute Enum.any?(respostas_gravadas(), &(&1 =~ "NÃO foi proposta"))
    end

    test "PR que encerra o turno sem subida: o SERVIDOR diz que a subida não foi proposta",
         %{state: state} do
      insert_project!(state.project_id, "mounted")
      contexto_sem_modulos()

      Process.put(:fake_llm_turns, [
        lote(
          [{"propose_infra_pr", %{"title" => "infra", "files" => dockerfile_files()}}],
          "Proponho a PR; a subida do container vai em paralelo."
        )
      ])

      assert {:noreply, new_state} = sync_cast(InfraLeadServer, :kickoff, state)

      refute_received {:propose_action, "container_start", _, _}

      respostas = respostas_gravadas()
      # A última palavra do fio é a do servidor, não a promessa do modelo.
      assert List.last(respostas) =~ "subida do container NÃO foi proposta"
      assert List.last(respostas) =~ "encerra o meu turno"

      # O marcador do turno não vaza para o state do servidor.
      refute Map.has_key?(new_state, :subida_do_turno)
    end

    test "PR que encerra o turno com o container já REGISTRADO de pé: nada a dizer sobre subida",
         %{state: state} do
      insert_project!(state.project_id, "container")
      registrar_container!(state.project_id, "running")
      contexto_sem_modulos()

      Process.put(:fake_llm_turns, [
        lote([{"propose_infra_pr", %{"title" => "infra", "files" => dockerfile_files()}}])
      ])

      assert {:noreply, _} = sync_cast(InfraLeadServer, :kickoff, state)

      refute Enum.any?(respostas_gravadas(), &(&1 =~ "NÃO foi proposta"))
    end

    test "subida recusada e nunca refeita: o fecho diz que não foi proposta, apesar da promessa",
         %{state: state} do
      # be70: `container_start_via_runner` recusada por modo (`mounted`) e, em
      # seguida, o modelo PROMETE subir — sem chamar `propose_container_start`.
      insert_project!(state.project_id, "mounted")
      contexto_sem_modulos()

      Process.put(:fake_llm_turns, [
        tool_turn("container_start_via_runner", %{"rationale" => "subir"}),
        FakeEngineApiClient.final_response("Vou subir o container em paralelo.")
      ])

      assert {:noreply, _} = sync_cast(InfraLeadServer, :kickoff, state)

      refute_received {:propose_action, _, _, _}

      respostas = respostas_gravadas()
      assert "Vou subir o container em paralelo." in respostas
      assert List.last(respostas) =~ "subida do container NÃO foi proposta"
      assert List.last(respostas) =~ "`container_start_via_runner` foi recusada"
    end

    test "recusa corrigida no mesmo turno (a subida foi proposta depois): sem frase de fecho",
         %{state: state} do
      insert_project!(state.project_id, "mounted")
      contexto_sem_modulos()
      Process.put(:fake_propose_action, %{"id" => "pa-corrigida", "status" => "pending"})

      Process.put(:fake_llm_turns, [
        tool_turn("container_start_via_runner", %{"rationale" => "subir"}),
        tool_turn("propose_container_start", %{
          "imagem" => "node:22-bookworm-slim",
          "rationale" => "a recusa apontou esta"
        }),
        FakeEngineApiClient.final_response("proposta a subida")
      ])

      assert {:noreply, _} = sync_cast(InfraLeadServer, :kickoff, state)

      assert_received {:propose_action, "container_start", _, _}
      refute Enum.any?(respostas_gravadas(), &(&1 =~ "NÃO foi proposta"))
    end

    test "turno que nunca tocou na subida não ganha frase nenhuma", %{state: state} do
      contexto_sem_modulos()
      Process.put(:fake_llm_turns, [FakeEngineApiClient.final_response("só conversa")])

      assert {:noreply, _} = sync_cast(InfraLeadServer, :kickoff, state)

      assert respostas_gravadas() == ["só conversa"]
    end

    test "segunda propose_infra_pr na mesma resposta é recusada com motivo, só a primeira consolida",
         %{state: state} do
      contexto_sem_modulos()

      Process.put(:fake_llm_turns, [
        lote([
          {"propose_infra_pr", %{"title" => "primeira", "files" => dockerfile_files()}},
          {"propose_infra_pr", %{"title" => "segunda", "files" => dockerfile_files()}}
        ])
      ])

      assert {:noreply, new_state} = sync_cast(InfraLeadServer, :kickoff, state)

      assert_received {:event_appended, _pid, _sid,
                       %{type: "tool.result", payload: %{tool: "propose_infra_pr", ok: false} = r}}

      assert r.erro =~ "já foi chamada nesta mesma resposta"

      assert Enum.find(
               new_state.messages,
               &(&1["name"] == "propose_infra_pr" and &1["content"] =~ "já foi chamada")
             )
    end
  end

  describe "o turno pelo TurnoAssincrono (RN-617)" do
    test "aceite imediato: responde :ok com o turno AINDA rodando, e o working já gravado",
         %{state: state} do
      Process.put(:fake_llm_turn_stream_hang, true)
      from = {self(), make_ref()}

      assert {:reply, :ok, %{turno_assincrono: %{task: %Task{}}} = em_curso} =
               InfraLeadServer.handle_call({:user_message, "sobe o container?"}, from, state)

      # A ORDEM é contrato (ADR 0163): o `working` está no log ANTES do aceite.
      assert status_gravados() == ["working"]
      assert_receive :turno_pendurado, 1_000

      _ = InfraLeadServer.handle_cast(:cancel, em_curso)
    end

    test "segunda mensagem com turno em curso: recusa NOMEADA e durável, nada é lido",
         %{state: state} do
      Process.put(:fake_llm_turn_stream_hang, true)

      {:reply, :ok, em_curso} =
        InfraLeadServer.handle_call({:user_message, "primeira"}, {self(), make_ref()}, state)

      assert_receive :turno_pendurado, 1_000

      assert {:reply, {:error, :turno_em_andamento}, mesmo} =
               InfraLeadServer.handle_call(
                 {:user_message, "Continue"},
                 {self(), make_ref()},
                 em_curso
               )

      assert mesmo.turno_assincrono == em_curso.turno_assincrono
      refute Enum.any?(mesmo.messages, &(&1["content"] == "Continue"))

      assert_received {:event_appended, _, _,
                       %{
                         type: "agent.error",
                         actorId: "infra",
                         payload: %{reason: "turno_em_andamento"}
                       }}

      _ = InfraLeadServer.handle_cast(:cancel, mesmo)
    end

    test "Parar: mata a Task no meio, grava o desfecho e devolve o agente ocioso",
         %{state: state, session_id: session_id} do
      Phoenix.PubSub.subscribe(Engine.PubSub, "session:" <> session_id)
      Process.put(:fake_llm_turn_stream_hang, true)

      {:reply, :ok, %{turno_assincrono: %{task: %Task{pid: task_pid}}} = em_curso} =
        InfraLeadServer.handle_call({:user_message, "gere"}, {self(), make_ref()}, state)

      assert_receive :turno_pendurado, 1_000

      assert {:noreply, parado} = InfraLeadServer.handle_cast(:cancel, em_curso)

      assert parado.turno_assincrono == nil
      refute Process.alive?(task_pid)

      assert_received {:event_appended, _, _,
                       %{
                         type: "agent.error",
                         actorId: "infra",
                         payload: %{reason: "cancelado_pelo_usuario"}
                       }}

      assert_received %Phoenix.Socket.Broadcast{event: "agent.done"}
      assert "idle" in status_gravados()
    end

    test "sem turno em curso, Parar é no-op", %{state: state} do
      assert {:noreply, ^state} = InfraLeadServer.handle_cast(:cancel, state)
    end

    test "correção de gate com turno em curso NÃO é descartada: roda no fecho", %{state: state} do
      Process.put(:fake_infra_context, %{"moduleMap" => nil, "adrs" => []})

      Process.put(:fake_llm_turns, [
        FakeEngineApiClient.final_response("olá"),
        FakeEngineApiClient.final_response("corrigido")
      ])

      {:reply, :ok, %{turno_assincrono: %{task: %Task{ref: ref}}} = em_curso} =
        InfraLeadServer.handle_call({:user_message, "oi"}, {self(), make_ref()}, state)

      findings = %{gate: "qa", reason: "lint falhou", diagnosis: "DL3006"}
      {:noreply, com_fila} = InfraLeadServer.handle_cast({:correct, findings}, em_curso)
      assert com_fila.correcoes_pendentes == [findings]

      assert_receive {^ref, resultado}, 5_000
      {:noreply, depois} = InfraLeadServer.handle_info({ref, resultado}, com_fila)

      # A correção subiu como turno NOVO no fecho do primeiro.
      assert depois.correcoes_pendentes == []
      assert %{turno_assincrono: %{task: %Task{ref: ref2}}} = depois
      assert_receive {^ref2, resultado2}, 5_000
      {:noreply, fim} = InfraLeadServer.handle_info({ref2, resultado2}, depois)

      assert fim.turno_assincrono == nil
      assert Enum.any?(fim.messages, &(&1["content"] =~ "O gate qa pediu mudanças"))
    end

    test "teto de iterações esgotado é narrado (toolloop.limit_reached)", %{state: state} do
      Process.put(
        :fake_llm_turns,
        List.duplicate(
          tool_turn("validate_infra_file", %{"path" => "Dockerfile", "content" => "FROM node:20"}),
          14
        )
      )

      assert {:reply, :ok, _} = sync_call(InfraLeadServer, {:user_message, "valide"}, state)

      assert_received {:event_appended, _, _,
                       %{type: "toolloop.limit_reached", payload: %{max_iterations: 14}}}
    end
  end

  defp status_gravados(acc \\ []) do
    receive do
      {:event_appended, _, _, %{type: "agent.status", payload: %{status: s}}} ->
        status_gravados([s | acc])

      {:event_appended, _, _, _} ->
        status_gravados(acc)
    after
      0 -> Enum.reverse(acc)
    end
  end
end
