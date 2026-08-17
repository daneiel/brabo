defmodule Engine.Agents.DevLeadServer do
  @moduledoc """
  Dev Lead conversacional (FASE 14d item 5, [ADR 0053]).

  Ativado pelo handoff aceito do Arquiteto, consome o `module_map` e o backlog
  e propõe o PLANO de execução: quantos agentes por módulo e por quê. Ele **não
  escreve código** — distribui trabalho e responde por ele.

  Espelha o `Engine.Agents.ArquitetoServer` e o `Engine.Infra.InfraLeadServer`:
  GenServer por sessão, estado + rehydration + streaming + loop bounded de tool
  use. Kickoff no start fresco.

  ## Por que ele existe

  Antes, o Arquiteto terminava e a execução subia por um botão, **sem ninguém
  no meio para avaliar o trabalho**. O teto de paralelismo da
  [RN-083](../../../../docs/business-rules.md) dizia "quem decide é o lead", e o
  lead não existia — a frase não tinha dono.

  ## Por que ele é o único endereço externo da execução

  Ao virarem membros da área de `dev`, os `dev-<modulo>` deixaram de ser
  endereçáveis por handoff (`agent-areas.ts` na api). Isso não é exceção nova:
  é a regra de handoff do ADR 0038 passando a valer para o dev como já valia
  para QA e Infra.

  Sem `Terminal` e sem `write_file` — restrição ESTRUTURAL, não de política: um
  lead que escrevesse código faria o trabalho que delegou.

  ## O plano suspende o turno esperando aprovação (ADR 0086, RN-284)

  `propose_execution_plan` virou `proposed_action` de verdade (ver o
  moduledoc de `Engine.Agents.DevLeadTools`), e este servidor é a PRIMEIRA
  vez que um agente conversacional (síncrono, `GenServer.call` de até 180s
  via `TurnoAssincrono`) suspende esperando decisão humana — o dev agent
  (ADR 0052) e os gates de QA/Infra (ADR 0057) já suspendiam, mas os três são
  disparados por `cast` e nunca esperavam resposta síncrona.

  O mecanismo: quando `run_turn/2` recebe `{:pending, action_id}` de um tool
  call, ele PARA o laço (sem processar mais chamadas nem recursar) e devolve
  o `state` com a chave `:aguardando_aprovacao` —
  `%{action_id:, tool_call_id:, tool_name:, remaining:}`.
  `TurnoAssincrono.tratar_resultado/2` vê essa chave, responde ao `from` (o
  que rompe o bloqueio síncrono no momento certo) e emite só
  `agent.status: awaiting_approval` — SEM `agent.done`, porque o turno não
  terminou.

  Assinado via `Engine.Dev.Wake.subscribe/2` (o MESMO módulo que
  `Engine.Gates.QaLeadServer` reusa para os subagentes de QA, apesar do nome
  ser "dev" — a entrega de `{:action_settled, ...}` é por AGENTE, e "dev-lead"
  é só mais um id de agente para o worker que drena a outbox), este servidor
  recebe `{:action_settled, desfecho}` quando a api decide a ação. A mensagem
  `role: "tool"` com o resultado REAL só entra em `state.messages` NESSE
  momento — nunca antes, porque gravar "pending" ali mentiria pro modelo que
  o comando já respondeu isso (mesmo raciocínio do dev agent, ver
  `Engine.Harness.Hooks.ActionPipeline` e `Engine.Harness.ToolLoop`). O laço
  retoma de `pendente.remaining`, que já desconta a iteração suspensa.

  Enquanto `aguardando_aprovacao` está setado, uma segunda `user_message`
  NÃO inicia turno novo — vira `agent.error` (origem `politica`) explicando
  que há uma decisão pendente em Aprovações.

  **Lacuna aceita, declarada**: se o engine reiniciar enquanto o Dev Lead
  está suspenso, o `aguardando_aprovacao` (só em memória) se perde — ao
  contrário do dev agent, este servidor NÃO reidrata `laco_pendente`. A
  decisão continua registrada e visível em Aprovações (é durável na api), mas
  o Dev Lead não narra o desfecho automaticamente quando ele chegar: o
  processo que assinou o `Wake` morreu, e o próximo restart sobe um Dev Lead
  novo, sem inscrição para aquela ação. Fechar isto exigiria o mesmo
  mecanismo de reidratação do ADR 0052 (`handle_continue`, resume por linha
  durável) — fora do escopo desta mudança, que só faz o comportamento bater
  com o que `docs/fluxo.yml` já declarava.
  """

  use GenServer, restart: :temporary

  alias Engine.Harness.{ContextBuilder, PromptAssembler, ContextManager, ToolCallRecovery}
  alias Engine.Agents.{DevLeadTools, FalhaDeTurno, TurnoAssincrono}
  alias Engine.Dev.Wake
  alias Engine.Sessions.EngineApiClient

  @agent "dev-lead"

  # Conversacional: o teto do TIPO (RN-085) vale para o laço do harness; este
  # servidor tem laço próprio, e 14 é o mesmo do Arquiteto e do Infra Lead.
  @max_iterations 14

  # --- API pública ---

  def start_link({session_id, project_id}) do
    GenServer.start_link(__MODULE__, {session_id, project_id}, name: via(session_id))
  end

  def via(session_id),
    do: {:via, Registry, {Engine.Sessions.Registry, "dev-lead:" <> session_id}}

  def kickoff(session_id), do: GenServer.cast(via(session_id), :kickoff)

  def user_message(session_id, text),
    do: GenServer.call(via(session_id), {:user_message, text}, 180_000)

  # --- Callbacks ---

  @impl true
  def init({session_id, project_id}) do
    system_msg = %{
      "role" => "system",
      "content" => system_prompt(project_id),
      :pinned => true
    }

    history = rehydrate(project_id, session_id)

    # Assina pelo próprio id — `task.action_settled` chega chaveado pelo ator
    # que PROPÔS a ação (`acao.actor.id`, ver `avisarQuemEsperava` na api), e
    # quem propõe `propose_execution_plan` é sempre "dev-lead". Mesmo módulo
    # que `Engine.Gates.QaLeadServer` já reusa para os subagentes de QA.
    :ok = Wake.subscribe(project_id, @agent)

    {:ok,
     %{
       session_id: session_id,
       project_id: project_id,
       agent: @agent,
       messages: [system_msg | history],
       tool_specs: [DevLeadTools.spec()],
       # Guardado enquanto o turno roda numa Task supervisionada, fora do
       # handler que bloqueava o processo inteiro — é o que permite um
       # `:cancel` chegar e ser atendido (RN-122). Ver `TurnoAssincrono`.
       turno_assincrono: nil,
       # O laço suspenso esperando a decisão do plano de execução (ADR 0086,
       # RN-284). Só em memória — ver a lacuna de restart declarada no
       # moduledoc.
       aguardando_aprovacao: nil
     }}
  end

  # O turno passou a rodar numa Task (`TurnoAssincrono`), fora deste
  # handler: antes o processo inteiro ficava bloqueado até o turno terminar,
  # e um `:cancel` nunca era atendido nesse meio tempo (RN-122).
  @impl true
  def handle_cast(:kickoff, state) do
    work = state |> append(user_msg(kickoff_instruction(state))) |> compact()
    TurnoAssincrono.iniciar(state, nil, fn -> run_turn(work, @max_iterations) end)
  end

  @impl true
  def handle_cast(:cancel, state) do
    {:noreply, TurnoAssincrono.cancelar(state)}
  end

  # Guarda: enquanto o plano de execução está aguardando decisão do usuário,
  # a conversa NÃO recomeça — precisa vir ANTES da cláusula genérica de
  # `{:user_message, text}` para o pattern match casar aqui primeiro. A
  # resposta HTTP desta rota já é descartada pelo controller do engine para
  # todos os agentes, então `{:reply, :ok, state}` basta.
  @impl true
  def handle_call({:user_message, _text}, _from, %{aguardando_aprovacao: %{}} = state) do
    emit(state, "agent.error", %{
      origem: "politica",
      mensagem:
        "Há uma decisão de plano de execução pendente em Aprovações — a " <>
          "conversa não segue até ela ser decidida.",
      reason: "aguardando_aprovacao_de_plano"
    })

    {:reply, :ok, state}
  end

  @impl true
  def handle_call({:user_message, text}, from, state) do
    work = state |> append(user_msg(text)) |> compact()
    TurnoAssincrono.iniciar(state, from, fn -> run_turn(work, @max_iterations) end)
  end

  # A ação que segurava o laço teve desfecho (ADR 0086/RN-284 — mesmo padrão
  # do dev agent, ADR 0052, e do `QaLeadServer` para os subagentes de QA). O
  # resultado de verdade entra no lugar onde estaria a palavra "pending", e o
  # laço RETOMA de onde parou — `pendente.remaining` já desconta a iteração
  # suspensa contra o teto.
  #
  # Guard de identidade: só age se for a MESMA ação que este Dev Lead está
  # esperando — entrega duplicada (retry do Oban, drain concorrente) ou
  # tardia (o servidor já morreu e um novo subiu, ver a lacuna declarada no
  # moduledoc) vira no-op na cláusula seguinte, nunca derruba o processo.
  @impl true
  def handle_info(
        {:action_settled, %{action_id: action_id} = desfecho},
        %{aguardando_aprovacao: %{action_id: action_id} = pendente} = state
      ) do
    mensagem_tool = %{
      "role" => "tool",
      "content" => texto_do_desfecho(desfecho),
      "toolCallId" => pendente.tool_call_id,
      "name" => pendente.tool_name,
      :pinned => false
    }

    state =
      state
      |> append(mensagem_tool)
      |> Map.put(:aguardando_aprovacao, nil)

    TurnoAssincrono.iniciar(state, nil, fn -> run_turn(state, pendente.remaining) end)
  end

  # Desfecho de OUTRA ação, ou o Dev Lead já não está esperando: ignora em
  # vez de derrubar. A entrega é por agente, e nada garante que só chegue o
  # que se espera.
  def handle_info({:action_settled, _outro}, state), do: {:noreply, state}

  @impl true
  def handle_info(msg, state) do
    case TurnoAssincrono.tratar_resultado(msg, state) do
      {:ok, novo_state} -> {:noreply, novo_state}
      :ignorado -> {:noreply, state}
    end
  end

  # --- Turno com loop bounded de tool use ---

  defp run_turn(state, remaining) when remaining <= 0, do: state

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
      #
      # Devolve `state` (mapa), e NÃO `{state, ""}` (tupla): quem recebe o
      # retorno de `run_turn/2` é `TurnoAssincrono.tratar_resultado/2`, que faz
      # `Map.put(resultado, :turno_assincrono, nil)`. `Map.put/3` numa tupla
      # levanta `BadMapError` DENTRO do `handle_info` do agente e, como o
      # servidor é `restart: :temporary`, ele morria e não voltava — a correção
      # de uma falha silenciosa tinha virado uma QUEDA, com o gatilho mais
      # corriqueiro que existe (acabar o orçamento).
      {:ok, %{"error" => erro}} when is_binary(erro) and erro != "" ->
        emit_falha(state, {:final, erro})
        state

      {:ok, %{"message" => message} = frame} ->
        content = Map.get(message, "content", "")
        model_name = Map.get(frame, "modelName")
        state = append(state, assistant_msg(content))
        if content != "", do: emit_response(state, content, model_name)

        case tool_calls(message, state.tool_specs) do
          [] ->
            state

          calls ->
            # `reduce_while` — não `reduce` — porque `:pending` precisa PARAR
            # o laço no meio da lista, sem processar as chamadas seguintes
            # nem recursar para a próxima iteração. Antes de ADR 0086 as três
            # saídas de `dispatch_tool/2` cabiam num booleano; agora são três
            # desfechos distintos, e só um deles (suspensão) precisa
            # interromper o `Enum.reduce`.
            resultado =
              Enum.reduce_while(calls, {state, false}, fn call, {st, _planou} ->
                case dispatch_tool(call, st) do
                  {st2, :ok} ->
                    {:cont, {st2, true}}

                  {st2, :error} ->
                    {:cont, {st2, false}}

                  {st2, {:pending, action_id, tool_call_id, tool_name}} ->
                    {:halt, {:suspenso, st2, action_id, tool_call_id, tool_name}}
                end
              end)

            case resultado do
              {:suspenso, st2, action_id, tool_call_id, tool_name} ->
                # O `-1` documenta que a iteração suspensa CONTA contra o teto
                # quando retomada — mesma vizinhança de raciocínio do
                # comentário logo abaixo, sobre por que "bem-sucedido" encerra
                # o laço.
                Map.put(st2, :aguardando_aprovacao, %{
                  action_id: action_id,
                  tool_call_id: tool_call_id,
                  tool_name: tool_name,
                  remaining: remaining - 1
                })

              # O plano BEM-SUCEDIDO encerra o turno, como o `propose_infra_pr`
              # encerra o do Infra Lead. Sem isto o laço volta ao modelo, que
              # propõe de novo: na primeira execução real ele registrou DOIS
              # planos, com textos diferentes e o mesmo total — e o event log é
              # imutável, então nada dizia qual valia. A instrução "use UMA vez"
              # no spec é pedido, não garantia; quem garante é o laço parar.
              #
              # BEM-SUCEDIDO, e não "chamou a ferramenta": um plano RECUSADO
              # (vazio, ou com zero agente num módulo, ou denied pela api)
              # precisa deixar o laço seguir, senão a recusa vira fim de turno
              # e o modelo nunca chega a corrigir. A primeira versão desta
              # guarda olhava só o nome da ferramenta e tinha esse defeito.
              {st2, true} ->
                st2

              {st2, false} ->
                run_turn(st2, remaining - 1)
            end
        end

      {:error, reason} ->
        # NUNCA mais `agent.response` vazio aqui: no event log ele é
        # indistinguível de sucesso, e o motivo real ia só por broadcast, que
        # é efêmero. A falha vira evento durável COM origem, e o agente diz o
        # que houve no próprio fio.
        emit_falha(state, reason)
        state
    end
  end

  # Devolve `{state, :ok | :error | {:pending, action_id, tool_call_id,
  # tool_name}}` — o segundo elemento é o que `run_turn/2` usa para decidir
  # entre continuar, parar (sucesso) e SUSPENDER (pending, ADR 0086).
  defp dispatch_tool(call, state) do
    name = Map.get(call, "name")
    args = Map.get(call, "arguments", %{})
    id = Map.get(call, "id")

    emit(state, "tool.call", %{tool: name, args: args})

    case run_tool(name, args, state) do
      {:ok, texto} ->
        {append_tool_message(state, id, name, texto), :ok}

      {:pending, action_id} ->
        # A mensagem `role: "tool"` NÃO entra ainda — gravar "pending" ali
        # mentiria pro modelo que o comando já respondeu isso (mesmo
        # raciocínio do dev agent, ver `Engine.Harness.Hooks.ActionPipeline`
        # e `Engine.Harness.ToolLoop`, ~linhas 250-266). Ela entra de
        # verdade em `handle_info({:action_settled, ...})`, com o resultado
        # real.
        {state, {:pending, action_id, id, name}}

      {:error, texto} ->
        {append_tool_message(state, id, name, texto), :error}
    end
  end

  defp append_tool_message(state, id, name, texto) do
    append(state, %{
      "role" => "tool",
      "content" => texto,
      "toolCallId" => id,
      "name" => name,
      :pinned => false
    })
  end

  defp run_tool("propose_execution_plan", args, state), do: DevLeadTools.run(args, state)
  defp run_tool(name, _args, _state), do: {:error, "ferramenta desconhecida: #{name}"}

  # --- Kickoff ---

  defp kickoff_instruction(state) do
    case EngineApiClient.list_events(state.project_id, state.session_id) do
      {:ok, events} -> build_kickoff(events)
      _ -> "Proponha o plano de execução (propose_execution_plan)."
    end
  end

  defp build_kickoff(events) do
    modulos =
      events
      |> Enum.filter(&(Map.get(&1, "type") == "architecture.module_map_created"))
      |> List.last()
      |> case do
        %{"payload" => %{"modules" => mods}} when is_list(mods) ->
          Enum.map_join(mods, "\n", fn m ->
            "- #{Map.get(m, "name")} (#{Map.get(m, "stack", "?")}): #{Map.get(m, "responsibility", "")}"
          end)

        _ ->
          "(sem module_map)"
      end

    stories =
      events
      |> Enum.filter(&(Map.get(&1, "type") == "backlog.story_created"))
      |> Enum.map_join("\n", fn s ->
        p = Map.get(s, "payload", %{})
        "- story_id=#{Map.get(p, "storyId")} | #{Map.get(p, "title", "")}"
      end)

    """
    Você recebeu a arquitetura do Arquiteto. Avalie o trabalho e proponha o
    PLANO DE EXECUÇÃO com `propose_execution_plan`.

    Você NÃO escreve código. Decide quantos agentes valem a pena para o
    trabalho em mão, e responde por essa escolha.

    Um agente por módulo é o começo razoável. Peça mais de um SÓ quando o
    backlog daquele módulo justificar — mais agentes num módulo com duas
    histórias não acelera nada e custa o dobro. Acima do teto da área, o
    usuário precisa autorizar, então o `porque` de cada módulo é o que ele vai
    ler para decidir.

    MÓDULOS:
    #{modulos}

    HISTÓRIAS DO BACKLOG:
    #{stories}
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

  # O que o modelo lê no lugar da palavra "pending" quando a ação retoma
  # (ADR 0086, RN-284) — mesmo vocabulário de `Engine.Dev.DevAgentServer` e
  # `Engine.Gates.QaLeadServer`, para quem lê os três não aprender três
  # frases diferentes para o mesmo conceito.
  defp texto_do_desfecho(%{status: "executed", execution_result: %{} = exec}) do
    "exit #{Map.get(exec, "exitCode", "?")}\n#{Map.get(exec, "stdout", "")}"
  end

  # `propose_execution_plan` não tem execute-* pipeline — aprovação manual
  # fica em `"approved"` para sempre (ver o comentário equivalente em
  # `DevLeadTools.classificar/4`). Os três contam como sucesso.
  defp texto_do_desfecho(%{status: status})
       when status in ["executed", "auto_approved", "approved"],
       do: "plano aprovado e registrado."

  defp texto_do_desfecho(%{status: "failed", execution_result: %{} = exec}) do
    "falhou: #{Map.get(exec, "stderr", "")}#{Map.get(exec, "stdout", "")}"
  end

  # Recusa é RESPOSTA, não silêncio: o motivo entra no lugar do resultado,
  # para o modelo aprender que aquele plano não foi aceito e propor outro.
  defp texto_do_desfecho(%{status: "denied"} = desfecho) do
    motivo = Map.get(desfecho, :rejection_reason) || "sem motivo informado"
    "recusado pelo usuário: #{motivo}"
  end

  defp texto_do_desfecho(%{status: status}), do: "desfecho da ação: #{status}"

  # `model_name` viaja do frame `final` da api (achado do problema 2). Sem
  # default: o único call site aqui sempre passa os 3 argumentos.
  defp emit_response(state, content, model_name),
    do: emit(state, "agent.response", %{content: content, modelName: model_name})

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
  end

  # `agent.status` (o único evento que PRECISA ser persistido, não só
  # broadcastado — ver ADR 0021) passou a ser emitido por
  # `Engine.Agents.TurnoAssincrono`, que envolve o `handle_call`/`handle_cast`
  # de cada turno desde RN-122. O que sobra aqui é só o broadcast efêmero.
  defp broadcast(state, event, payload) do
    EngineWeb.Endpoint.broadcast("session:" <> state.session_id, event, payload)
  end
end
