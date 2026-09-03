defmodule Engine.Sessions.FakeEngineApiClient do
  @moduledoc """
  Fake de teste pra Engine.Sessions.EngineApiClient — sem Mox, sem Agent.
  `report_termination`/`append_event` notificam o `:test_pid` via `send/2`.

  `llm_turn`/`propose_action` são scriptados pelo DICIONÁRIO DE PROCESSO do
  chamador (os testes rodam o ToolLoop/ContextManager de forma SÍNCRONA no
  próprio processo de teste), então:

    * `Process.put(:fake_llm_always, resp)` — toda chamada retorna `resp`
      (usado no teste de limite de iterações, pra sempre pedir tool call);
    * `Process.put(:fake_llm_turns, [resp1, resp2, ...])` — fila consumida em
      ordem; esgotada, retorna uma resposta final "pronto" (encerra o loop);
    * `Process.put(:fake_propose_action, action_map)` — resposta do pipeline.

  Também `send`a `{:llm_turn, ...}` / `{:propose_action, ...}` pro `:test_pid`
  pra os testes asseverarem as chamadas.
  """

  @behaviour Engine.Sessions.EngineApiClient

  @impl true
  def report_termination(project_id, session_id, reason, to) do
    notify({:termination_reported, project_id, session_id, reason, to})
    :ok
  end

  @impl true
  def append_event(project_id, session_id, event) do
    notify({:event_appended, project_id, session_id, event})

    # Erro scriptável via :fake_append_event_error — mesmo idioma de
    # :fake_story_error e companhia. Existia caminho nenhum pra simular "a api
    # recusou o append" antes de RN-162 precisar exercitar o `{:error, _}` de
    # `EngineApiClient.append_event/3` dentro de um tool (AskStructuredQuestions).
    case Process.get(:fake_append_event_error) do
      nil -> :ok
      reason -> {:error, reason}
    end
  end

  @impl true
  def append_event_returning(project_id, session_id, event) do
    notify({:event_appended, project_id, session_id, event})

    # Mesmo scriptável de `append_event/3` (`:fake_append_event_error`) — as
    # duas expressam a MESMA falha ("a api recusou o append"), só com forma
    # de retorno diferente. Introduzido pelo UX Designer (ADR 0087), que
    # precisa do id de volta (`propose_prototype`) e também precisa exercitar
    # "gravar o artefato falhou, então nenhum handoff é ofertado".
    case Process.get(:fake_append_event_error) do
      nil ->
        id = "evt-#{System.unique_integer([:positive])}"
        {:ok, %{"id" => id, "seq" => 0, "type" => Map.get(event, :type)}}

      reason ->
        {:error, reason}
    end
  end

  @impl true
  def list_events(_project_id, _session_id) do
    {:ok, Process.get(:fake_events, [])}
  end

  @impl true
  def create_handoff(project_id, session_id, from_agent, to_agent, artifact_id) do
    notify({:handoff_created, project_id, session_id, from_agent, to_agent, artifact_id})

    # Erro scriptável (RN-116: a api recusou o handoff) via :fake_handoff_error
    # — mesmo padrão de :fake_story_error, abaixo.
    case Process.get(:fake_handoff_error) do
      nil ->
        {:ok,
         Process.get(:fake_handoff, %{
           "id" => "ho-1",
           "fromAgent" => from_agent,
           "toAgent" => to_agent,
           "artifactId" => artifact_id,
           "status" => "offered"
         })}

      reason ->
        {:error, reason}
    end
  end

  @impl true
  def create_epic(_project_id, _session_id, fields) do
    notify({:epic_created, fields})
    reply(:fake_epic, %{"id" => "ep-#{unique()}", "title" => Map.get(fields, :title)})
  end

  @impl true
  def create_story(_project_id, _session_id, fields) do
    notify({:story_created, fields})
    # Erro scriptável (ex.: business_rule_id inválido) via :fake_story_error.
    case Process.get(:fake_story_error) do
      nil ->
        reply(:fake_story, %{"id" => "st-#{unique()}", "status" => "ready"})

      reason ->
        {:error, reason}
    end
  end

  @impl true
  def create_task(_project_id, _session_id, fields) do
    notify({:task_created, fields})
    reply(:fake_task, %{"id" => "tk-#{unique()}"})
  end

  @impl true
  def list_business_rules(project_id) do
    notify({:business_rules_listed, project_id})

    reply(:fake_business_rules, %{"rules" => [], "uncoveredCount" => 0})
  end

  @impl true
  def list_backlog(project_id) do
    notify({:backlog_listed, project_id})

    reply(:fake_backlog, [])
  end

  @impl true
  def list_product_metrics(project_id) do
    notify({:product_metrics_listed, project_id})

    reply(:fake_product_metrics, %{
      "project" => %{"id" => project_id, "name" => "projeto"},
      "totalActionsConsidered" => 0,
      "funnel" => %{
        "etapas" => [],
        "sessoesComCommit" => [],
        "sessoesComPr" => [],
        "sessoesComMerge" => []
      },
      "leadTimes" => %{"perSession" => [], "averageMs" => nil},
      "deploymentFrequency" => []
    })
  end

  @impl true
  def create_module_map(_project_id, _session_id, modules) do
    notify({:module_map_created, modules})

    case Process.get(:fake_module_map_error) do
      nil ->
        # `modules` vem na resposta porque a api devolve o mapa GRAVADO, e é de
        # lá que o tool-result tira os nomes canônicos (RN-066). Sem esta chave
        # o fake exercitaria só o caminho de fallback, e o eco dos nomes ficaria
        # sem prova. `:fake_module_map_sem_modulos` existe para exercitar de
        # propósito esse fallback.
        base = %{"id" => "mm-#{unique()}", "version" => 1}

        corpo =
          if Process.get(:fake_module_map_sem_modulos) do
            base
          else
            Map.put(
              base,
              "modules",
              Enum.map(modules, fn m ->
                %{"name" => Map.get(m, :name) || Map.get(m, "name")}
              end)
            )
          end

        reply(:fake_module_map, corpo)

      reason ->
        {:error, reason}
    end
  end

  @impl true
  def create_c4_diagram(_project_id, _session_id, entrada) do
    notify({:c4_diagram_created, entrada})

    case Process.get(:fake_c4_diagram_error) do
      nil ->
        reply(:fake_c4_diagram, %{
          "version" => 1,
          "diagrama" => %{
            "systemName" => Map.get(entrada, :systemName),
            "contextDiagram" => "C4Context\n  title fake",
            "containerDiagram" => "C4Container\n  title fake"
          }
        })

      reason ->
        {:error, reason}
    end
  end

  @impl true
  def assign_story_modules(_project_id, _session_id, fields) do
    notify({:story_modules_assigned, fields})

    case Process.get(:fake_assign_error) do
      nil -> reply(:fake_story, %{"id" => Map.get(fields, :storyId)})
      reason -> {:error, reason}
    end
  end

  @impl true
  def decide_project_image(_project_id, _session_id, decisao) do
    notify({:project_image_decided, decisao})

    case Process.get(:fake_project_image_error) do
      nil ->
        reply(:fake_project_image, %{
          "version" => 1,
          "decisao" => %{
            "image" => Map.get(decisao, :image),
            "network" => Map.get(decisao, :network, "none")
          }
        })

      reason ->
        {:error, reason}
    end
  end

  @impl true
  def route_modules_to_infra(_project_id, _session_id, roteamento) do
    notify({:module_routing_created, roteamento})

    case Process.get(:fake_module_routing_error) do
      nil ->
        reply(:fake_module_routing, %{
          "version" => 1,
          "roteamento" =>
            Enum.map(roteamento, fn r ->
              %{
                "modulo" => Map.get(r, :modulo) || Map.get(r, "modulo"),
                "imagemCandidata" =>
                  Map.get(r, :imagemCandidata) || Map.get(r, "imagemCandidata"),
                "porque" => Map.get(r, :porque) || Map.get(r, "porque")
              }
            end)
        })

      reason ->
        {:error, reason}
    end
  end

  @impl true
  def claim_task(_project_id, _session_id, module, agent_id) do
    # Atraso opcional via Application env (NÃO dicionário de processo): o
    # agente reidratado roda no processo DELE, então `Process.put` do teste
    # não o alcança. Usado só pelo teste de que o boot não espera a
    # recuperação de um `working` (D2).
    case Application.get_env(:engine, :fake_claim_delay_ms) do
      ms when is_integer(ms) -> Process.sleep(ms)
      _ -> :ok
    end

    notify({:task_claimed, module, agent_id})

    # `:fake_claim_error` força o ramo de erro do claim (5xx/timeout da api).
    # Não existia até a revisão da Fase 12b, e a ausência dele foi o motivo
    # de o travamento permanente do agente (D1) passar por toda a suite: o
    # caminho feliz do claim era o ÚNICO exercitado.
    case Process.get(:fake_claim_error) do
      nil ->
        # Fila de tasks scriptada por :fake_tasks (pop); esgotada → nil.
        case Process.get(:fake_tasks, []) do
          [task | rest] ->
            Process.put(:fake_tasks, rest)
            {:ok, task}

          [] ->
            {:ok, nil}
        end

      reason ->
        {:error, reason}
    end
  end

  @impl true
  def mark_task(_project_id, _session_id, task_id, status, agent_id) do
    notify({:task_marked, task_id, status, agent_id})
    {:ok, %{"id" => task_id, "status" => status}}
  end

  @impl true
  def mark_task_blocked(_project_id, _session_id, task_id, reason, diagnosis, agent_id, origin) do
    # Mesma mensagem de sempre — os testes da Fase 4a (dev_agent_server_test.exs,
    # noop_dev_agent_server_test.exs) casam este tuple de 5 e não foram
    # retrofitados nesta entrega (ADR 0038, corte de escopo). `origin` chega
    # numa notificação PRÓPRIA, só pra quem quiser afirmar sobre ele (Fase 8b).
    notify({:task_blocked, task_id, reason, diagnosis, agent_id})
    notify({:task_blocked_origin, task_id, origin})
    {:ok, %{"id" => task_id, "blocked" => true}}
  end

  @impl true
  def open_gate(_project_id, _session_id, task_id, agent_id) do
    notify({:gate_opened, task_id, agent_id})
    {:ok, %{"id" => task_id, "gateStatus" => "awaiting_qa"}}
  end

  @impl true
  def record_gate_verdict(
        _project_id,
        _session_id,
        task_id,
        gate,
        veredito,
        resumo,
        itens,
        max_corrections
      ) do
    notify({:gate_verdict_recorded, task_id, gate, veredito, resumo, itens, max_corrections})
    reply(:fake_gate_verdict_response, %{"nextAction" => "done", "task" => %{"id" => task_id}})
  end

  @impl true
  def record_delegation(payload) do
    notify({:delegation_recorded, payload})

    reply(:fake_record_delegation_response, %{"id" => "del-#{System.unique_integer([:positive])}"})
  end

  @impl true
  def get_dev_context(_project_id, _session_id, task_id, module \\ nil) do
    notify({:dev_context_fetched, task_id, module})

    reply(
      :fake_dev_context,
      %{
        "task" => %{"id" => task_id, "title" => "task", "description" => ""},
        "story" => %{
          "id" => "st-1",
          "title" => "story",
          "description" => "",
          "rf" => [],
          "rnf" => [],
          "dod" => [],
          "dor" => []
        },
        "businessRules" => [],
        "adrs" => []
      }
    )
  end

  @impl true
  def get_infra_context(_project_id, _session_id) do
    notify({:infra_context_fetched})
    reply(:fake_infra_context, %{"moduleMap" => nil, "adrs" => []})
  end

  @impl true
  def get_infra_pr_files(_project_id, _session_id, pr_action_id) do
    notify({:infra_pr_files_fetched, pr_action_id})
    reply(:fake_infra_pr_files, %{"title" => "infra", "files" => []})
  end

  @impl true
  def get_psychologist_context(_project_id, session_id) do
    notify({:psychologist_context_fetched, session_id})

    reply(:fake_psychologist_context, %{
      "alreadyAnalyzed" => false,
      "sessionStatus" => "closed",
      "terminationReason" => nil,
      "businessRules" => [],
      "priorHypotheses" => []
    })
  end

  @impl true
  def propose_hypotheses(
        _project_id,
        _session_id,
        tier,
        triggered_by,
        event_count,
        cause,
        hypotheses
      ) do
    notify({:hypotheses_proposed, tier, triggered_by, event_count, cause, hypotheses})

    # Erro scriptável (ex.: evidência inválida rejeitada pela api) via
    # :fake_propose_hypotheses_error — mesmo idioma de :fake_story_error.
    # `_once` rejeita só a PRIMEIRA chamada, pro teste do ciclo de correção
    # (rejeita, modelo corrige, segunda passa).
    case {Process.get(:fake_propose_hypotheses_error),
          Process.get(:fake_propose_hypotheses_error_once)} do
      {nil, nil} ->
        reply(:fake_propose_hypotheses, %{
          "analysisId" => "analysis-1",
          "hypotheses" => hypotheses
        })

      {nil, reason} ->
        Process.delete(:fake_propose_hypotheses_error_once)
        {:error, reason}

      {reason, _} ->
        {:error, reason}
    end
  end

  @impl true
  def record_infra_gate_verdict(
        _project_id,
        _session_id,
        pr_action_id,
        gate,
        veredito,
        resumo,
        itens,
        max_corrections
      ) do
    notify(
      {:infra_gate_verdict_recorded, pr_action_id, gate, veredito, resumo, itens, max_corrections}
    )

    reply(:fake_infra_gate_verdict_response, %{
      "nextAction" => "done",
      "artifact" => %{"id" => pr_action_id}
    })
  end

  @impl true
  def get_anamnese_context(project_id) do
    notify({:anamnese_context_fetched, project_id})

    reply(:fake_anamnese_context, %{
      "competencyCatalog" => ["git", "agile"],
      "members" => [],
      "queuedHypotheses" => [],
      "currentProfiles" => [],
      "instructions" => [],
      "windowFrom" => nil
    })
  end

  @impl true
  def record_proficiency(_project_id, _session_id, payload) do
    notify({:proficiency_recorded, payload})

    case Process.get(:fake_record_proficiency_error) do
      nil -> reply(:fake_proficiency_result, %{"runId" => "run-1", "profiles" => []})
      reason -> {:error, reason}
    end
  end

  @impl true
  def sync_model_catalog do
    notify(:model_catalog_synced)

    case Process.get(:fake_model_sync_error) do
      nil -> reply(:fake_model_sync, %{"porProvider" => []})
      reason -> {:error, reason}
    end
  end

  @impl true
  def propose_instruction_patch(_project_id, _session_id, payload) do
    notify({:instruction_patch_proposed, payload})

    case Process.get(:fake_instruction_patch_error) do
      nil -> reply(:fake_instruction_patch, %{"id" => "act-1", "status" => "pending"})
      reason -> {:error, reason}
    end
  end

  @impl true
  def propose_max_parallel(_project_id, _session_id, payload) do
    notify({:max_parallel_proposed, payload})

    case Process.get(:fake_max_parallel_error) do
      nil -> reply(:fake_max_parallel, %{"id" => "act-2", "status" => "pending"})
      reason -> {:error, reason}
    end
  end

  @impl true
  def rag_search(project_id, query, top_k, _opts \\ []) do
    notify({:rag_search, project_id, query, top_k})

    # Mesmo idioma de `list_backlog`/`reply`: `Process.put(:fake_rag_search,
    # {:error, motivo})` simula a api do RAG fora do ar, sem chave separada.
    reply(:fake_rag_search, %{"hits" => [], "degraded" => false})
  end

  @impl true
  def rag_feedback(project_id, search_id, chunk_id, verdict, agent) do
    notify({:rag_feedback, project_id, search_id, chunk_id, verdict, agent})

    # Mesma chave única de `rag_search`: `Process.put(:fake_rag_feedback,
    # {:error, {400, ...}})` simula a recusa da api por id desconhecido.
    reply(:fake_rag_feedback, %{
      "searchId" => search_id,
      "chunkId" => chunk_id,
      "verdict" => verdict,
      "rank" => 1
    })
  end

  @impl true
  def get_prompt_template(name, version \\ nil) do
    notify({:prompt_template_fetched, name, version})

    reply(
      :fake_prompt_template,
      %{"name" => name, "version" => version || "v1", "body" => "", "hash" => "fake"}
    )
  end

  # Um valor scriptado já em forma de `{:error, _}` passa direto — assim um
  # teste consegue simular "a api está fora" no MESMO idioma dos scripts de
  # sucesso, sem uma chave separada por endpoint.
  defp reply(key, default) do
    case Process.get(key, default) do
      {:error, _reason} = erro -> erro
      valor -> {:ok, valor}
    end
  end

  defp unique, do: System.unique_integer([:positive])

  @impl true
  def get_git_remote(_project_id) do
    # Application env pelo mesmo motivo do `session_pending_work`: quem chama é
    # o dev agent, em processo próprio. Default é o provider `local`, que é o
    # comportamento de toda a suite anterior ao ADR 0056.
    {:ok,
     Application.get_env(:engine, :fake_git_remote, %{
       kind: "local",
       origin: nil,
       default_branch: "main",
       token: nil,
       username: nil
     })}
  end

  @impl true
  def session_pending_work(_session_id) do
    # Application env, e NÃO dicionário de processo: quem chama isto é o
    # `SessionServer`, que roda em processo próprio (spawnado pelo supervisor)
    # — um `Process.put` do teste nunca chegaria lá. Default é "nada pendente",
    # para todo teste que não se importa manter o comportamento antigo.
    {:ok, Application.get_env(:engine, :fake_pending_work, %{pending: false, motivo: nil})}
  end

  @impl true
  def llm_turn_stream(_project_id, _session_id, agent, messages, tools, on_delta) do
    notify({:llm_turn_stream, agent, messages, tools})

    # `:fake_llm_turn_stream_hang` — o turno FICA parado aqui, como uma
    # chamada SSE de verdade presa no meio do stream. Existe só para provar
    # que `Task.shutdown/2` (`:brutal_kill`, RN-122) mata a task DE VERDADE
    # no meio de uma chamada em andamento — sem isto, todo turno fake
    # retorna instantâneo e "cancelar no meio" nunca teria um "meio" real
    # para interromper. Avisa `:turno_pendurado` antes de travar, para o
    # teste saber exatamente quando o turno "começou a gastar" — e nunca
    # manda mensagem nenhuma depois: se a task NÃO for morta, o teste que
    # espera silêncio (`refute_receive`) prova a diferença.
    if Process.get(:fake_llm_turn_stream_hang) do
      if pid = Application.get_env(:engine, :test_pid), do: send(pid, :turno_pendurado)
      Process.sleep(:infinity)
    end

    # Deltas scriptados (opcional) — rebroadcastados pelo on_delta.
    for delta <- Process.get(:fake_deltas, []), do: on_delta.(delta)

    resp =
      cond do
        r = Process.get(:fake_llm_always) ->
          r

        true ->
          case Process.get(:fake_llm_turns, []) do
            [r | rest] ->
              Process.put(:fake_llm_turns, rest)
              r

            [] ->
              final_response()
          end
      end

    # Mesmo idioma do `reply/2`: um script já em forma de `{:error, _}` passa
    # direto, para o teste simular "a api caiu no meio do stream" sem uma
    # chave separada só para isso.
    case resp do
      {:error, _} = erro -> erro
      valor -> {:ok, valor}
    end
  end

  @impl true
  def llm_turn(_project_id, _session_id, agent, messages, tools) do
    notify({:llm_turn, agent, messages, tools})

    cond do
      # Transporte quebrado (provider fora/timeout) — o ToolLoop guarda isso
      # em `:last_error`, e é o que distingue "falhou a infra" de "o modelo
      # parou sozinho" pra quem consome o desfecho.
      reason = Process.get(:fake_llm_turn_error) ->
        {:error, reason}

      resp = Process.get(:fake_llm_always) ->
        {:ok, resp}

      true ->
        case Process.get(:fake_llm_turns, []) do
          [resp | rest] ->
            Process.put(:fake_llm_turns, rest)
            {:ok, resp}

          [] ->
            {:ok, final_response()}
        end
    end
  end

  @impl true
  def propose_action(_project_id, _session_id, action_type, actor, payload) do
    notify({:propose_action, action_type, actor, payload})

    # Default `auto_approved` porque é o que a REALIDADE faz: o
    # `ActivateExecutionUseCase` semeia `auto_approve` para git_commit/git_push/
    # pr_open de todo dev agent. Era `pending` aqui, e não fazia diferença
    # enquanto `AgentIo.propose/3` descartava o status — a partir da Fase 12e
    # faz, e um default que não é o de produção mandaria toda a suite pelo
    # caminho da aprovação manual. Quem quer testar esse caminho põe
    # `:fake_propose_action` no dicionário de processo.
    # `:fake_propose_action_by_type` tem precedência e é por TIPO de ação —
    # necessário desde a Fase 12e para exercitar "o terminal executou, mas as
    # ações git ficaram pendentes de aprovação", que é exatamente a
    # configuração em que o gate abria sem PR nenhuma.
    por_tipo = Process.get(:fake_propose_action_by_type, %{})

    resposta =
      Map.get(por_tipo, action_type) ||
        Process.get(:fake_propose_action, %{"id" => "pa-1", "status" => "auto_approved"})

    {:ok, resposta}
  end

  # RN-423 (ADR 0104) — scriptável via `:fake_confirm_workspace` (padrão
  # `{:error, motivo}` pra exercitar recusa) ou `{:ok, resp}`; default aceita
  # e devolve o path recebido, como a api faria numa confirmação bem-sucedida.
  @impl true
  def confirm_workspace(project_id, session_id, path, user_id) do
    notify({:confirm_workspace, project_id, session_id, path, user_id})

    case Process.get(:fake_confirm_workspace) do
      nil -> {:ok, %{"verified" => true, "workspacePath" => path}}
      resultado -> resultado
    end
  end

  @doc """
  Resposta que só devolve texto final, sem tool calls (encerra o loop).

  `model_name` (achado do problema 2, RN-146) — default `nil`, o mesmo
  comportamento de sempre: quem não passa continua exercitando o caminho de
  evento ANTIGO (sem `modelName` no payload de `agent.response`).
  """
  def final_response(content \\ "pronto", model_name \\ nil) do
    %{
      "message" => %{"role" => "assistant", "content" => content, "toolCalls" => []},
      "usage" => %{
        "inputTokens" => 0,
        "outputTokens" => 0,
        "costMicros" => 0,
        "estimated" => true
      },
      "error" => nil,
      "modelName" => model_name
    }
  end

  @doc "Resposta com uma tool call (pede a ferramenta `name` com `args`)."
  def tool_call_response(name, args) do
    %{
      "message" => %{
        "role" => "assistant",
        "content" => "",
        "toolCalls" => [%{"id" => "tc-#{name}", "name" => name, "arguments" => args}]
      },
      "usage" => %{
        "inputTokens" => 0,
        "outputTokens" => 0,
        "costMicros" => 0,
        "estimated" => true
      },
      "error" => nil
    }
  end

  defp notify(msg) do
    if pid = Application.get_env(:engine, :test_pid), do: send(pid, msg)
    :ok
  end
end
