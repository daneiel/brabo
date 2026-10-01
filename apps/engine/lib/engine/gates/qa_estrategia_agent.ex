defmodule Engine.Gates.QaEstrategiaAgent do
  @moduledoc """
  QA-estratégia — segundo MOMENTO do `qa-lead` (ADR 0090; `docs/fluxo.yml`,
  papel `qa-estrategia`): o mesmo processo, um entregável SEPARADO do
  veredito de PR — o PLANO DE TESTE da entrega de um dev agent.

  ## Desde o ADR 0192 (RN-674), DEPOIS da entrega, não no design

  O ADR 0090 pôs este agente PRE-DEV, disparado pelo `assess_implementability`
  do Dev Lead, com contexto de story + `module_map` e o worktree inexistente.
  O uso real de 29/09 mostrou o preço: duas rodadas de
  `toolloop.limit_reached` 8/8 sem `emit_plano_de_teste`, o laço gasto lendo
  docs, RAG vazio e pastas até concluir "o código ainda não existe". A
  decisão do dono (01/10) foi a saída (b): o plano nasce do CÓDIGO ENTREGUE.

  Quem chama agora é `Engine.Gates.QaLeadServer`, no começo do ciclo de
  revisão (`run/2`, gate `qa-verificada`), ANTES das subespecialidades, com o
  MESMO `dev_state`/`dev_context` que elas recebem: o `workspace_root` é o
  worktree do dev, as regras de negócio entram pelas mesmas unidades, e a
  lista de arquivos que a entrega tocou (`git diff dev...HEAD`, calculada pelo
  Lead com `Engine.Gates.Diff`) vai na primeira mensagem — é ela que aponta
  as 8 iterações para o que existe, em vez de uma busca às cegas.

  Módulo SEM ESTADO — não é `GenServer` —, mesma FORMA de
  `Engine.Gates.QaPerformanceSegurancaAgent`: registro de ferramentas SEM
  `Terminal` (raciocínio de LEITURA, nunca escrita), rodando o `ToolLoop`
  genérico do harness.

  ## Por que nunca suspende

  O registro (`ReadFile`, `SearchWorkspace`, `EmitPlanoDeTeste`) não tem
  `terminal` nem `write_file` — as DUAS únicas tools que
  `Engine.Harness.Hooks.ActionPipeline` intercepta para criar
  `proposed_action`. Nenhuma chamada deste agente passa pelo pipeline de
  ações, então o `ToolLoop` dele nunca produz `:pending`, e o Lead o roda
  síncrono, sem mecanismo de suspensão/retomada.

  ## O teto de iterações CONTINUA em 8, e agora há orçamento por baixo

  `"qa-estrategia"` NÃO ganhou cláusula própria em `Iteracoes.tipo/1` e cai no
  default (`:conversacional`, teto 8) — o ADR 0192 não sobe o teto para o
  plano passar: o que mudou foi o INSUMO (o código existe e a lista de
  arquivos tocados vem pronta), não a folga. O que mudou do lado do gasto é
  que existe task agora, então o agente passa a rodar sob o MESMO
  `task_budget_micros` que as duas subespecialidades compartilham (RN-036) —
  contenção que o ADR 0090 não tinha como dar.
  """

  alias Engine.Gates.Tools.EmitPlanoDeTeste
  alias Engine.Harness.Hooks.{ActionPipeline, EventLog}
  alias Engine.Gates.Hooks.TerminationPlanoDeTeste
  alias Engine.Harness.Tools.{ReadFile, SearchWorkspace, RagSearch, RagFeedback}
  alias Engine.Harness.{ArtifactEmitter, Hooks, ToolLoop}
  alias Engine.Sessions.EngineApiClient

  # RagSearch entrou aqui (frente rag_search): o prompt já pede "padrões de
  # teste do projeto" — é exatamente o que docs/ADRs indexados no RAG
  # respondem melhor do que vasculhar o worktree às cegas.
  # RagFeedback anda junto de RagSearch (RN-480): buscar sem poder dizer se o
  # trecho serviu deixa a calibração dos pesos sem sinal de verdade nenhum.
  # `:direct` como a busca — votar não é efeito externo.
  @registry [ReadFile, SearchWorkspace, RagSearch, RagFeedback, EmitPlanoDeTeste]

  @doc "Registro de ferramentas — sem Terminal, de propósito (ver moduledoc)."
  def tools, do: @registry

  @doc """
  Roda a QA-estratégia sobre a ENTREGA da task `task_id`: `dev_state` e
  `dev_context` são os mesmos que o `QaLeadServer` passa às subespecialidades
  (`Engine.Dev.ContextBuilder.fetch/3`), e `arquivos_alterados` é
  `{:ok, [caminho]}` ou `{:error, motivo}` — o Lead calcula, este módulo só
  descreve. Em sucesso, EMITE `artifact.plano_de_teste` (com `storyId` e
  `taskId`) no event log de `session_id` e devolve `{:ok, plano}`; em falha,
  emite `agent.error` (durável, com origem — RN-059) e devolve
  `{:error, motivo}`.
  """
  @spec run(
          String.t(),
          String.t(),
          String.t(),
          map(),
          map(),
          {:ok, [String.t()]} | {:error, term()}
        ) ::
          {:ok, map()} | {:error, String.t()}
  def run(project_id, session_id, task_id, dev_state, dev_context, arquivos_alterados) do
    project_id
    |> build_ctx(session_id, dev_state, dev_context, arquivos_alterados)
    |> ToolLoop.run()
    |> handle_outcome(project_id, session_id, task_id, dev_context.story)
  end

  defp build_ctx(project_id, session_id, dev_state, dev_context, arquivos_alterados) do
    %{
      project_id: project_id,
      session_id: session_id,
      agent: "qa-estrategia",
      # O worktree do dev — é ali que a entrega mora (ADR 0192).
      workspace_root: dev_state.worktree_path,
      tools: @registry,
      hooks: hooks(),
      # O MESMO pool das subespecialidades (RN-036): o plano é trabalho da
      # área de QA sobre esta task. O teto de iterações NÃO muda (moduledoc).
      token_budget_micros: Map.get(dev_state, :task_budget_micros),
      business_rules_units: Map.get(dev_context, :business_rules_units, []),
      task_state_units: Map.get(dev_context, :task_state_units, []),
      messages: [initial_message(dev_context.task, dev_context.story, arquivos_alterados)],
      context_window: 128_000
    }
  end

  defp hooks do
    Hooks.new()
    |> Hooks.register(:pre_tool_use, ActionPipeline)
    |> Hooks.register(:post_tool_use, EventLog)
    |> Hooks.register(:post_tool_use, TerminationPlanoDeTeste)
  end

  defp initial_message(task, story, arquivos_alterados) do
    %{
      "role" => "user",
      "content" => """
      Você é a QA-estratégia (docs/fluxo.yml, segundo momento do qa-lead):
      o dev agent ENTREGOU a task "#{Map.get(task, "title", "")}" e você
      escreve o PLANO DE TESTE dessa entrega, a partir do código que existe
      no worktree. Você NÃO escreve código nem roda testes — só lê e registra
      o plano, que a revisão de QA usa logo em seguida.

      STORY: #{Map.get(story, "title", "")}
      #{Map.get(story, "description", "")}

      Requisitos funcionais:
      #{lista(Map.get(story, "rf", []))}

      Requisitos não funcionais:
      #{lista(Map.get(story, "rnf", []))}

      Definition of done:
      #{lista(Map.get(story, "dod", []))}

      ARQUIVOS que a entrega tocou (git diff contra `dev`):
      #{descrever_arquivos(arquivos_alterados)}

      Leia com `read_file` os arquivos acima que importam para a story (e os
      testes que já existem ao lado deles) — comece por eles, não vasculhe o
      repositório. Então chame `emit_plano_de_teste` com:
      - `planoDeTeste`: síntese do que precisa ser verificado NESTA entrega;
      - `criteriosExecutaveis`: os critérios de aceite reescritos de forma
        VERIFICÁVEL contra o código entregue (ex.: "dado X, quando Y, então
        Z" em vez de prosa vaga);
      - `estrategiaDeAutomacao`: GENÉRICA e curta — que NÍVEL de teste
        (unidade/integração/e2e) e ONDE, sem escolher framework específico.

      Você tem poucas iterações: duas ou três leituras e então
      `emit_plano_de_teste`. Responda SEMPRE chamando uma ferramenta.
      """,
      :pinned => true
    }
  end

  # Os arquivos são o que torna o teto de 8 suficiente (ADR 0192) — mas um
  # diff que falhou não derruba o plano: o agente segue com a story e o
  # worktree, e o texto diz POR QUE a lista não veio, nunca uma lista vazia
  # que pareceria "a entrega não tocou nada".
  @teto_de_arquivos 40

  defp descrever_arquivos({:ok, []}), do: "(o diff contra `dev` veio vazio)"

  defp descrever_arquivos({:ok, arquivos}) do
    {mostrados, resto} = Enum.split(arquivos, @teto_de_arquivos)
    linhas = Enum.map_join(mostrados, "\n", &("- " <> &1))

    case resto do
      [] -> linhas
      _ -> linhas <> "\n(e mais #{length(resto)} de #{length(arquivos)} no total)"
    end
  end

  defp descrever_arquivos({:error, motivo}),
    do: "(não consegui listar: #{inspect(motivo)} — leia o worktree a partir da story)"

  defp lista([]), do: "(nenhum declarado)"
  defp lista(itens), do: Enum.map_join(itens, "\n", &("- " <> to_string(&1)))

  defp handle_outcome(
         {:halted, {"emit_plano_de_teste", plano}, _ctx},
         project_id,
         session_id,
         task_id,
         story
       ) do
    # `ArtifactEmitter.emit/5`, não `append_event/3` cru: valida contra o
    # schema registrado em `Engine.Harness.ArtifactSchemas` (mesmo caminho de
    # `qa_verdict`/`task_blocked`) — payload inválido vira `qa-estrategia.error`
    # em vez de gravar um artefato que ninguém sabe ler.
    ArtifactEmitter.emit(project_id, session_id, "qa-estrategia", "plano_de_teste", %{
      storyId: Map.get(story, "id"),
      # ADR 0192: o plano é da ENTREGA — é por `taskId` que o `QaLeadServer`
      # o reencontra na rodada de correção seguinte em vez de pagar outro.
      taskId: task_id,
      planoDeTeste: plano.plano_de_teste,
      criteriosExecutaveis: plano.criterios_executaveis,
      estrategiaDeAutomacao: plano.estrategia_de_automacao
    })

    {:ok, plano}
  end

  defp handle_outcome(outcome, project_id, session_id, _task_id, story) do
    {origem, motivo} = falha(outcome)
    emit_falha(project_id, session_id, story, origem, motivo)
    {:error, motivo}
  end

  defp falha({:limit_reached, _ctx}),
    do: {"modelo", "limite de iterações atingido sem emit_plano_de_teste"}

  defp falha({:budget_exceeded, _ctx}),
    do: {"politica", "orçamento de tokens esgotado na avaliação"}

  defp falha({:ok, ctx}), do: diagnostico_de_parada(ctx)

  defp falha(other), do: {"infra", "desfecho inesperado do ToolLoop: #{inspect(other)}"}

  defp diagnostico_de_parada(ctx) do
    case Map.get(ctx, :last_error) do
      nil -> {"modelo", "o modelo parou sem chamar emit_plano_de_teste"}
      error -> {"infra", "falha no turno de LLM: #{inspect(error)}"}
    end
  end

  defp emit_falha(project_id, session_id, story, origem, motivo) do
    EngineApiClient.append_event(project_id, session_id, %{
      type: "agent.error",
      actorKind: "agent",
      actorId: "qa-estrategia",
      payload: %{
        origem: origem,
        mensagem:
          "não consegui montar o plano de teste da story \"#{Map.get(story, "title", "")}\": " <>
            motivo,
        reason: motivo
      }
    })
  end
end
