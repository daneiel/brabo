defmodule Engine.Gates.AppSecAgent do
  @moduledoc """
  O appsec (RN-360, `docs/fluxo.yml` `id: appsec`, ADR 0090) — o SecOps num
  SEGUNDO MOMENTO, de DESIGN, antes de existir código ou PR. Mesmo padrão do
  QA: dois momentos, não dois agentes por ora — quem roda este módulo é o
  MESMO processo do `Engine.Gates.SecOpsAgentServer` (ver `run_design/2`
  ali), só que operando sobre a story + o `module_map` em vez de um diff
  real.

  Roda um checklist STRIDE-lite (Spoofing/Tampering/Repudiation/Information
  disclosure/Denial of service/Elevation of privilege) sobre o DESENHO
  descrito pela story — nunca sobre código: `Engine.Gates.SecOpsAgentServer`
  continua sendo o único veredito DETERMINÍSTICO de segurança que roda
  scanner (gitleaks/semgrep) sobre diff real, depois que existe PR.

  Módulo SEM ESTADO (não é GenServer) — mesma forma de
  `Engine.Gates.QaPerformanceSegurancaAgent`: registro de ferramentas SEM
  `Terminal`, só leitura (`read_file`/`search_workspace`, aqui OPCIONAL — o
  contexto de story + module_map já vem pronto no prompt) +
  `emit_threat_model`. Sem `Terminal`, estruturalmente não consegue rodar
  scanner nenhum — a fronteira com o SecOps de PR não depende do modelo
  obedecer o prompt.
  """

  alias Engine.Gates.Hooks.AppSecTermination
  alias Engine.Gates.Tools.EmitThreatModel
  alias Engine.Harness.Tools.{ReadFile, SearchWorkspace, RagSearch, RagFeedback}
  alias Engine.Harness.{Hooks, ToolLoop}
  alias Engine.Harness.Hooks.{ActionPipeline, EventLog}

  # RagSearch entrou aqui (frente rag_search): threat model se beneficia de
  # achar ADR/regra de negócio de segurança já registrada sobre o módulo em
  # questão, em vez de reconstruir o raciocínio do zero a cada story.
  # RagFeedback anda junto de RagSearch (RN-480): buscar sem poder dizer se o
  # trecho serviu deixa a calibração dos pesos sem sinal de verdade nenhum.
  # `:direct` como a busca — votar não é efeito externo.
  @registry [ReadFile, SearchWorkspace, RagSearch, RagFeedback, EmitThreatModel]

  @doc "Registro de ferramentas — sem `Terminal`, de propósito (ver moduledoc)."
  def tools, do: @registry

  @doc """
  Roda o threat model de `story` (mapa cru da api, chaves string) contra
  `module_map` (`%{"modules" => [...]}` cru, ou `nil` — projeto sem
  arquitetura vigente ainda). `session_id` vem de `story["sessionId"]` — não
  há task/worktree por trás, só a sessão que criou a story.

  Devolve `{:ok, %{threat_model:, requisitos_de_seguranca:, riscos:}}` ou
  `{:blocked, %{reason:, diagnosis:, origin:}}`. Sem `{:awaiting, ...}`:
  nenhuma ferramenta do registro passa por aprovação (leitura não é efeito
  externo — RN-092/RN-095).
  """
  def run(project_id, story, module_map) do
    project_id
    |> build_ctx(story, module_map)
    |> ToolLoop.run()
    |> handle_outcome()
  end

  defp build_ctx(project_id, story, module_map) do
    %{
      project_id: project_id,
      session_id: Map.get(story, "sessionId"),
      agent: "appsec",
      tools: @registry,
      hooks: hooks(),
      messages: [initial_message(story, module_map)],
      context_window: 128_000
    }
  end

  defp hooks do
    Hooks.new()
    |> Hooks.register(:pre_tool_use, ActionPipeline)
    |> Hooks.register(:post_tool_use, EventLog)
    |> Hooks.register(:post_tool_use, AppSecTermination)
  end

  defp initial_message(story, module_map) do
    %{
      "role" => "user",
      "content" => """
      Você é o appsec — o SecOps num segundo momento, de DESIGN, ANTES de
      existir código ou PR para a story "#{Map.get(story, "title")}". Você
      NÃO escreve código e NÃO roda scanner (gitleaks/semgrep são o SecOps
      de PR, determinístico, que roda depois, sobre o diff real): só
      raciocina sobre o desenho abaixo e emite um checklist STRIDE-lite.

      Story:
      #{story_content(story)}

      Módulos do module_map vigente que esta story toca:
      #{modules_text(module_map, Map.get(story, "moduleIds", []))}

      Para cada uma das seis categorias STRIDE — Spoofing, Tampering,
      Repudiation, Information disclosure, Denial of service, Elevation of
      privilege — avalie se o desenho acima introduz risco, e o que fazer a
      respeito. "Nenhum risco óbvio" é resposta válida para uma categoria;
      não invente ameaça só para preencher.

      Use `read_file`/`search_workspace` se precisar examinar um ADR ou
      código existente (opcional — o contexto acima já é a base), ou
      `rag_search` para achar ADR/regra de negócio de segurança já indexado
      sobre o assunto. Termine
      SEMPRE chamando `emit_threat_model` com `threatModel` (o checklist nas
      seis categorias), `requisitosSeguranca` (o que a implementação vai ter
      que fazer por causa disto) e `riscos` (o que sobrevive mesmo assim —
      lista vazia é resposta válida).

      Responda SEMPRE chamando uma das ferramentas acima.
      """,
      :pinned => true
    }
  end

  defp story_content(story) do
    """
    #{Map.get(story, "description", "")}

    Requisitos funcionais:
    #{format_list(Map.get(story, "rf"))}

    Requisitos não funcionais:
    #{format_list(Map.get(story, "rnf"))}
    """
  end

  defp format_list(nil), do: "(nenhum)"
  defp format_list([]), do: "(nenhum)"
  defp format_list(items), do: Enum.map_join(items, "\n", &"- #{&1}")

  defp modules_text(%{"modules" => modules}, module_ids)
       when is_list(modules) and modules != [] do
    relevantes =
      case module_ids do
        [] -> modules
        ids -> Enum.filter(modules, &(Map.get(&1, "name") in ids))
      end

    case relevantes do
      [] ->
        "(nenhum módulo do module_map bate com os moduleIds da story: #{inspect(module_ids)})"

      mods ->
        Enum.map_join(mods, "\n", fn m ->
          "- #{Map.get(m, "name")} (#{Map.get(m, "stack")}): #{Map.get(m, "responsibility")}"
        end)
    end
  end

  defp modules_text(_module_map, _module_ids), do: "(sem module_map vigente)"

  defp handle_outcome({:halted, {"emit_threat_model", resultado}, _ctx}) do
    {:ok, resultado}
  end

  defp handle_outcome(outcome) do
    {reason, diagnosis, origin} = falha(outcome)
    {:blocked, %{reason: reason, diagnosis: diagnosis, origin: origin}}
  end

  defp falha({:limit_reached, _ctx}),
    do:
      {"appsec não concluiu o threat model", "limite de iterações atingido sem emit_threat_model",
       "modelo"}

  defp falha({:budget_exceeded, _ctx}),
    do:
      {"appsec não concluiu o threat model", "orçamento de tokens esgotado no design", "politica"}

  defp falha({:ok, ctx}) do
    {reason, origin} = diagnostico_de_parada(ctx)
    {"appsec não concluiu o threat model", reason, origin}
  end

  defp falha(other),
    do:
      {"appsec não concluiu o threat model", "desfecho inesperado do ToolLoop: #{inspect(other)}",
       "infra"}

  defp diagnostico_de_parada(ctx) do
    case Map.get(ctx, :last_error) do
      nil -> {"o modelo parou sem chamar emit_threat_model", "modelo"}
      error -> {"falha no turno de LLM: #{inspect(error)}", "infra"}
    end
  end
end
