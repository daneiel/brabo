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
  `proposed_action`. Desde o ADR 0190 (RN-671) o aceite do handoff semeia
  `container_start: auto_approve` para a Infra, e o SERVIDOR propõe a subida
  sozinho no kickoff quando há roteamento (`subir_no_aceite/2`) — a tool
  continua existindo para as conversas seguintes.

  Desde a RN-508 (ADR 0145) ganha uma SEGUNDA tool de subir container,
  `container_start_via_runner` — exclusiva de projeto `execution_mode:
  runner` (não elege candidata nenhuma; ver o moduledoc de
  `Engine.Infra.Tools.ProposeContainerStartViaRunner`).

  Desde a RN-566, as DUAS consultam LOCALMENTE (`Project.get/1` +
  `Engine.Runners.Registry.connected?/1`, sem HTTP — os dois rodam no mesmo
  processo BEAM do Infra Lead) o `execution_mode` do projeto ANTES de
  propor, recusando com motivo NOMEADO em vez de propor às cegas.
  `recusa_local_de_subida/2` lê o projeto UMA vez e cada tool tem a sua
  CLÁUSULA — a ramificação por DESTINO do ADR 0144/RN-503, a mesma que a
  página `/containers` aplica (RN-521): `container`/`mounted` pelo BROKER,
  `runner` pelo agente local. Desde a RN-610 elas também recusam por
  ESTADO, na ordem da tela: as duas quando o container já está REGISTRADO
  `running`/`provisioning`; `container_start_via_runner` também sem imagem
  decidida, com pasta nunca confirmada e sem runner conectado.
  `propose_container_start` NÃO recusa por imagem: eleger a imagem é o que
  ela faz (RN-491).

  Desde a RN-577, `propose_infra_pr` também recusa localmente, antes do HALT,
  quando o projeto não tem repositório (`recusa_de_infra_pr/4`) — o mesmo
  predicado que `ExecuteInfraPrUseCase` aplica na api, lido do mesmo Postgres.

  ## O sétimo conversacional (RN-617, ADR 0175)

  Desde a RN-617 ele também CONVERSA pelo composer: `message/2` do
  `EngineWeb.AgentCommandController` tem cláusula própria para `infra`, e a
  tela o oferece como destinatário quando ele é o agente ativado mais
  recentemente (RN-584 — sem destinatário padrão). Antes disso o turno dele
  inteiro rodava DENTRO do `handle_call`/`handle_cast`: o clique esperava o
  turno (180 s de teto), "Parar" nunca era atendido e o reinício no meio
  deixava o `working` preso. Agora os três turnos — kickoff, correção de gate
  e mensagem — sobem por `Engine.Agents.TurnoAssincrono`: o aceite sai com o
  `agent.status: working` já gravado, a segunda mensagem é 409
  `turno_em_andamento`, "Parar" mata a Task, o turno órfão fecha por
  `Engine.Agents.TurnoOrfao` e o histórico vem de `Engine.Agents.Reidratacao`.

  Conversar NÃO abre caminho novo de efeito externo: as ferramentas são as
  mesmas quatro, e tudo que tem efeito continua nascendo `proposed_action`
  (a PR de infra e as duas subidas de container, com as recusas locais das
  RN-566/RN-610/RN-577 intactas).

  ## O Dev Lead é oferecido pela Infra, com o container de pé (RN-672)

  Desde a AT-262 (ADR 0190) o handoff ao Dev Lead sai DAQUI, e não mais da
  confirmação de arquitetura do Arquiteto: no fim de cada turno (`concluir/1`)
  e quando o container do projeto chega em `running` fora de um turno
  (`{:container_running, project_id}`, por `Engine.Workers.InfraOfereceDevLeadWorker`
  a partir do `container.running` do outbox), o servidor pergunta se o
  container está REGISTRADO `running` e, só então, oferece `infra → dev-lead`
  no modo "só se ninguém recebeu ainda" (`create_handoff_if_absent/5`, ADR
  0182). É passo de servidor, não ferramenta: o modelo não decide quando o
  Dev Lead entra.

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

  ## A subida que se anuncia é a que o código fez (RN-668)

  O HALT de `propose_infra_pr` é o único ponto em que o código corta o laço
  com o modelo querendo continuar. Desde a RN-668 o lote inteiro da resposta
  é despachado ANTES dele (uma subida pedida na mesma resposta não some mais
  calada), e o fecho do turno (`fechar_subida/2`) diz no fio, com frase do
  SERVIDOR, quando a subida do container não foi proposta — em vez de a
  última palavra ser um "subo em paralelo" do modelo que nenhum `tool.call`
  cumpriu.

  ## A subida no aceite é passo do servidor (RN-671, ADR 0190)

  Desde a AT-260 o kickoff — o turno que nasce do handoff aceito — propõe
  `container_start` ANTES da primeira ida ao modelo, quando há roteamento
  vigente e o projeto sobe pelo broker (`container`/`mounted`): o servidor
  elege a candidata (`eleger_candidata/1`) e passa pelo MESMO
  `propor_container_start/2` da tool, com as recusas por modo e estado
  intactas. A proposta nasce auto-aprovada pela autonomia semeada no aceite.
  Com isso o fecho da RN-668 fica verdadeiro por construção no caso comum: a
  subida foi proposta, e ele não tem o que dizer. Ele segue falando quando a
  subida do servidor foi recusada (e nada a corrigiu) e quando ela não cabia
  ao servidor (sem roteamento, `runner`) e o modelo não a propôs.
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
  alias Engine.Projects.{Project, ProjectRepository}
  alias Engine.Containers.ProjectContainerLifecycle
  alias Engine.SessionEvents.Event
  # `as: RunnerRegistry`, nunca `Registry` puro: este módulo já usa o
  # `Registry` NATIVO do Elixir/OTP em `via/1` (`{:via, Registry, ...}`) — um
  # alias sem `as:` teria sombreado essa referência sem erro de compilação
  # nenhum, e `via/1` teria silenciosamente virado uma chamada errada.
  alias Engine.Runners.Registry, as: RunnerRegistry
  alias Engine.Harness.IdiomaDaResposta
  alias Engine.Sessions.EngineApiClient

  @agent "infra"

  alias Engine.Agents.{
    FalhaDeTurno,
    Reidratacao,
    ResultadoDeFerramenta,
    TurnoAssincrono,
    TurnoOrfao
  }

  # O teto de iterações do laço do Infra Lead — o de sempre dele, e o mesmo de
  # Arquiteto, Dev Lead, UX Designer e Staff (raciocínio, não conversa leve).
  # Continua valendo para os três turnos, a mensagem do composer inclusive.
  @max_iterations 14

  # --- API pública ---

  def start_link({session_id, project_id}) do
    GenServer.start_link(__MODULE__, {session_id, project_id}, name: via(session_id))
  end

  def via(session_id),
    do: {:via, Registry, {Engine.Sessions.Registry, "infra:" <> session_id}}

  def kickoff(session_id), do: GenServer.cast(via(session_id), :kickoff)

  # A mensagem do composer (RN-617, ADR 0175). O `handle_call` responde ao
  # ACEITAR (ADR 0163, RN-578) — o turno roda numa Task de `TurnoAssincrono` —,
  # então o teto do `GenServer.call` só cobre o aceite, nunca o turno. É o
  # mesmo número dos outros seis conversacionais, e deixou de competir com os
  # 225 s do `propose_action` de container (RN-605), que agora corre DENTRO da
  # Task, sem ninguém esperando síncrono.
  #
  # `idioma` é o idioma da resposta do AUTOR desta mensagem, resolvido pela api
  # (RN-622); `nil` = sem orientação neste turno.
  def user_message(session_id, text, idioma \\ nil),
    do: GenServer.call(via(session_id), {:user_message, text, idioma}, 180_000)

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

    # RN-586: o turno que o reinício do engine deixou pela metade fecha com
    # desfecho durável (nunca reexecuta). Até a RN-617 o Infra Lead ficava de
    # fora — o turno dele rodava no `handle_call`, sem o `working` gravado
    # antes do aceite; agora ele passa pelo MESMO `TurnoAssincrono` dos outros.
    _ = TurnoOrfao.fechar_ao_subir(project_id, session_id, @agent)

    # RN-672: o aviso de que o container do projeto subiu chega por PubSub
    # (cluster-wide — o job do outbox roda em QUALQUER réplica, e o Registry
    # da sessão é local ao nó; a mesma razão de `Engine.Dev.Wake`).
    Phoenix.PubSub.subscribe(Engine.PubSub, topico_do_container(project_id))

    history = Reidratacao.historico(project_id, session_id, @agent)

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
       ],
       # O turno em curso, numa Task supervisionada (RN-122, ADR 0163). Fora
       # do handler: é o que deixa um `:cancel` ("Parar") ser atendido no meio
       # do turno, e uma segunda mensagem ser RECUSADA com nome em vez de
       # esperar na fila do processo.
       turno_assincrono: nil,
       # Correção de gate (`{:correct, _}`) que chegou com um turno em curso:
       # guardada e rodada no fecho, na ordem de chegada. Antes da RN-617 o
       # turno bloqueava o processo e o cast esperava na caixa de mensagens;
       # sem esta fila o `TurnoAssincrono` a DESCARTARIA (sem `from`, com turno
       # em curso, ele só loga) — e o gate pediria mudança a ninguém.
       correcoes_pendentes: []
     }}
  end

  # Os três turnos — kickoff, correção de gate e mensagem do composer — rodam
  # pelo MESMO `TurnoAssincrono` (RN-617). O kickoff continua sendo um cast
  # disparado só no start FRESCO; o que mudou é ONDE ele roda: numa Task, e
  # por isso "Parar" o alcança e uma mensagem que chega no meio dele recebe
  # 409 `turno_em_andamento` em vez de esperar o turno inteiro na fila.
  @impl true
  def handle_cast(:kickoff, state) do
    TurnoAssincrono.iniciar(state, nil, fn ->
      # O contexto é lido UMA vez: é dele que sai o roteamento que a subida
      # pelo servidor elege (RN-671) e o texto do kickoff que o modelo lê.
      ctx = infra_context(state)
      {state, subida} = subir_no_aceite(state, ctx)

      state
      |> append(user_msg(kickoff_instruction(ctx, subida)))
      |> compact()
      |> run_turn(@max_iterations)
      |> concluir()
    end)
  end

  # Gate (QA/SecOps) reprovou (Fase 4a) — corrige na MESMA branch/PR:
  # instrui o modelo a ajustar os arquivos e chamar `propose_infra_pr` de
  # novo. `:correct` reroda a ÁREA INTEIRA (Lead + Workflows) — mesma
  # filosofia de "ciclo K no nível da área" do 8b: não tenta decidir qual
  # dos dois é "dono" do finding, e `ExecuteInfraPrUseCase` já recommita na
  # mesma PR quando o artefato de sessão já existe (idempotente).
  @impl true
  def handle_cast({:correct, findings}, %{turno_assincrono: %{}} = state) do
    {:noreply, Map.update(state, :correcoes_pendentes, [findings], &(&1 ++ [findings]))}
  end

  @impl true
  def handle_cast({:correct, findings}, state) do
    {:noreply, iniciar_correcao(state, findings)}
  end

  @impl true
  def handle_cast(:cancel, state) do
    {:noreply, state |> TurnoAssincrono.cancelar() |> drenar_correcao_pendente()}
  end

  # RN-581: a sessão fechou e `Engine.Agents.Conversacionais` está parando
  # este agente — o turno em curso morre junto, sem gravar nada.
  @impl true
  def terminate(_reason, state) do
    TurnoAssincrono.abandonar(state)
    :ok
  end

  # RN-622: o idioma do AUTOR vale para o turno que esta mensagem sobe, e só
  # para ele — `IdiomaDaResposta.com_idioma_do_autor/2` o põe no dicionário
  # durante o `handle_call` (a Task do turno o herda) e o tira ao sair.
  @impl true
  def handle_call({:user_message, text, idioma}, from, state) do
    IdiomaDaResposta.com_idioma_do_autor(idioma, fn ->
      handle_call({:user_message, text}, from, state)
    end)
  end

  @impl true
  def handle_call({:user_message, text}, from, state) do
    work = state |> append(user_msg(text)) |> compact()

    TurnoAssincrono.iniciar(state, from, fn ->
      work |> run_turn(@max_iterations) |> concluir()
    end)
  end

  # RN-672: o container do projeto chegou em `running` (o `container.running`
  # do outbox, entregue por `Engine.Workers.InfraOfereceDevLeadWorker`). Com
  # turno em curso não se faz nada aqui: o fecho dele (`concluir/1`) faz a
  # MESMA pergunta, lendo o registro, e oferecer dos dois lados só geraria a
  # segunda chamada que o modo `if_absent` responderia "já oferecido".
  @impl true
  def handle_info({:container_running, project_id}, %{project_id: project_id} = state) do
    case state.turno_assincrono do
      nil -> {:noreply, oferecer_ao_dev_lead(state)}
      _em_curso -> {:noreply, state}
    end
  end

  def handle_info({:container_running, _outro_projeto}, state), do: {:noreply, state}

  @impl true
  def handle_info(msg, state) do
    case TurnoAssincrono.tratar_resultado(msg, state) do
      # A fila vem do state ANTERIOR à mensagem: o `novo_state` é o que a Task
      # devolveu, e ela capturou o state do INÍCIO do turno — antes de a
      # correção chegar e entrar na fila.
      {:ok, novo_state} ->
        pendentes = Map.get(state, :correcoes_pendentes, [])

        {:noreply,
         novo_state
         |> Map.put(:correcoes_pendentes, pendentes)
         |> drenar_correcao_pendente()}

      :ignorado ->
        {:noreply, state}
    end
  end

  defp drenar_correcao_pendente(%{turno_assincrono: nil} = state) do
    case Map.get(state, :correcoes_pendentes, []) do
      [] ->
        state

      [findings | resto] ->
        state
        |> Map.put(:correcoes_pendentes, resto)
        |> iniciar_correcao(findings)
    end
  end

  defp drenar_correcao_pendente(state), do: state

  defp iniciar_correcao(state, findings) do
    instruction =
      user_msg(
        "O gate #{findings.gate} pediu mudanças: #{findings.reason}\n" <>
          "Detalhes: #{findings.diagnosis}\n" <>
          "Corrija os arquivos de infra que forem seus (Dockerfiles/compose) e chame " <>
          "`propose_infra_pr` de novo com os arquivos corrigidos (pode repetir o título). " <>
          "Se o achado for sobre o pipeline de CI, ainda assim chame `propose_infra_pr` com " <>
          "os seus arquivos — o Workflows é rerrodado junto e a correção dele entra na mesma PR."
      )

    {:noreply, novo_state} =
      TurnoAssincrono.iniciar(state, nil, fn ->
        state
        |> append(instruction)
        |> compact()
        |> run_turn(@max_iterations)
        |> concluir()
      end)

    novo_state
  end

  # --- Turno com loop bounded de tool use ---

  # `{:done, state}` — turno acabou sem propor (sem tool call, ou limite de
  # iterações). `{:proposed, title, files, state}` — o modelo chamou
  # `propose_infra_pr`; o turno HALTS aqui, sem consumir mais iterações.
  #
  # O teto (`@max_iterations`, 14) deixou de ser SILENCIOSO na RN-617, a mesma
  # correção da RN-166/RN-459 nos outros seis: esgotá-lo terminava o turno sem
  # evento nenhum, indistinguível de um turno que simplesmente acabou.
  defp run_turn(state, remaining) when remaining <= 0 do
    emit(state, "toolloop.limit_reached", %{
      iteration: @max_iterations,
      max_iterations: @max_iterations
    })

    {:done, state}
  end

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

  # O lote INTEIRO de uma resposta é despachado antes de qualquer HALT
  # (RN-668). Até ali, `propose_infra_pr` parava o `reduce_while` no meio do
  # lote: uma `propose_container_start` escrita DEPOIS dela, na mesma
  # resposta, era descartada sem `tool.call`, sem `tool.result` e sem aviso —
  # o modelo dizia "subo o container em paralelo", pedia as duas, e o código
  # executava uma. É a forma do Dev Lead (`propose_execution_plan`): o lote
  # roda todo, e só DEPOIS o sucesso encerra o turno.
  #
  # A PR aceita fica guardada e o HALT acontece no fim do lote; uma segunda
  # `propose_infra_pr` na MESMA resposta é recusada com motivo (a primeira é
  # a que consolida), nunca somada nem descartada calada.
  defp dispatch_calls(calls, state, remaining) do
    calls
    |> Enum.reduce({nil, state}, fn call, {pr, st} ->
      case Map.get(call, "name") do
        "propose_infra_pr" ->
          args = Map.get(call, "arguments", %{})
          title = Map.get(args, "title", "Dockerfiles e compose de dev")
          files = Map.get(args, "files", [])

          cond do
            pr != nil ->
              {pr, recusa_pr_repetida_no_lote(call, title, files, st)}

            st_recusado = recusa_de_infra_pr(call, title, files, st) ->
              {nil, st_recusado}

            true ->
              st =
                append(st, %{
                  "role" => "tool",
                  "content" =>
                    "arquivos recebidos, consolidando com o Workflows antes de propor.",
                  "toolCallId" => Map.get(call, "id"),
                  "name" => "propose_infra_pr",
                  :pinned => false
                })

              {{title, files}, st}
          end

        "propose_container_start" ->
          {pr, dispatch_container_start(call, st)}

        "container_start_via_runner" ->
          {pr, dispatch_container_start_via_runner(call, st)}

        _ ->
          {pr, dispatch_tool(call, st)}
      end
    end)
    |> case do
      {{title, files}, state} -> {:proposed, title, files, state}
      {nil, state} -> run_turn(state, remaining - 1)
    end
  end

  defp recusa_pr_repetida_no_lote(call, title, files, state) do
    caminhos = if is_list(files), do: for(%{"path" => path} <- files, do: path), else: []

    emit(state, "tool.call", %{
      tool: "propose_infra_pr",
      args: %{title: title, paths: caminhos}
    })

    registrar_resultado(
      state,
      Map.get(call, "id"),
      "propose_infra_pr",
      {:error,
       "`propose_infra_pr` já foi chamada nesta mesma resposta — só a primeira " <>
         "chamada é consolidada com o Workflows, e esta não foi proposta."}
    )
  end

  # `propose_infra_pr` sem repositório (RN-577) — `nil` quando o projeto TEM
  # repositório e o turno segue para o HALT de sempre; o `state` com a recusa
  # anexada como resultado de ferramenta quando não tem.
  #
  # A pergunta vem ANTES do HALT, e não em `abrir_pr/3`, de propósito: depois
  # do HALT o `finalize/3` já rodou o `WorkflowsAgent` (um laço de LLM inteiro,
  # pago) e registrou duas delegações `completed` para uma PR que não pode
  # existir. Recusar aqui não gasta nada, e o laço CONTINUA — o modelo lê o
  # motivo e segue o turno (RN-163), como nas recusas da RN-566.
  #
  # Rastro durável: `tool.call` ANTES da pergunta (o molde da RN-566) e
  # `tool.result` com `ok: false` e o motivo — sem ele o event log teria a
  # chamada mas não o porquê. O `tool.call` leva o título e os CAMINHOS, nunca
  # o conteúdo dos arquivos (que viaja inteiro no payload da proposta quando
  # ela existe). No caminho que propõe nada muda: a `proposed_action` continua
  # sendo o rastro dele, como sempre foi.
  defp recusa_de_infra_pr(call, title, files, state) do
    case ProjectRepository.recusa_de_pr_sem_repositorio(state.project_id, "open_infra_pr") do
      nil ->
        nil

      motivo ->
        caminhos = if is_list(files), do: for(%{"path" => path} <- files, do: path), else: []

        emit(state, "tool.call", %{
          tool: "propose_infra_pr",
          args: %{title: title, paths: caminhos}
        })

        emit(
          state,
          "tool.result",
          ResultadoDeFerramenta.payload("propose_infra_pr", {:error, motivo})
        )

        append(state, %{
          "role" => "tool",
          "content" => motivo,
          "toolCallId" => Map.get(call, "id"),
          "name" => "propose_infra_pr",
          :pinned => false
        })
    end
  end

  # `propose_container_start` NÃO halts como `propose_infra_pr` — é ação
  # independente (elege candidata do roteamento do Arquiteto, ADR 0131), sem
  # consolidação com o Workflows. Despacha inline, direto pra api, e deixa o
  # loop continuar. No kickoff a subida já é do servidor (RN-671); a tool fica
  # para a eleição que o modelo faz depois, numa conversa.
  #
  # Desde a RN-566 ela consulta LOCALMENTE o `execution_mode` ANTES de chamar
  # `propose_action` — a MESMA régua que a irmã `container_start_via_runner`
  # já aplicava (RN-508), e a MESMA ramificação por DESTINO que a página
  # `/containers` aplica em `acaoDeSubidaDoModo` (RN-521): não há segunda
  # régua, há duas cláusulas da mesma.
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

    resultado = propor_container_start(state, payload)

    state
    |> registrar_resultado(id, "propose_container_start", resultado)
    |> registrar_subida("propose_container_start", resultado)
  end

  # O caminho ÚNICO de `container_start` a partir do Infra Lead — a tool do
  # modelo (`dispatch_container_start/2`) e o passo do servidor no aceite
  # (`subir_no_aceite/2`, RN-671) passam por aqui: as MESMAS recusas locais
  # por modo e estado (RN-566/RN-610), a MESMA `propose_action` (a api decide
  # a autonomia, recusa sem broker — RN-591 — e elege a imagem pelo
  # `DecidirImagemDoProjetoUseCase`, RN-491). Não há segunda régua.
  #
  # O texto diz o status que a api devolveu, e só fala em "decisão do usuário"
  # quando ela ficou `pending`: desde o ADR 0190 a autonomia semeada no aceite
  # faz a proposta nascer auto-aprovada, e aí ela já executou (`executed`) ou
  # falhou (`failed`) quando a chamada volta.
  defp propor_container_start(state, payload) do
    case recusa_local_de_subida(:container_start, state.project_id) do
      nil ->
        actor = %{kind: "agent", id: @agent}

        case EngineApiClient.propose_action(
               state.project_id,
               state.session_id,
               "container_start",
               actor,
               payload
             ) do
          {:ok, %{"id" => _id, "status" => "pending"}} ->
            {:ok, "container_start proposto (status pending) — decisão final do usuário."}

          # `denied` é a política recusando (papel abaixo de `maintainer`,
          # `deny` em `permissions.json`): a proposta nasceu, mas nada vai
          # subir por ela — para o fecho da RN-668 é recusa, não proposta.
          {:ok, %{"id" => _id, "status" => "denied"} = acao} ->
            {:error,
             "container_start negado pela política (status denied)" <>
               motivo_da_negacao(acao)}

          {:ok, %{"id" => _id, "status" => status}} ->
            {:ok, "container_start proposto (status #{status})."}

          {:error, reason} ->
            {:error, "container_start recusado: #{motivo_da_recusa_da_api(reason)}"}
        end

      motivo ->
        {:error, motivo}
    end
  end

  defp motivo_da_negacao(%{"rejectionReason" => motivo}) when is_binary(motivo) and motivo != "",
    do: ": #{motivo}"

  defp motivo_da_negacao(_acao), do: "."

  # --- A subida pelo SERVIDOR no aceite do handoff (RN-671, ADR 0190) ---
  #
  # No uso real de 29/09 a Infra anunciou a subida "em paralelo" e não a
  # propôs; o container só subiu pela `/containers` (AT-260). Desde o ADR 0190
  # a subida deixa de depender do modelo: no kickoff — o turno que nasce do
  # handoff aceito —, ANTES da primeira ida ao modelo, o servidor elege uma
  # candidata do roteamento do Arquiteto e propõe `container_start` pelo
  # MESMO `propor_container_start/2` da tool. A proposta nasce auto-aprovada
  # pela autonomia que o aceite semeia (`container_start: auto_approve`,
  # `INFRA_AUTONOMY_SEEDS`), então a api a executa na mesma chamada.
  #
  # Só roda quando há roteamento VIGENTE (`roteado`, com ao menos uma
  # candidata) e o projeto é `container`/`mounted` — os dois modos que sobem
  # pelo broker. `runner` fica com o caminho de sempre
  # (`container_start_via_runner`, proposto pelo modelo e decidido por
  # humano): a decisão do dono não o mudou. Projeto que o engine não lê
  # também não ganha subida.
  #
  # O rastro é o de uma ferramenta — `tool.call` (com `origem: "servidor"`) e
  # `tool.result` duráveis —, mas NENHUMA mensagem `role: "tool"` entra no
  # histórico do modelo: não houve chamada dele a que ela respondesse, e uma
  # resposta de ferramenta sem a chamada é recusada pelos providers. O que o
  # modelo sabe da subida vem no TEXTO do kickoff (`passo_da_subida/1`).
  defp subir_no_aceite(state, {:ok, ctx}) do
    with %{"status" => "roteado", "roteamento" => rotas} when is_list(rotas) <-
           Map.get(ctx, "moduleRouting"),
         {imagem, modulos} <- eleger_candidata(rotas),
         %{execution_mode: modo} when modo in ~w(container mounted) <-
           Project.get(state.project_id) do
      payload = %{
        imagem: imagem,
        network: "none",
        resources: %{},
        rationale: rationale_do_servidor(modulos, length(rotas))
      }

      emit(state, "tool.call", %{
        tool: "propose_container_start",
        args: payload,
        origem: "servidor"
      })

      resultado = propor_container_start(state, payload)

      emit(
        state,
        "tool.result",
        ResultadoDeFerramenta.payload("propose_container_start", resultado)
      )

      {registrar_subida(state, "propose_container_start", resultado),
       {:servidor, imagem, resultado}}
    else
      _ -> {state, nil}
    end
  end

  defp subir_no_aceite(state, _sem_contexto), do: {state, nil}

  @doc """
  A eleição do servidor (RN-671): a candidata do MAIOR número de módulos, e no
  empate a que aparece PRIMEIRO no roteamento — determinística, sem modelo, e
  sempre uma das candidatas (a api recusa qualquer outra imagem). `nil` quando
  o roteamento não traz candidata nenhuma.
  """
  def eleger_candidata(rotas) do
    validas =
      for %{"imagemCandidata" => imagem} = rota <- rotas,
          is_binary(imagem) and imagem != "",
          do: {imagem, Map.get(rota, "modulo")}

    case validas do
      [] ->
        nil

      _ ->
        modulos_por_imagem = Enum.group_by(validas, &elem(&1, 0), &elem(&1, 1))

        imagem =
          validas
          |> Enum.map(&elem(&1, 0))
          |> Enum.uniq()
          |> Enum.max_by(&length(Map.fetch!(modulos_por_imagem, &1)))

        {imagem, Map.fetch!(modulos_por_imagem, imagem)}
    end
  end

  defp rationale_do_servidor(modulos, total) do
    nomes = Enum.map_join(modulos, ", ", &to_string/1)

    "Eleita pelo servidor no aceite do handoff da Infra (ADR 0190): a candidata " <>
      "do Arquiteto para #{length(modulos)} de #{total} módulo(s) (#{nomes}); no " <>
      "empate, a primeira do roteamento."
  end

  # A instalação sem broker (`BROKER_URL` vazia) não é legível localmente — o
  # engine não recebe essa variável, e uma segunda fonte para ela divergiria da
  # `ContainerBrokerPort.configurado()` da api (AT-105, RN-591). Quem recusa é a
  # api, ao propor, com 409 `sem_broker_na_instalacao`: a chamada que o laço já
  # fazia, sem HTTP a mais. Aqui só se devolve ao modelo o TEXTO da recusa, e
  # não o `inspect` da tupla crua.
  defp motivo_da_recusa_da_api({status, %{"message" => mensagem}})
       when is_integer(status) and is_binary(mensagem),
       do: mensagem

  defp motivo_da_recusa_da_api(reason), do: inspect(reason)

  # `container_start_via_runner` (RN-508, ADR 0145) — MESMO desenho de
  # `dispatch_container_start/2` (despacha inline, sem HALT), e desde a
  # RN-566 também a MESMA recusa local: as duas passam por
  # `recusa_local_de_subida/2`, que lê o projeto UMA vez e aplica a cláusula
  # de cada uma. O que era exclusividade desta tool (nascer sabendo negar)
  # virou régua das duas.
  #
  # O `emit` do `tool.call` acontece ANTES da recusa desde a RN-566, como no
  # `dispatch_tool/2` genérico deste mesmo módulo: recusa que não deixa
  # rastro no event log é a recusa virando silêncio para o humano — quem lê
  # o resultado dela é o modelo, e o timeline ficava sem saber que a chamada
  # existiu.
  defp dispatch_container_start_via_runner(call, state) do
    args = Map.get(call, "arguments", %{})
    id = Map.get(call, "id")
    rationale = Map.get(args, "rationale", "")

    emit(state, "tool.call", %{
      tool: "container_start_via_runner",
      args: %{rationale: rationale}
    })

    resultado =
      case recusa_local_de_subida(:container_start_via_runner, state.project_id) do
        nil ->
          actor = %{kind: "agent", id: @agent}

          case EngineApiClient.propose_action(
                 state.project_id,
                 state.session_id,
                 "container_start_via_runner",
                 actor,
                 %{rationale: rationale}
               ) do
            {:ok, %{"id" => _id, "status" => status}} ->
              {:ok,
               "container_start_via_runner proposto (status #{status}) — decisão final do usuário."}

            {:error, reason} ->
              {:error, "container_start_via_runner recusado: #{inspect(reason)}"}
          end

        motivo ->
          {:error, motivo}
      end

    state
    |> registrar_resultado(id, "container_start_via_runner", resultado)
    |> registrar_subida("container_start_via_runner", resultado)
  end

  # `nil` quando a tool PODE propor; mensagem NOMEADA quando não pode — a
  # mensagem é ENTRADA do laço (resultado de ferramenta que o modelo lê,
  # RN-163), nunca `agent.error` nem fim de turno.
  #
  # A leitura do projeto é UMA, comum às duas tools; o que diverge é a
  # CLÁUSULA de cada uma. Primeiro o MODO (`recusa_por_modo/2`, RN-566) — é
  # ele que diz qual das duas tools usar, e responder "falta imagem" a quem
  # chamou a tool errada apontaria a porta errada —, depois o ESTADO
  # (`recusa_por_estado/3`, RN-610), na MESMA ordem em que a página
  # `/containers` recusa em `decidirSubida`: já de pé, sem imagem, pasta
  # nunca confirmada. A régua de modo é a ramificação por DESTINO do ADR
  # 0144/RN-503 que a tela aplica em `acaoDeSubidaDoModo` (RN-521):
  # `container` e `mounted` sobem pelo BROKER (`container_start`), `runner`
  # sobe pelo agente local (`container_start_via_runner`).
  #
  # As leituras são locais — `Project.get/1` (mesmo padrão de
  # `Engine.Actions.TerminalExecutor`), `ProjectContainerLifecycle` e
  # `Event.imagem_decidida?/1` (o mesmo Postgres, direto, como a RN-577 faz
  # com `project_repositories`) e `RunnerRegistry.connected?/1` (`:global`,
  # alcança runner conectado em QUALQUER nó do cluster) — e nenhuma bate na
  # api: um HTTP aqui poria uma chamada de rede dentro do laço do agente. Cada
  # cláusula é uma função avaliada SÓ se a anterior passou: a primeira recusa
  # encerra, e as leituras seguintes nem acontecem.
  #
  # O que NENHUMA cláusula checa, e por quê: broker ausente na instalação (o
  # engine não lê `BROKER_URL`; quem recusa é a api, ao propor, com 409
  # `sem_broker_na_instalacao`, RN-591), e papel/sessão (o agente não é quem
  # clica; a sessão é a dele).
  defp recusa_local_de_subida(tool, project_id) do
    case Project.get(project_id) do
      nil ->
        "projeto não encontrado."

      projeto ->
        recusa_por_modo(tool, projeto.execution_mode) ||
          recusa_por_estado(tool, projeto, project_id)
    end
  end

  # `propose_container_start` — o caminho do BROKER. Lista de PERMITIDOS,
  # como a do próprio broker: modo novo no enum nasce RECUSADO com mensagem,
  # nunca proposto por omissão.
  defp recusa_por_modo(:container_start, modo) when modo in ~w(container mounted), do: nil

  defp recusa_por_modo(:container_start, "runner"),
    do:
      "projeto no modo `runner` — o broker nunca alcança a pasta dele (ela " <>
        "mora na máquina do usuário), e o payload desta tool elege uma " <>
        "candidata do roteamento do Arquiteto, que não existe nesse modo. " <>
        "Use `container_start_via_runner`, não esta tool."

  defp recusa_por_modo(:container_start, outro),
    do:
      "projeto no modo `#{outro}` — `propose_container_start` sobe pelo " <>
        "BROKER, que atende só `container` e `mounted` (ADR 0144)."

  # `container_start_via_runner` — o caminho do AGENTE LOCAL (RN-508).
  defp recusa_por_modo(:container_start_via_runner, "runner"), do: nil

  defp recusa_por_modo(:container_start_via_runner, "mounted"),
    do:
      "projeto no modo `mounted` — desde a RN-503 ele sobe pelo BROKER, " <>
        "como `container`. Use `propose_container_start`, não esta tool."

  defp recusa_por_modo(:container_start_via_runner, outro),
    do:
      "projeto no modo `#{outro}` — container_start_via_runner é exclusiva " <>
        "de `runner`. Use `propose_container_start` (o broker)."

  # As cláusulas de ESTADO de cada tool (RN-610), na ordem da `/containers`.
  #
  # `propose_container_start` tem UMA, de propósito: NÃO checa imagem
  # decidida. A eleição de imagem é justamente o que esta proposta FAZ (ADR
  # 0131/RN-491), então exigi-la antes inverteria a ordem — a tela checa
  # imagem para os dois modos porque o botão dela não elege nada.
  #
  # `container_start_via_runner` tem QUATRO: ela sobe a imagem JÁ decidida e
  # não elege nenhuma (`ExecuteContainerStartViaRunnerUseCase` falha sem
  # ela), precisa de uma pasta que um runner já confirmou, e de um runner
  # conectado AGORA — a metade que só o engine sabe, e a tela não (ela só
  # ressalva `runner_pode_estar_desconectado`).
  defp recusa_por_estado(:container_start, _projeto, project_id) do
    recusa_ja_de_pe("propose_container_start", project_id)
  end

  defp recusa_por_estado(:container_start_via_runner, projeto, project_id) do
    tool = "container_start_via_runner"

    [
      fn -> recusa_ja_de_pe(tool, project_id) end,
      fn -> recusa_sem_imagem_decidida(project_id) end,
      fn -> recusa_pasta_nunca_confirmada(projeto, project_id) end,
      fn -> recusa_runner_desconectado(project_id) end
    ]
    |> Enum.find_value(& &1.())
  end

  # `ja_esta_de_pe` da `/containers`. A execução não FALHARIA aqui
  # (`SubirCicloDeVidaDoContainerUseCase` é idempotente sobre
  # `provisioning`/`running`), mas a proposta gastaria uma decisão humana num
  # nada — e em `container`/`mounted` pior que nada: elegeria uma imagem nova
  # (nova versão de `artifact.project_image`) que o container de pé, com a
  # versão CONGELADA na linha (RN-245), não usaria. Registrado não é
  # observado (RN-486): o texto diz o que fazer quando o container morreu por
  # fora, em vez de afirmar que ele está vivo.
  defp recusa_ja_de_pe(tool, project_id) do
    case ProjectContainerLifecycle.status_registrado(project_id) do
      status when status in ~w(running provisioning) ->
        "o container deste projeto já está REGISTRADO como `#{status}` — " <>
          "subir não é a próxima ação, e `#{tool}` não foi proposta. O " <>
          "registro não é observação (RN-486): se o container morreu por " <>
          "fora, ou se a imagem precisa mudar, diga ao usuário que parar ou " <>
          "remover é pela página `/containers`; só depois disso uma nova " <>
          "subida faz sentido. Não repita a chamada agora."

      _ ->
        nil
    end
  end

  # `sem_imagem_decidida` da `/containers` — só para `runner`, pelo motivo
  # escrito acima de `recusa_por_estado/3`. O predicado é o da api
  # (`Event.imagem_decidida?/1`).
  defp recusa_sem_imagem_decidida(project_id) do
    if Event.imagem_decidida?(project_id) do
      nil
    else
      "nenhuma imagem de container foi decidida para este projeto " <>
        "(`artifact.project_image`, RN-105) — `container_start_via_runner` " <>
        "sobe a imagem JÁ decidida e não elege nenhuma, então aprovada ela " <>
        "só poderia falhar, e não foi proposta. Quem decide a imagem é o " <>
        "Arquiteto (`choose_project_image`): diga isso ao usuário e não " <>
        "repita a chamada até haver decisão."
    end
  end

  # `runner_nunca_confirmou` da `/containers`: `workspace_verified_at` nulo
  # quer dizer que nenhum agente local jamais confirmou a pasta (RN-423).
  # Carimbo não é batimento (RN-468) — por isso esta cláusula não substitui a
  # seguinte, que pergunta pelo AGORA.
  defp recusa_pasta_nunca_confirmada(%{workspace_verified_at: nil}, project_id),
    do:
      "a pasta deste projeto nunca foi confirmada por um agente local " <>
        "(`workspace_verified_at` vazio, RN-423) — nenhum `brabo-runner` " <>
        "jamais conectou a ele, e `container_start_via_runner` não foi " <>
        "proposta. Peça ao usuário para rodar `brabo-runner --project " <>
        "#{project_id} --dir <pasta>` na máquina dele: a confirmação " <>
        "acontece quando o runner conecta."

  defp recusa_pasta_nunca_confirmada(_projeto, _project_id), do: nil

  defp recusa_runner_desconectado(project_id) do
    if RunnerRegistry.connected?(project_id) do
      nil
    else
      "nenhum runner está conectado a este projeto agora — peça ao " <>
        "usuário para rodar `brabo-runner --project #{project_id} --dir " <>
        "<pasta>` na máquina dele antes de propor de novo."
    end
  end

  defp dispatch_tool(call, state) do
    name = Map.get(call, "name")
    args = Map.get(call, "arguments", %{})
    id = Map.get(call, "id")

    emit(state, "tool.call", %{tool: name, args: args})

    registrar_resultado(state, id, name, run_tool(name, args, state))
  end

  # O desfecho de uma ferramenta despachada inline, nos DOIS lugares de
  # sempre (RN-593): o `tool.result` durável, montado pelo MESMO módulo dos
  # seis conversacionais (RN-589) — antes o Infra Lead só gravava o de recusa
  # de `propose_infra_pr`, com payload próprio, e o reidratado lia "o log não
  # registra o desfecho" sobre toda chamada de `validate_infra_file` e de
  # subida de container —, e a mensagem `role: "tool"` que o modelo lê.
  #
  # `propose_infra_pr` ACEITA não passa por aqui, de propósito: ela não emite
  # `tool.call` (o rastro dela é a `proposed_action`, RN-577), e um
  # `tool.result` sem chamada viraria nota órfã na reidratação.
  defp registrar_resultado(state, id, name, {_sentido, texto} = resultado) do
    emit(state, "tool.result", ResultadoDeFerramenta.payload(name, resultado))

    append(state, %{
      "role" => "tool",
      "content" => texto,
      "toolCallId" => id,
      "name" => name,
      :pinned => false
    })
  end

  defp run_tool("validate_infra_file", args, state), do: ValidateInfraFile.run(args, state)
  defp run_tool(name, _args, _state), do: {:error, "ferramenta desconhecida: #{name}"}

  # --- Conclusão do turno: consolida com o Workflows e propõe (ou bloqueia) ---

  # O fim do turno, DENTRO da Task: consolida com o Workflows e propõe (ou
  # bloqueia) e devolve o `state` — o contrato de `TurnoAssincrono`. Os sinais
  # de fim (`agent.done` no canal, `agent.status: idle` no log) NÃO saem daqui:
  # quem os emite é `TurnoAssincrono.finalizar/1`, no processo do servidor,
  # depois de o turno sair do state (RN-585). O desfecho de bloqueio fica
  # visível pelo `dev.error` que `aplicar/2` emite.
  defp concluir({:proposed, title, files, state}) do
    {_status, state} = finalize(state, title, files)

    state
    |> fechar_subida(:pr_encerrou_o_turno)
    |> oferecer_ao_dev_lead()
  end

  defp concluir({:done, state}) do
    state
    |> fechar_subida(:turno_terminou)
    |> oferecer_ao_dev_lead()
  end

  # --- O handoff ao Dev Lead sai da Infra (RN-672, ADR 0190) ---

  @doc "Tópico em que o aviso de container `running` do projeto chega (RN-672)."
  def topico_do_container(project_id), do: "infra:container_running:" <> project_id

  # Só com o container REGISTRADO `running` (a decisão do dono): é ele que os
  # dev agents exigem para trabalhar (RN-502), e oferecer o Dev Lead antes
  # deixava aceitável uma execução sem onde rodar. A leitura é a mesma de
  # `container_registrado_de_pe?/1`, local e sem HTTP — só que `running`, e
  # não `provisioning`.
  #
  # `create_handoff_if_absent/5` (ADR 0182, RN-636): oferta pendente ao Dev Lead
  # em qualquer sessão do projeto volta como está, e Dev Lead já ATIVO é 409
  # `agente_ja_ativo` — nenhuma das duas é falha, e é isso que deixa este passo
  # rodar no fim de TODO turno sem empilhar ofertas. Outra recusa vira
  # `agent.error` durável com origem (RN-116), sem derrubar o turno.
  defp oferecer_ao_dev_lead(state) do
    if ProjectContainerLifecycle.status_registrado(state.project_id) == "running" do
      case EngineApiClient.create_handoff_if_absent(
             state.project_id,
             state.session_id,
             @agent,
             "dev-lead",
             nil
           ) do
        {:ok, _handoff} -> state
        {:error, {409, %{"reason" => "agente_ja_ativo"}}} -> state
        {:error, reason} -> emit_falha_do_handoff_ao_dev_lead(state, reason)
      end
    else
      state
    end
  end

  defp emit_falha_do_handoff_ao_dev_lead(state, reason) do
    origem = FalhaDeTurno.origem(reason)

    mensagem =
      "O container do projeto está de pé, mas não consegui oferecer o handoff " <>
        "ao dev-lead: #{inspect(reason)}. O fim de cada turno meu tenta de " <>
        "novo — me mande uma mensagem para eu repetir a oferta."

    emit(state, "agent.error", %{origem: origem, mensagem: mensagem, reason: inspect(reason)})
    broadcast(state, "agent.error", %{origem: origem, mensagem: mensagem})
    state
  end

  # --- O que o turno fez com a subida do container (RN-668) ---
  #
  # A RN-163 na Infra: o que o turno ANUNCIA sobre a subida é decidido aqui,
  # pelo código, depois de o laço acabar — sabendo se alguma proposta de
  # subida foi ACEITA pela api neste turno —, e não pelo texto que o modelo
  # escreveu (be70 seq 282: "subo o container em paralelo", sem `tool.call`
  # de subida depois). O modelo pode prometer o que quiser; a última palavra
  # do fio é do servidor, na forma do desfecho consolidado do Criativo
  # (`encerrar/2`), e só quando o que foi feito contradiz o que podia ter sido
  # prometido:
  #
  # - `:pr_encerrou_o_turno` — `propose_infra_pr` encerra o turno sem nova ida
  #   ao modelo. É o ÚNICO ponto em que o CÓDIGO corta o laço com o modelo
  #   querendo continuar, e é onde a promessa "em paralelo" morre. Se nenhuma
  #   subida foi proposta e o container não está REGISTRADO de pé, o fio diz.
  # - `:turno_terminou` — o modelo parou sozinho. Só se fala da subida se ela
  #   foi TENTADA e recusada sem nenhuma proposta aceita depois: aí o turno
  #   mexeu na subida e ela não aconteceu. Turno que nunca tocou na subida
  #   (uma pergunta, uma correção de gate) não ganha frase nenhuma.
  #
  # Nada disto sobe container nem propõe nada: quem propõe é a tool do modelo
  # ou, no kickoff, o passo do servidor (`subir_no_aceite/2`, RN-671), e os
  # dois marcam `:subida_do_turno` pelo mesmo `registrar_subida/3`. O campo
  # vive só dentro da Task do turno e sai do `state` aqui.
  defp registrar_subida(state, _tool, {:ok, _texto}),
    do: Map.put(state, :subida_do_turno, :proposta)

  defp registrar_subida(%{subida_do_turno: :proposta} = state, _tool, {:error, _}), do: state

  defp registrar_subida(state, tool, {:error, _texto}),
    do: Map.put(state, :subida_do_turno, {:recusada, tool})

  defp fechar_subida(state, como) do
    subida = Map.get(state, :subida_do_turno)

    with false <- subida == :proposta,
         frase when is_binary(frase) <- desfecho_da_subida(subida, como),
         false <- container_registrado_de_pe?(state.project_id) do
      emit_response(state, frase)
    end

    Map.delete(state, :subida_do_turno)
  end

  # O container já REGISTRADO de pé não deve subida nenhuma: dizer "nada vai
  # subir" sobre ele seria o fio afirmando o que não leu. A leitura é a mesma
  # de `recusa_ja_de_pe/2`, local e sem HTTP.
  defp container_registrado_de_pe?(project_id),
    do: ProjectContainerLifecycle.status_registrado(project_id) in ~w(running provisioning)

  defp desfecho_da_subida({:recusada, tool}, _como),
    do:
      "Fechando o turno: a subida do container NÃO foi proposta nele — a " <>
        "tentativa por `#{tool}` foi recusada, com o motivo no resultado da " <>
        "ferramenta. Nenhum container vai subir sem uma proposta aprovada: " <>
        "peça de novo numa próxima mensagem ou use a página Containers."

  defp desfecho_da_subida(nil, :pr_encerrou_o_turno),
    do:
      "Fechando o turno: propor a PR de infra encerra o meu turno, e nele a " <>
        "subida do container NÃO foi proposta. Nenhum container vai subir " <>
        "sem uma proposta aprovada: peça a subida numa próxima mensagem ou " <>
        "use a página Containers."

  defp desfecho_da_subida(nil, :turno_terminou), do: nil

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

  defp infra_context(state),
    do: EngineApiClient.get_infra_context(state.project_id, state.session_id)

  defp kickoff_instruction({:ok, ctx}, subida), do: build_kickoff(ctx, subida)

  defp kickoff_instruction(_sem_contexto, _subida),
    do: "Proponha os artefatos de infra (Dockerfiles, compose de dev)."

  # Os passos 4 e 5 do kickoff — o que o modelo precisa saber da subida. Com
  # a subida feita pelo SERVIDOR (RN-671), o texto diz o que JÁ aconteceu, e
  # não pede ao modelo uma eleição que o código já fez; sem ela (sem
  # roteamento, projeto `runner`), os passos de sempre.
  defp passo_da_subida({:servidor, imagem, {:ok, texto}}) do
    """
    4. A subida do container JÁ foi proposta pelo SERVIDOR neste aceite, sem
       esperar por você: ele elegeu `#{imagem}` entre as candidatas do
       roteamento abaixo. Resultado: #{texto} Não chame `propose_container_start`
       de novo neste turno. Se o status for `failed`, diga isso ao usuário com
       o que você sabe — nunca diga que o container está de pé sem saber.
    """
  end

  defp passo_da_subida({:servidor, imagem, {:error, motivo}}) do
    """
    4. O SERVIDOR tentou propor a subida do container neste aceite, elegendo
       `#{imagem}`, e ela foi RECUSADA: #{motivo}
       Se outra candidata do roteamento resolver o motivo, chame
       `propose_container_start` com ela; senão, diga o motivo ao usuário e
       não prometa subida nenhuma.
    """
  end

  defp passo_da_subida(_sem_subida_do_servidor) do
    """
    4. Se houver roteamento de módulos abaixo, ELEJA uma das imagens candidatas
       para o container do projeto e chame `propose_container_start` (imagem +
       network + resources + rationale dizendo por que ESTA candidata, nunca
       inventando uma imagem fora da lista). Sem roteamento vigente, pule-o; o
       container do projeto segue como está.
    5. Se o projeto estiver no modo `runner` (código na máquina do usuário, sem
       bind-mount pro servidor), `propose_container_start` não serve — chame
       `container_start_via_runner` (só `rationale` opcional, sem eleger nada:
       sobe a imagem já decidida). Se você não souber o modo, tente
       `container_start_via_runner`; a recusa nomeada diz qual dos dois usar.
    """
  end

  defp build_kickoff(ctx, subida) do
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
    #{String.trim_trailing(passo_da_subida(subida))}
    6. Por último, chame `propose_infra_pr` (title + files) com o que é seu — a
       consolidação com o pipeline de CI acontece depois, automaticamente.
       `propose_infra_pr` ENCERRA o seu turno: uma subida do container que
       caiba a você só acontece se for chamada ANTES dela ou na MESMA resposta. Não
       diga que vai subir o container "depois" ou "em paralelo" sem chamar a
       ferramenta — o que não foi chamado não acontece.

    Você NUNCA aplica nada em ambiente — só propõe. Sem acesso a terminal.

    MÓDULOS:
    #{modules_text}

    ADRs DE INFRA:
    #{adrs_text}

    ROTEAMENTO DE MÓDULOS (candidatas do Arquiteto — você ELEGE):
    #{routing_text}
    """
  end

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

    # O `event.appended` sai da fachada, com a escrita confirmada (RN-579).
    :ok
  end

  # O `agent.status` (persistido, ADR 0021) saiu daqui na RN-617: quem o
  # grava é `TurnoAssincrono`, no aceite (`working`) e no fecho (`idle`).
  defp broadcast(state, event, payload) do
    EngineWeb.Endpoint.broadcast("session:" <> state.session_id, event, payload)
  end
end
