defmodule Engine.Infra.WorkflowsAgent do
  @moduledoc """
  Workflows (Fase 8c, ADR 0038) — subespecialidade da área de Infra. Gera o
  pipeline de CI do projeto do usuário (GitHub Actions ou GitLab CI,
  conforme `ctx.gitProvider`), delegado pelo `InfraLeadServer` — que
  continua com Dockerfiles/compose pra si (RN-037).

  Delegado SÍNCRONO, single-shot: sem GenServer, sem conversa com usuário —
  roda via `ToolLoop` bounded (mesmo primitivo dos subagentes de QA, Fase
  8b), não o loop conversacional que o `InfraLeadServer` usa (não há
  usuário do outro lado nem necessidade de long-lived process). `ctx` vem
  do PRÓPRIO lead, que já buscou `get_infra_context` pro seu kickoff — o
  Workflows não chama `EngineApiClient` diretamente, mesma disciplina do QA.

  ## Fronteira estrutural com o resto da área

  Tool registry NÃO inclui `Terminal` nem acesso a worktree (infra nunca
  teve — "não existe worktree pra PR de infra", ver `InfraGateRunner`): só
  `validate_infra_file` (self-validação antes de terminar) e
  `emit_infra_delegation_result`.

  ## Conhecimento base

  O prompt cita a escada de branches permanentes e a taxonomia de nome de
  `docs/explanation/branching-policy.md`, e o ADR 0030 como a fonte de que
  ISSO É MECANIZADO no repo da própria Brabo — não pra copiar os scripts de
  `scripts/ci/*.ts` (outro produto rodando a própria política da Brabo), mas
  porque todo projeto que a Brabo provisiona já nasce com essas três
  branches via bootstrap de Gitflow (Fase 2): o CI gerado sabe que PR mira
  uma delas.
  """

  alias Engine.Infra.Hooks.Termination
  alias Engine.Infra.Tools.{EmitInfraDelegationResult, ValidateInfraFile}
  alias Engine.Harness.{Hooks, ToolLoop}
  alias Engine.Harness.Hooks.{ActionPipeline, EventLog}

  @registry [ValidateInfraFile, EmitInfraDelegationResult]

  @doc "Registro de ferramentas — sem `Terminal`, sem worktree (ver moduledoc)."
  def tools, do: @registry

  @doc """
  Roda a geração do pipeline de CI. `ctx` é o mapa que o `InfraLeadServer`
  já montou (`moduleMap`, `adrs`, `gitProvider`).

  Devolve `{:ok, %{files:, summary:}}` ou
  `{:blocked, %{reason:, diagnosis:, origin:}}`.
  """
  def run(project_id, session_id, ctx) do
    project_id
    |> build_ctx(session_id, ctx)
    |> ToolLoop.run()
    |> handle_outcome()
  end

  defp build_ctx(project_id, session_id, ctx) do
    %{
      project_id: project_id,
      session_id: session_id,
      agent: "infra-workflows",
      tools: @registry,
      hooks: hooks(),
      messages: [initial_message(ctx)],
      context_window: 128_000
    }
  end

  defp hooks do
    Hooks.new()
    |> Hooks.register(:pre_tool_use, ActionPipeline)
    |> Hooks.register(:post_tool_use, EventLog)
    |> Hooks.register(:post_tool_use, Termination)
  end

  defp initial_message(ctx) do
    provider = Map.get(ctx, "gitProvider")
    modules_text = modules_text(Map.get(ctx, "moduleMap"))

    %{
      "role" => "user",
      "content" => """
      Você é a subespecialidade Workflows da área de Infra. Gere o pipeline de
      CI do projeto — só isso: Dockerfiles e compose são responsabilidade do
      Lead, não sua.

      FORMATO — decidido por `gitProvider` (#{provider || "desconhecido, use github"}):
      - "gitlab" → gere `.gitlab-ci.yml` na raiz do projeto.
      - qualquer outro valor (`github`, `local`, ou desconhecido) → gere
        `.github/workflows/ci.yml`.

      CONHECIMENTO BASE — todo projeto que a Brabo provisiona já nasce com as
      três branches permanentes (dev, qa, main — escada de ambientes) e a
      taxonomia de nome `^.{0,15}/\\S{0,32}$` (docs/explanation/
      branching-policy.md; mecanizado no ADR 0030 — é assim que a própria
      Brabo faz, não pra copiar script nenhum, só pra saber que uma PR sempre
      mira uma dessas três). O pipeline que você gera deve disparar em PR pra
      cada uma delas.

      CONTEÚDO — pra cada módulo abaixo, inclua lint/testes/build idiomáticos
      pro stack descrito (julgamento seu — não existe tabela rígida stack→
      passo, igual já vale hoje pros Dockerfiles do Lead):
      #{modules_text}

      Valide o arquivo gerado com `validate_infra_file` (path + content) antes
      de `emit_infra_delegation_result` (summary + files). actionlint só
      valida GitHub Actions — pra `.gitlab-ci.yml` a validação vem vazia de
      propósito, sem linter estático equivalente disponível.

      Responda SEMPRE chamando uma das ferramentas acima.
      """,
      :pinned => true
    }
  end

  defp modules_text(%{"modules" => modules}) when is_list(modules) and modules != [] do
    Enum.map_join(modules, "\n", fn m ->
      "- #{Map.get(m, "name")} (#{Map.get(m, "stack")}): #{Map.get(m, "responsibility")}"
    end)
  end

  defp modules_text(_), do: "(sem module_map vigente)"

  defp handle_outcome({:halted, {"emit_infra_delegation_result", resultado}, _ctx}) do
    {:ok, resultado}
  end

  defp handle_outcome(outcome) do
    {reason, diagnosis, origin} = falha_do_workflows(outcome)
    {:blocked, %{reason: reason, diagnosis: diagnosis, origin: origin}}
  end

  defp falha_do_workflows({:limit_reached, _ctx}),
    do:
      {"Workflows não concluiu o pipeline de CI",
       "limite de iterações atingido sem emit_infra_delegation_result", "modelo"}

  defp falha_do_workflows({:budget_exceeded, _ctx}),
    do:
      {"Workflows não concluiu o pipeline de CI", "orçamento de tokens esgotado na geração",
       "politica"}

  defp falha_do_workflows({:ok, ctx}) do
    {reason, origin} = diagnostico_de_parada(ctx)
    {"Workflows não concluiu o pipeline de CI", reason, origin}
  end

  defp falha_do_workflows(other),
    do:
      {"Workflows não concluiu o pipeline de CI",
       "desfecho inesperado do ToolLoop: #{inspect(other)}", "infra"}

  defp diagnostico_de_parada(ctx) do
    case Map.get(ctx, :last_error) do
      nil -> {"o modelo parou sem chamar emit_infra_delegation_result", "modelo"}
      error -> {"falha no turno de LLM: #{inspect(error)}", "infra"}
    end
  end
end
