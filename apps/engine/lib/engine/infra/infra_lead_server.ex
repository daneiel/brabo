defmodule Engine.Infra.InfraLeadServer do
  @moduledoc """
  Infra Lead (Fase 4a; área — Fase 8c, ADR 0038). Ativado pelo handoff
  aceito do Arquiteto (contato externo INALTERADO — mesma chave de
  registro, mesmo `InfraLeadSupervisor.start_agent/2`), consome module_map +
  ADRs `infraRelevant` e continua gerando Dockerfiles/compose PRA SI (o
  trabalho que o antigo `InfraAgentServer` fazia sozinho), delegando o
  pipeline de CI pro subagente `Engine.Infra.WorkflowsAgent` — os dois se
  consolidam (`Engine.Infra.InfraLead.consolidar/2`) numa PR única via
  `open_infra_pr`, auto-aprovada pela autonomia seedada no accept do
  handoff — NUNCA aplica nada em ambiente, só propõe.

  Espelha o `Engine.Agents.ArquitetoServer`: GenServer por sessão, estado +
  rehydration + streaming + loop bounded de tool use. Kickoff no start
  fresco. Tools NUNCA incluem `Terminal` — restrição estrutural (defesa em
  profundidade: `agent_autonomy (infra, terminal) = deny`, ver ADR 0014).

  Também elege, entre as imagens candidatas que o Arquiteto roteou por módulo
  (`route_modules_to_infra`, ADR 0131), qual sobe como o container real do
  projeto — `propose_container_start` (ADR 0131/RN-487, PR 1.5), independente
  da PR de infra: nunca inventa candidata fora da lista, e vira
  `proposed_action` que SEMPRE exige aprovação humana.

  Desde a RN-506 (ADR 0145) ganha uma SEGUNDA tool de subir container,
  `container_start_via_runner` — exclusiva de projeto `execution_mode:
  runner` (não elege candidata nenhuma; ver o moduledoc de
  `Engine.Infra.Tools.ProposeContainerStartViaRunner`). O dispatch dela
  CONSULTA LOCALMENTE (`Project.get/1` + `Engine.Runners.Registry.
  connected?/1`, sem HTTP — os dois rodam no mesmo processo BEAM do Infra
  Lead) o `execution_mode` do projeto e a presença de um runner conectado
  ANTES de propor, recusando com motivo NOMEADO em vez de propor às cegas.

  ## Por que este continua sendo um GenServer conversacional e o Workflows não

  O QA (Fase 8b) reconstruiu seus subagentes sobre `ToolLoop`
  project/task-scoped porque o `QAAgent` de antes já era assim. Este agente
  não era: é conversacional, session-scoped, espelho do `ArquitetoServer` — e
  o pedido (CLAUDE.md 8c item 1) é "contato externo inalterado", não "vire o
  padrão do QA". Então o Lead continua GenServer conversacional; o
  `WorkflowsAgent`, que não conversa com ninguém (delegado síncrono,
  single-shot), usa `ToolLoop` bounded — mesma família dos subagentes de QA.
  Duas famílias arquiteturais dentro da MESMA área — o ADR 0038 descreve o
  contrato lead↔subagente, não a implementação interna de cada um.

  ## `propose_infra_pr` muda de "propõe agora" pra "sinaliza que terminei"

  Antes, a tool `propose_infra_pr` chamava a api direto (`ProposeInfraPr.
  run/2`). Agora, pra consolidar numa PR SÓ com o que o Workflows gera,
  `dispatch_calls/2` intercepta essa tool ANTES de rodar `run_tool/3` — o
  turno HALTS e devolve `{title, files}` pra `finalize/3`, que roda o
  Workflows, consolida, e só então chama a api (uma vez, com a união dos
  arquivos). O SPEC da tool não muda — o modelo não percebe diferença
  nenhuma.
  """

  use GenServer, restart: :temporary

  alias Engine.Harness.{ContextBuilder, PromptAssembler, ContextManager, ToolCallRecovery}
  alias Engine.Infra.{InfraLead, WorkflowsAgent}

  alias Engine.Infra.Tools.{
    ValidateInfraFile,
    ProposeInfraPr,
    ProposeContainerStart,
    ProposeContainerStartViaRunner
  }

  alias Engine.Gates.Dispatcher
  alias Engine.Harness.ArtifactEmitter
  alias Engine.Projects.Project
  # `as: RunnerRegistry`, nunca `Registry` puro: este módulo já usa o
  # `Registry` NATIVO do Elixir/OTP em `via/1` (`{:via, Registry, ...}`) — um
  # alias sem `as:` teria sombreado essa referência sem erro de compilação
  # nenhum, e `via/1` teria silenciosamente virado uma chamada errada.
  alias Engine.Runners.Registry, as: RunnerRegistry
  alias Engine.Sessions.{EngineApiClient, LiveBroadcast}

  @agent "infra"

  alias Engine.Agents.FalhaDeTurno
  @max_iterations 14

  # --- API pública ---

  def start_link({session_id, project_id}) do
    GenServer.start_link(__MODULE__, {session_id, project_id}, name: via(session_id))
  end

  def via(session_id),
    do: {:via, Registry, {Engine.Sessions.Registry, "infra:" <> session_id}}

  def kickoff(session_id), do: GenServer.cast(via(session_id), :kickoff)

  def user_message(session_id, text),
    do: GenServer.call(via(session_id), {:user_message, text}, 180_000)

  @doc "Gate (QA/SecOps) pediu mudanças — mesma branch/PR, sem PR nova."
  def correct(session_id, findings), do: GenServer.cast(via(session_id), {:correct, findings})

  # --- Callbacks ---

  @impl true
  def init({session_id, project_id}) do
    system_msg = %{
      "role" => "system",
      "content" => system_prompt(project_id),
      :pinned => true
    }

    history = rehydrate(project_id, session_id)

    {:ok,
     %{
       session_id: session_id,
       project_id: project_id,
       agent: @agent,
       messages: [system_msg | history],
       tool_specs: [
         ValidateInfraFile.spec(),
         ProposeInfraPr.spec(),
         ProposeContainerStart.spec(),
         ProposeContainerStartViaRunner.spec()
       ]
     }}
  end

  @impl true
  def handle_cast(:kickoff, state) do
    broadcast(state, "agent.status", %{status: "working"})

    state =
      state
      |> append(user_msg(kickoff_instruction(state)))
      |> compact()
      |> run_turn(@max_iterations)
      |> conclude()

    {:noreply, state}
  end

  # Gate (QA/SecOps) reprovou (Fase 4a) — corrige na MESMA branch/PR:
  # instrui o modelo a ajustar os arquivos e chamar `propose_infra_pr` de
  # novo. `:correct` reroda a ÁREA INTEIRA (Lead + Workflows) — mesma
  # filosofia de "ciclo K no nível da área" do 8b: não tenta decidir qual
  # dos dois é "dono" do finding, e `ExecuteInfraPrUseCase` já recommita na
  # mesma PR quando o artefato de sessão já existe (idempotente).
  @impl true
  def handle_cast({:correct, findings}, state) do
    broadcast(state, "agent.status", %{status: "working"})

    instruction =
      user_msg(
        "O gate #{findings.gate} pediu mudanças: #{findings.reason}\n" <>
          "Detalhes: #{findings.diagnosis}\n" <>
          "Corrija os arquivos de infra que forem seus (Dockerfiles/compose) e chame " <>
          "`propose_infra_pr` de novo com os arquivos corrigidos (pode repetir o título). " <>
          "Se o achado for sobre o pipeline de CI, ainda assim chame `propose_infra_pr` com " <>
          "os seus arquivos — o Workflows é rerrodado junto e a correção dele entra na mesma PR."
      )

    state =
      state
      |> append(instruction)
      |> compact()
      |> run_turn(@max_iterations)
      |> conclude()

    {:noreply, state}
  end

  @impl true
  def handle_call({:user_message, text}, _from, state) do
    broadcast(state, "agent.status", %{status: "working"})

    state =
      state
      |> append(user_msg(text))
      |> compact()
      |> run_turn(@max_iterations)
      |> conclude()

    {:reply, :ok, state}
  end

  # --- Turno com loop bounded de tool use ---

  # `{:done, state}` — turno acabou sem propor (sem tool call, ou limite de
  # iterações). `{:proposed, title, files, state}` — o modelo chamou
  # `propose_infra_pr`; o turno HALTS aqui, sem consumir mais iterações.
  defp run_turn(state, remaining) when remaining <= 0, do: {:done, state}

  defp run_turn(state, remaining) do
    # Ver o comentário em `criativo_server.ex`: quem fala é o agente (achado C).
    on_delta = fn text -> broadcast(state, "agent.delta", %{text: text, agent: @agent}) end
    wire = Enum.map(state.messages, &to_wire/1)

    case EngineApiClient.llm_turn_stream(
           state.project_id,
           state.session_id,
           @agent,
           wire,
           state.tool_specs,
           on_delta
         ) do
      # A api narra a falha no PRÓPRIO frame final (budget, credencial, binding).
      # Isto não caía no `{:error, _}` abaixo e não emitia evento nenhum: o
      # turno terminava em silêncio absoluto, pior que o balão vazio.
      {:ok, %{"error" => erro}} when is_binary(erro) and erro != "" ->
        emit_falha(state, {:final, erro})
        {:done, state}

      {:ok, %{"message" => message}} ->
        content = Map.get(message, "content", "")
        state = append(state, assistant_msg(content))
        if content != "", do: emit_response(state, content)

        case tool_calls(message, state.tool_specs) do
          [] -> {:done, state}
          calls -> dispatch_calls(calls, state, remaining)
        end

      {:error, reason} ->
        # NUNCA mais `agent.response` vazio aqui: no event log ele é
        # indistinguível de sucesso, e o motivo real ia só por broadcast, que
        # é efêmero. A falha vira evento durável COM origem, e o agente diz o
        # que houve no próprio fio.
        emit_falha(state, reason)
        {:done, state}
    end
  end

  defp dispatch_calls(calls, state, remaining) do
    calls
    |> Enum.reduce_while({:cont, state}, fn call, {:cont, st} ->
      case Map.get(call, "name") do
        "propose_infra_pr" ->
          args = Map.get(call, "arguments", %{})
          title = Map.get(args, "title", "Dockerfiles e compose de dev")
          files = Map.get(args, "files", [])

          st =
            append(st, %{
              "role" => "tool",
              "content" => "arquivos recebidos, consolidando com o Workflows antes de propor.",
              "toolCallId" => Map.get(call, "id"),
              "name" => "propose_infra_pr",
              :pinned => false
            })

          {:halt, {:proposed, title, files, st}}

        "propose_container_start" ->
          {:cont, {:cont, dispatch_container_start(call, st)}}

        "container_start_via_runner" ->
          {:cont, {:cont, dispatch_container_start_via_runner(call, st)}}

        _ ->
          {:cont, {:cont, dispatch_tool(call, st)}}
      end
    end)
    |> case do
      {:proposed, _title, _files, _state} = result -> result
      {:cont, state} -> run_turn(state, remaining - 1)
    end
  end

  # `propose_container_start` NÃO halts como `propose_infra_pr` — é ação
  # independente (elege candidata do roteamento do Arquiteto, ADR 0131), sem
  # consolidação com o Workflows. Despacha inline, direto pra api, e deixa o
  # loop continuar: o modelo pode chamar `propose_infra_pr` antes/depois, ou
  # nunca chamar esta.
  defp dispatch_container_start(call, state) do
    args = Map.get(call, "arguments", %{})
    id = Map.get(call, "id")

    payload = %{
      imagem: Map.get(args, "imagem", ""),
      network: Map.get(args, "network", "none"),
      resources: Map.get(args, "resources", %{}),
      rationale: Map.get(args, "rationale", "")
    }

    emit(state, "tool.call", %{tool: "propose_container_start", args: payload})

    actor = %{kind: "agent", id: @agent}

    text =
      case EngineApiClient.propose_action(
             state.project_id,
             state.session_id,
             "container_start",
             actor,
             payload
           ) do
        {:ok, %{"id" => _id, "status" => status}} ->
          "container_start proposto (status #{status}) — decisão final do usuário."

        {:error, reason} ->
          "container_start recusado: #{inspect(reason)}"
      end

    append(state, %{
      "role" => "tool",
      "content" => text,
      "toolCallId" => id,
      "name" => "propose_container_start",
      :pinned => false
    })
  end

  # `container_start_via_runner` (RN-506, ADR 0145) — MESMO desenho de
  # `dispatch_container_start/2` (despacha inline, sem HALT), com uma
  # diferença: ANTES de chamar `propose_action`, consulta LOCALMENTE
  # (`Project.get/1` + `RunnerRegistry.connected?/1`, sem HTTP — os dois
  # rodam no mesmo processo BEAM deste GenServer) se o projeto está mesmo em
  # `execution_mode: runner` e se há um runner conectado. Recusa com motivo
  # NOMEADO em vez de propor às cegas — a lacuna que a RN-494 deixou
  # declarada para `propose_container_start` (que não sabe distinguir modo
  # nem runner conectado) não se repete aqui, porque esta tool nasce sabendo
  # negar.
  defp dispatch_container_start_via_runner(call, state) do
    args = Map.get(call, "arguments", %{})
    id = Map.get(call, "id")
    rationale = Map.get(args, "rationale", "")

    text =
      case recusa_local_de_container_start_via_runner(state.project_id) do
        nil ->
          emit(state, "tool.call", %{
            tool: "container_start_via_runner",
            args: %{rationale: rationale}
          })

          actor = %{kind: "agent", id: @agent}

          case EngineApiClient.propose_action(
                 state.project_id,
                 state.session_id,
                 "container_start_via_runner",
                 actor,
                 %{rationale: rationale}
               ) do
            {:ok, %{"id" => _id, "status" => status}} ->
              "container_start_via_runner proposto (status #{status}) — decisão final do usuário."

            {:error, reason} ->
              "container_start_via_runner recusado: #{inspect(reason)}"
          end

        motivo ->
          motivo
      end

    append(state, %{
      "role" => "tool",
      "content" => text,
      "toolCallId" => id,
      "name" => "container_start_via_runner",
      :pinned => false
    })
  end

  # `nil` quando pode propor; mensagem NOMEADA quando não pode. As DUAS
  # leituras são locais — `Project.get/1` (mesmo padrão de
  # `Engine.Actions.TerminalExecutor`) e `RunnerRegistry.connected?/1`
  # (`:global`, alcança runner conectado em QUALQUER nó do cluster) — nenhuma
  # bate na api.
  defp recusa_local_de_container_start_via_runner(project_id) do
    case Project.get(project_id) do
      nil ->
        "projeto não encontrado."

      %{execution_mode: "runner"} ->
        if RunnerRegistry.connected?(project_id) do
          nil
        else
          "nenhum runner está conectado a este projeto agora — peça ao " <>
            "usuário para rodar `brabo-runner --project #{project_id} --dir " <>
            "<pasta>` na máquina dele antes de propor de novo."
        end

      %{execution_mode: "mounted"} ->
        "projeto no modo `mounted` — desde a RN-503 ele sobe pelo BROKER, " <>
          "como `container`. Use `propose_container_start`, não esta tool."

      %{execution_mode: outro} ->
        "projeto no modo `#{outro}` — container_start_via_runner é exclusiva " <>
          "de `runner`. Use `propose_container_start` (o broker)."
    end
  end

  defp dispatch_tool(call, state) do
    name = Map.get(call, "name")
    args = Map.get(call, "arguments", %{})
    id = Map.get(call, "id")

    emit(state, "tool.call", %{tool: name, args: args})

    text =
      case run_tool(name, args, state) do
        {:ok, s} -> s
        {:error, s} -> s
      end

    append(state, %{
      "role" => "tool",
      "content" => text,
      "toolCallId" => id,
      "name" => name,
      :pinned => false
    })
  end

  defp run_tool("validate_infra_file", args, state), do: ValidateInfraFile.run(args, state)
  defp run_tool(name, _args, _state), do: {:error, "ferramenta desconhecida: #{name}"}

  # --- Conclusão do turno: consolida com o Workflows e propõe (ou bloqueia) ---

  # `agent.status` só aceita "working"/"idle" (`LiveBroadcast.agent_status/4`
  # — contrato compartilhado com Criativo/PO/Arquiteto, não estendo pra um
  # terceiro valor). "blocked" descreveria o DESFECHO da rodada, não se o
  # agente está disponível — o agente terminou o turno de qualquer jeito, e
  # o desfecho de bloqueio já fica visível pelo evento `dev.error` que
  # `aplicar/2` emite.
  defp conclude({:proposed, title, files, state}) do
    {_status, state} = finalize(state, title, files)
    broadcast(state, "agent.done", %{})
    broadcast(state, "agent.status", %{status: "idle"})
    state
  end

  defp conclude({:done, state}) do
    broadcast(state, "agent.done", %{})
    broadcast(state, "agent.status", %{status: "idle"})
    state
  end

  defp finalize(state, title, files) do
    resultado_lead = {:ok, %{files: files, summary: title}}
    infra_ctx = fetch_infra_ctx(state)
    resultado_workflows = WorkflowsAgent.run(state.project_id, state.session_id, infra_ctx)

    emit_delegation_result(state, "infra-lead", resultado_lead)
    emit_delegation_result(state, "infra-workflows", resultado_workflows)

    InfraLead.consolidar(resultado_lead, resultado_workflows)
    |> aplicar(state)
  end

  defp fetch_infra_ctx(state) do
    case EngineApiClient.get_infra_context(state.project_id, state.session_id) do
      {:ok, ctx} -> ctx
      _ -> %{}
    end
  end

  defp aplicar({:ok, %{title: title, files: files}}, state) do
    {:idle, abrir_pr(state, title, files)}
  end

  defp aplicar({:blocked, %{reason: reason}}, state) do
    emit(state, "dev.error", %{agentId: "infra-lead", reason: reason})
    {:blocked, state}
  end

  # Extraído de `Engine.Infra.Tools.ProposeInfraPr.run/2` (Fase 4a) — a
  # chamada de api que abria a PR direto na tool call agora acontece aqui,
  # depois da consolidação com o Workflows, uma vez só, com a UNIÃO dos
  # arquivos.
  defp abrir_pr(state, title, files) do
    actor = %{kind: "agent", id: @agent}
    payload = %{title: title, files: files}

    case EngineApiClient.propose_action(
           state.project_id,
           state.session_id,
           "open_infra_pr",
           actor,
           payload
         ) do
      {:ok, %{"id" => id, "status" => "executed"}} ->
        Dispatcher.run_infra_qa(state.project_id, state.session_id, id)
        state

      {:ok, %{"id" => _id, "status" => _status}} ->
        state

      {:error, reason} ->
        broadcast(state, "agent.error", %{reason: inspect(reason)})
        state
    end
  end

  # Emite `infra_delegation_files` (server-emitted, dá o `parecer_artifact_id`
  # que `delegations` exige) e registra a delegação — SEMPRE os dois
  # delegados, mesmo o próprio Lead (RN-037: "delega pra si" também é
  # rastreado, não só o Workflows).
  defp emit_delegation_result(state, subagent, {:ok, resultado}) do
    case ArtifactEmitter.emit_returning(
           state.project_id,
           state.session_id,
           subagent,
           "infra_delegation_files",
           %{files: resultado.files, summary: resultado.summary}
         ) do
      {:ok, event} ->
        record_delegation(state, subagent, %{
          status: "completed",
          parecer_artifact_id: Map.get(event, "id")
        })

      {:error, reason} ->
        record_delegation(state, subagent, %{
          status: "failed",
          failure_origin: "codigo",
          failure_reason: "resultado inválido: #{inspect(reason)}"
        })
    end
  end

  defp emit_delegation_result(state, subagent, {:blocked, info}) do
    record_delegation(state, subagent, %{
      status: "failed",
      failure_origin: info.origin,
      failure_reason: "#{info.reason} — #{info.diagnosis}"
    })
  end

  # Sem `task_id`: a área de Infra delega sobre a SESSÃO, sem task de
  # backlog por trás (a rota/coluna são nullable desde a Fase 8c).
  defp record_delegation(state, subagent, campos) do
    EngineApiClient.record_delegation(
      Map.merge(
        %{
          project_id: state.project_id,
          session_id: state.session_id,
          lead_agent: "infra-lead",
          area: "infra",
          subagent: subagent
        },
        campos
      )
    )

    :ok
  end

  # --- Kickoff ---

  defp kickoff_instruction(state) do
    case EngineApiClient.get_infra_context(state.project_id, state.session_id) do
      {:ok, ctx} -> build_kickoff(ctx)
      _ -> "Proponha os artefatos de infra (Dockerfiles, compose de dev)."
    end
  end

  defp build_kickoff(ctx) do
    module_map = Map.get(ctx, "moduleMap")
    adrs = Map.get(ctx, "adrs", [])
    routing = Map.get(ctx, "moduleRouting")

    modules_text =
      case module_map do
        %{"modules" => modules} when is_list(modules) and modules != [] ->
          Enum.map_join(modules, "\n", fn m ->
            "- #{Map.get(m, "name")} (#{Map.get(m, "stack")}): #{Map.get(m, "responsibility")}"
          end)

        _ ->
          "(sem module_map vigente)"
      end

    adrs_text =
      case adrs do
        [] ->
          "(nenhum ADR marcado infraRelevant)"

        adrs ->
          Enum.map_join(adrs, "\n\n", fn a ->
            "#{Map.get(a, "title")}\n#{Map.get(a, "content")}"
          end)
      end

    routing_text =
      case routing do
        %{"status" => "roteado", "roteamento" => rotas} when is_list(rotas) and rotas != [] ->
          Enum.map_join(rotas, "\n", fn r ->
            "- #{Map.get(r, "modulo")}: #{Map.get(r, "imagemCandidata")} — #{Map.get(r, "porque")}"
          end)

        _ ->
          "(sem roteamento vigente — o Arquiteto não rodou route_modules_to_infra nesta sessão)"
      end

    """
    Você recebeu o handoff do Arquiteto. Proponha os artefatos de INFRA que são
    SEUS — Dockerfiles e compose de dev. O pipeline de CI é responsabilidade de
    outra subespecialidade (Workflows), que roda depois e junta o resultado à
    mesma PR — você não precisa gerá-lo.

    1. Para cada módulo do module_map abaixo, gere um Dockerfile adequado ao stack.
    2. Gere um compose de desenvolvimento (docker-compose.yml) integrando os módulos.
    3. Valide CADA arquivo com `validate_infra_file` (path + content) antes de propor.
    4. Chame `propose_infra_pr` (title + files) com o que é seu — a consolidação
       com o pipeline de CI acontece depois, automaticamente.
    5. Se houver roteamento de módulos abaixo, ELEJA uma das imagens candidatas
       para o container do projeto e chame `propose_container_start` (imagem +
       network + resources + rationale dizendo por que ESTA candidata, nunca
       inventando uma imagem fora da lista). Este passo é INDEPENDENTE dos
       anteriores — pode acontecer antes, depois, ou nunca (sem roteamento
       vigente, pule-o; o container do projeto segue como está).
    6. Se o projeto estiver no modo `runner` (código na máquina do usuário, sem
       bind-mount pro servidor), `propose_container_start` não serve — chame
       `container_start_via_runner` (só `rationale` opcional, sem eleger nada:
       sobe a imagem já decidida). Se você não souber o modo, tente
       `container_start_via_runner`; a recusa nomeada diz qual dos dois usar.

    Você NUNCA aplica nada em ambiente — só propõe. Sem acesso a terminal.

    MÓDULOS:
    #{modules_text}

    ADRs DE INFRA:
    #{adrs_text}

    ROTEAMENTO DE MÓDULOS (candidatas do Arquiteto — você ELEGE):
    #{routing_text}
    """
  end

  # --- Rehydration ---

  defp rehydrate(project_id, session_id) do
    case EngineApiClient.list_events(project_id, session_id) do
      {:ok, events} -> events |> Enum.map(&to_message/1) |> Enum.reject(&is_nil/1)
      _ -> []
    end
  end

  defp to_message(%{"type" => "chat.message", "payload" => payload}),
    do: user_msg(Map.get(payload, "text", ""))

  defp to_message(%{"type" => "agent.response", "payload" => payload}),
    do: assistant_msg(Map.get(payload, "content") || Map.get(payload, "text") || "")

  defp to_message(_event), do: nil

  # --- Helpers ---

  defp compact(state) do
    {:ok, state} = ContextManager.maybe_compact(state)
    state
  end

  defp system_prompt(project_id) do
    project_id
    |> ContextBuilder.build_layers(@agent)
    |> PromptAssembler.assemble()
    |> PromptAssembler.Default.render()
  end

  defp user_msg(text), do: %{"role" => "user", "content" => text, :pinned => false}

  defp assistant_msg(content),
    do: %{"role" => "assistant", "content" => content, :pinned => false}

  defp append(state, message), do: %{state | messages: state.messages ++ [message]}

  defp to_wire(message), do: Map.delete(message, :pinned)

  # Modelo local costuma descrever a chamada em TEXTO em vez de usar o
  # protocolo nativo. O ToolLoop já recuperava isso (ADR 0020), mas os agentes
  # conversacionais têm loop PRÓPRIO e ficaram de fora — o InfraAgent morria
  # com resposta vazia tendo escrito o `propose_infra_pr` certo em texto.
  defp tool_calls(message, tool_specs) do
    case Map.get(message, "toolCalls") || [] do
      [] ->
        ToolCallRecovery.from_content(
          Map.get(message, "content", ""),
          Enum.map(tool_specs, & &1.name)
        )

      nativas ->
        nativas
    end
  end

  defp emit_response(state, content),
    do: emit(state, "agent.response", %{content: content})

  # A falha, gravada e DITA. O `broadcast` continua, para quem está com a aba
  # aberta ver na hora — mas ele deixou de ser a única fonte.
  defp emit_falha(state, reason) do
    origem = FalhaDeTurno.origem(reason)
    mensagem = FalhaDeTurno.mensagem(reason)

    emit(state, "agent.error", %{
      origem: origem,
      mensagem: mensagem,
      reason: inspect(reason)
    })

    broadcast(state, "agent.error", %{origem: origem, mensagem: mensagem})
  end

  defp emit(state, type, payload) do
    EngineApiClient.append_event(state.project_id, state.session_id, %{
      type: type,
      actorKind: "agent",
      actorId: @agent,
      payload: payload
    })

    Engine.Sessions.LiveBroadcast.event_appended(state.session_id, type, @agent, payload)
  end

  # `agent.status` PRECISA ser persistido, não só broadcastado: o painel do
  # time deriva o roster do event log buscado por HTTP (ver
  # Engine.Sessions.LiveBroadcast.agent_status/4 e o ADR 0021).
  defp broadcast(state, "agent.status", %{status: status}) do
    LiveBroadcast.agent_status(state.project_id, state.session_id, @agent, status)
  end

  defp broadcast(state, event, payload) do
    EngineWeb.Endpoint.broadcast("session:" <> state.session_id, event, payload)
  end
end
