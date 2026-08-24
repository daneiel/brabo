defmodule Engine.Gates.QaEstrategiaAgent do
  @moduledoc """
  QA-estratégia — segundo MOMENTO do `qa-lead` (ADR 0090; `docs/fluxo.yml`,
  papel `qa-estrategia`, status `active`): o mesmo processo, um entregável
  SEPARADO do veredito de PR — o PLANO DE TESTE de uma story, ANTES do dev
  agent escrever código (gate `implementavel`, `docs/gates.yml`).

  Módulo SEM ESTADO — não é `GenServer` —, mesma FORMA de
  `Engine.Gates.QaPerformanceSegurancaAgent`: registro de ferramentas SEM
  `Terminal` (raciocínio de LEITURA, nunca escrita), rodando o `ToolLoop`
  genérico do harness. O CONTEXTO é que é outro: aqui não há
  `dev_state`/`dev_context` — `Engine.Gates.QaEstrategiaContext.fetch/3`
  monta o que basta (story + module_map vigente), e é
  `Engine.Gates.QaLeadServer.run_design/3` quem chama este módulo.

  ## Por que nunca suspende

  O registro (`ReadFile`, `SearchWorkspace`, `EmitPlanoDeTeste`) não tem
  `terminal` nem `write_file` — as DUAS únicas tools que
  `Engine.Harness.Hooks.ActionPipeline` intercepta para criar
  `proposed_action`. Nenhuma chamada deste agente passa pelo pipeline de
  ações, então o `ToolLoop` dele nunca produz `:pending` —
  `QaLeadServer.run_design/3` não precisa de nenhum mecanismo de
  suspensão/retomada para este caminho, ao contrário do resto da área de QA.

  ## Por que o teto de iterações fica em 8, não 60 (RN-085)

  Este agente roda **sem** `token_budget_micros` — não há task nem budget de
  task ainda, é PRE-DEV. O critério da RN-085 não é "quem trabalha muito", é
  "o que segura o gasto além do teto de iterações": sem budget por baixo,
  subir o teto multiplicaria o pior caso sem nada para conter — a MESMA
  razão pela qual `infra-workflows` fica em 8 mesmo usando ferramenta
  (`Engine.Harness.Iteracoes`). Por isso `"qa-estrategia"` NÃO ganhou
  cláusula própria em `Iteracoes.tipo/1`: cair no default
  (`:conversacional`, teto 8) é a decisão certa, não uma lacuna.
  """

  alias Engine.Gates.Tools.EmitPlanoDeTeste
  alias Engine.Harness.Hooks.{ActionPipeline, EventLog}
  alias Engine.Gates.Hooks.TerminationPlanoDeTeste
  alias Engine.Harness.Tools.{ReadFile, SearchWorkspace, RagSearch}
  alias Engine.Harness.{ArtifactEmitter, Hooks, ToolLoop}
  alias Engine.Sessions.EngineApiClient

  # RagSearch entrou aqui (frente rag_search): o prompt já pede "padrões de
  # teste do projeto" — é exatamente o que docs/ADRs indexados no RAG
  # respondem melhor do que vasculhar o worktree às cegas.
  @registry [ReadFile, SearchWorkspace, RagSearch, EmitPlanoDeTeste]

  @doc "Registro de ferramentas — sem Terminal, de propósito (ver moduledoc)."
  def tools, do: @registry

  @doc """
  Roda a avaliação de estratégia de QA para `story` (mapa vindo de
  `EngineApiClient.list_backlog/1`) contra o `module_map` vigente (pode ser
  `nil`). Em sucesso, EMITE `artifact.plano_de_teste` no event log de
  `session_id` e devolve `{:ok, plano}`; em falha, emite `agent.error`
  (durável, com origem — RN-059) e devolve `{:error, motivo}`.
  """
  @spec run(String.t(), String.t(), map(), map() | nil) ::
          {:ok, map()} | {:error, String.t()}
  def run(project_id, session_id, story, module_map) do
    project_id
    |> build_ctx(session_id, story, module_map)
    |> ToolLoop.run()
    |> handle_outcome(project_id, session_id, story)
  end

  defp build_ctx(project_id, session_id, story, module_map) do
    %{
      project_id: project_id,
      session_id: session_id,
      agent: "qa-estrategia",
      tools: @registry,
      hooks: hooks(),
      # Sem budget de propósito — ver o moduledoc sobre o teto de iterações.
      token_budget_micros: nil,
      messages: [initial_message(story, module_map)],
      context_window: 128_000
    }
  end

  defp hooks do
    Hooks.new()
    |> Hooks.register(:pre_tool_use, ActionPipeline)
    |> Hooks.register(:post_tool_use, EventLog)
    |> Hooks.register(:post_tool_use, TerminationPlanoDeTeste)
  end

  defp initial_message(story, module_map) do
    %{
      "role" => "user",
      "content" => """
      Você é a QA-estratégia (docs/fluxo.yml, segundo momento do qa-lead):
      avalia a IMPLEMENTABILIDADE de uma story ANTES do dev agent escrever
      código. Você NÃO escreve código nem roda testes — só lê o que já
      existe e registra um PLANO DE TESTE.

      STORY: #{Map.get(story, "title", "")}
      #{Map.get(story, "description", "")}

      Requisitos funcionais:
      #{lista(Map.get(story, "rf", []))}

      Requisitos não funcionais:
      #{lista(Map.get(story, "rnf", []))}

      Definition of done:
      #{lista(Map.get(story, "dod", []))}

      MÓDULOS do projeto:
      #{descrever_modulos(module_map)}

      Use `read_file`/`search_workspace` para entender o que já existe
      (padrões de teste do projeto, o módulo que a story toca), `rag_search`
      para achar convenção/ADR já indexado sobre o assunto, e então
      `emit_plano_de_teste` com:
      - `planoDeTeste`: síntese do que precisa ser verificado;
      - `criteriosExecutaveis`: os critérios de aceite reescritos de forma
        VERIFICÁVEL (ex.: "dado X, quando Y, então Z" em vez de prosa vaga);
      - `estrategiaDeAutomacao`: GENÉRICA e curta — que NÍVEL de teste
        (unidade/integração/e2e) e ONDE, sem escolher framework específico.

      Responda SEMPRE chamando `emit_plano_de_teste`.
      """,
      :pinned => true
    }
  end

  defp lista([]), do: "(nenhum declarado)"
  defp lista(itens), do: Enum.map_join(itens, "\n", &("- " <> to_string(&1)))

  defp descrever_modulos(nil), do: "(sem module_map)"

  defp descrever_modulos(%{"modules" => mods}) when is_list(mods) and mods != [] do
    Enum.map_join(mods, "\n", fn m ->
      "- #{Map.get(m, "name")} (#{Map.get(m, "stack", "?")}): #{Map.get(m, "responsibility", "")}"
    end)
  end

  defp descrever_modulos(_), do: "(sem module_map)"

  defp handle_outcome(
         {:halted, {"emit_plano_de_teste", plano}, _ctx},
         project_id,
         session_id,
         story
       ) do
    # `ArtifactEmitter.emit/5`, não `append_event/3` cru: valida contra o
    # schema registrado em `Engine.Harness.ArtifactSchemas` (mesmo caminho de
    # `qa_verdict`/`task_blocked`) — payload inválido vira `qa-estrategia.error`
    # em vez de gravar um artefato que ninguém sabe ler.
    ArtifactEmitter.emit(project_id, session_id, "qa-estrategia", "plano_de_teste", %{
      storyId: Map.get(story, "id"),
      planoDeTeste: plano.plano_de_teste,
      criteriosExecutaveis: plano.criterios_executaveis,
      estrategiaDeAutomacao: plano.estrategia_de_automacao
    })

    {:ok, plano}
  end

  defp handle_outcome(outcome, project_id, session_id, story) do
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
