defmodule Engine.Gates.SecOpsAgentServer do
  @moduledoc """
  SecOpsAgent (Fase 4a) — um por projeto (`Engine.Gates.Registry`, chave
  `{project_id, "secops"}`). Ativado quando QA aprova: acha o worktree do
  dev, roda `gitleaks`+`semgrep` (`Engine.Actions.GitleaksDetector`/
  `SemgrepDetector`, ambos com detecção opcional — scanner ausente é
  PULADO, registrado no resumo, nunca quebra o gate) e lista os ADRs
  `securityRelevant` como checklist informativo.

  DETERMINÍSTICO (sem LLM/ToolLoop), ao contrário do QAAgent: achar um
  segredo/vulnerabilidade é checagem estruturada sobre saída de scanner, não
  julgamento semântico — um SecOps determinístico é mais confiável do que
  um LLM resumindo achado de segurança (decisão documentada no ADR 0013).
  Sem achados → `approved`; qualquer achado → `changes_requested`, devolve
  pro `Engine.Dev.DevAgentServer.correct/3` no MESMO worktree/branch.

  ## A fronteira com QA de Performance/Segurança (Fase 8b)

  A área de QA ganhou uma subespecialidade de Performance e Segurança
  (`Engine.Gates.QaPerformanceSegurancaAgent`) que também olha pra segurança —
  mas só em nível de CÓDIGO/DESIGN (parametrização, validação de entrada, o
  que dá pra notar lendo o diff), nunca scanner. Ela não tem `Terminal` no
  registro de ferramentas, então estruturalmente não consegue rodar
  gitleaks/semgrep nem substituir este gate. Este continua sendo o ÚNICO
  veredito de segurança que conta pra aprovar a PR.

  ## O appsec (RN-360, ADR 0090) é este MESMO processo, num segundo momento

  `run_design/2` (`docs/fluxo.yml` `id: appsec`) roda o `Engine.Gates.AppSecAgent`
  — threat model STRIDE-lite sobre a STORY + `module_map`, ANTES de existir
  código/PR — no mesmo GenServer, mesma chave de `Registry`. Não é um
  processo novo: "mesmo padrão do QA, dois momentos, não dois agentes por
  ora" (docs/fluxo.yml). `run/2` (acima) segue determinístico sobre diff
  real; `run_design/2` não toca `Diff`/`Scanner`/`DevAgentState` nenhum —
  sem worktree, sem task_id, o contexto vem de
  `Engine.Gates.AppSecContextBuilder.fetch/2`.
  """

  use GenServer, restart: :temporary

  require Logger

  alias Engine.Dev.{ContextBuilder, DevAgentServer, DevAgentState}
  alias Engine.Gates.{AppSecAgent, AppSecContextBuilder, Diff, GateState, Scanner}
  alias Engine.Harness.ArtifactEmitter
  alias Engine.Sessions.EngineApiClient

  # A entrega do threat model (RN-360): arquiteto (recebe todo threat model
  # do projeto, mesmo endereço que já recebe module_map/C4), dev-lead
  # (entrada declarada em docs/fluxo.yml — informa o plano de paralelismo) e
  # o LEAD da área de Infra. O id do fluxo é `area-infra`; o AGENTE endereçável
  # é `"infra"` (`apps/api/src/domain/agents/agent-areas.ts`, mesmo valor que
  # `Engine.Agents.ArquitetoServer.executar_offer_infra_handoff/1` já usa) —
  # handoff externo endereça só o LEAD da área (ADR 0038), nunca `area-infra`.
  @appsec_handoff_targets ["arquiteto", "dev-lead", "infra"]

  defp semgrep,
    do: Application.get_env(:engine, :semgrep_detector, Engine.Actions.SemgrepDetector.Live)

  defp gitleaks,
    do: Application.get_env(:engine, :gitleaks_detector, Engine.Actions.GitleaksDetector.Live)

  def start_link(project_id) do
    GenServer.start_link(__MODULE__, project_id, name: via(project_id))
  end

  def via(project_id), do: {:via, Registry, {Engine.Gates.Registry, {project_id, "secops"}}}

  @doc "Dispara a checagem de SecOps pra `task_id`."
  def run(project_id, task_id), do: GenServer.cast(via(project_id), {:run, task_id})

  @doc """
  Dispara o threat model de DESIGN (appsec, RN-360) pra `story_id` —
  segundo momento do secops, ANTES de existir código/PR. Ver moduledoc.
  """
  def run_design(project_id, story_id),
    do: GenServer.cast(via(project_id), {:run_design, story_id})

  @impl true
  def init(project_id), do: {:ok, %{project_id: project_id}}

  @impl true
  def handle_cast({:run, task_id}, state) do
    case DevAgentState.find_by_task_id(state.project_id, task_id) do
      nil -> :ok
      dev_state -> run_secops(state.project_id, dev_state, task_id)
    end

    {:noreply, state}
  end

  @impl true
  def handle_cast({:run_design, story_id}, state) do
    case AppSecContextBuilder.fetch(state.project_id, story_id) do
      {:ok, %{story: story, module_map: module_map}} ->
        run_appsec_design(state.project_id, story, module_map)

      {:error, reason} ->
        # Sem story (ou sem sessão por trás dela) não há ONDE narrar a
        # falha — nenhum `session_id` pra registrar evento. Loga e para,
        # mesmo raciocínio de `find_by_task_id` devolvendo `nil` acima.
        Logger.warning(
          "appsec: contexto de design indisponível pra story #{story_id}: #{inspect(reason)}"
        )
    end

    {:noreply, state}
  end

  defp run_secops(project_id, dev_state, task_id) do
    # ADR 0067: mesma disciplina do QaLeadServer — o ciclo entra em voo ANTES
    # de rodar os scanners, pra o `Engine.Gates.GateRescuer` achar um ciclo
    # cujo processo caiu no meio (ex.: durante `Scanner.run/3`) e nunca
    # chegou a registrar veredito.
    GateState.upsert!(%{
      project_id: project_id,
      task_id: task_id,
      gate: "secops",
      session_id: dev_state.session_id,
      step: "in_progress"
    })

    worktree = dev_state.worktree_path

    diff_note =
      case Diff.compute(project_id, worktree) do
        {:ok, diff_text} ->
          "#{length(Diff.changed_paths(diff_text))} arquivo(s) alterado(s) nesta PR."

        {:error, reason} ->
          "diff indisponível (#{inspect(reason)})."
      end

    {semgrep_findings, semgrep_note} = Scanner.run(semgrep(), worktree, "semgrep")
    {gitleaks_findings, gitleaks_note} = Scanner.run(gitleaks(), worktree, "gitleaks")
    findings = semgrep_findings ++ gitleaks_findings
    skipped_notes = Enum.filter([semgrep_note, gitleaks_note], & &1)

    security_adrs = security_relevant_adrs(project_id, dev_state.session_id, task_id)

    veredito = if findings == [], do: "approved", else: "changes_requested"
    resumo = build_resumo(diff_note, skipped_notes, security_adrs, findings)
    itens = Enum.map(findings, &format_item/1)

    # Parecer como ARTEFATO validado (`Engine.Harness.ArtifactSchemas`), não
    # como evento cru — ver ADR 0020.
    ArtifactEmitter.emit(project_id, dev_state.session_id, "secops", "secops_verdict", %{
      taskId: task_id,
      veredito: veredito,
      resumo: resumo,
      itens: itens
    })

    apply_verdict(project_id, dev_state, task_id, veredito, resumo, itens)
  end

  defp security_relevant_adrs(project_id, session_id, task_id) do
    case ContextBuilder.fetch(project_id, session_id, task_id) do
      {:ok, %{adrs: adrs}} -> Enum.filter(adrs, &Map.get(&1, "securityRelevant", false))
      {:error, _reason} -> []
    end
  end

  defp build_resumo(diff_note, skipped_notes, security_adrs, findings) do
    scanner_note =
      case skipped_notes do
        [] -> ""
        notes -> " " <> Enum.join(notes, " ")
      end

    checklist_note =
      case security_adrs do
        [] ->
          "Nenhum ADR de segurança marcado pra este projeto."

        adrs ->
          "#{length(adrs)} ADR(s) de segurança considerados: " <>
            Enum.map_join(adrs, ", ", &Map.get(&1, "title", "(sem título)"))
      end

    findings_note =
      if findings == [], do: "Nenhum achado.", else: "#{length(findings)} achado(s)."

    "#{diff_note}#{scanner_note} #{checklist_note} #{findings_note}"
  end

  defp format_item(finding) do
    "[#{finding.tool}] #{finding.path}:#{finding.line} — #{finding.message}"
  end

  defp apply_verdict(project_id, dev_state, task_id, veredito, resumo, itens) do
    result =
      EngineApiClient.record_gate_verdict(
        project_id,
        dev_state.session_id,
        task_id,
        "secops",
        veredito,
        resumo,
        itens,
        dev_state.max_gate_corrections
      )

    case result do
      {:ok, %{"nextAction" => "correct"}} ->
        # Mesma disciplina do QaLeadServer (ADR 0067): veredito já durável,
        # persiste o dispatch pendente ANTES de chamar `DevAgentServer.correct`
        # e apaga DEPOIS — a chamada em si é local, sem I/O de rede no meio.
        findings = %{gate: "secops", reason: resumo, diagnosis: Enum.join(itens, "; ")}

        GateState.upsert!(%{
          project_id: project_id,
          task_id: task_id,
          gate: "secops",
          session_id: dev_state.session_id,
          step: "dispatch_pending",
          next_action: "correct",
          correction_reason: resumo,
          correction_diagnosis: findings.diagnosis
        })

        DevAgentServer.correct(project_id, dev_state.agent_id, findings)
        GateState.delete(project_id, task_id, "secops")

      _ ->
        # `done`, ou erro/estado inesperado da api — nos dois casos não há
        # dispatch pendente (mesmo raciocínio do QaLeadServer).
        GateState.delete(project_id, task_id, "secops")
    end
  end

  # --- appsec (RN-360): segundo momento, de design ---

  defp run_appsec_design(project_id, story, module_map) do
    case AppSecAgent.run(project_id, story, module_map) do
      {:ok, resultado} -> emit_threat_model(project_id, story, resultado)
      {:blocked, info} -> emit_bloqueio_appsec(project_id, story, info)
    end
  end

  defp emit_threat_model(project_id, story, resultado) do
    session_id = Map.get(story, "sessionId")
    story_id = Map.get(story, "id")

    payload = %{
      storyId: story_id,
      threatModel: resultado.threat_model,
      requisitosDeSeguranca: resultado.requisitos_de_seguranca,
      riscos: resultado.riscos
    }

    case ArtifactEmitter.emit_returning(project_id, session_id, "appsec", "threat_model", payload) do
      {:ok, %{"id" => artifact_id}} ->
        criar_handoffs_appsec(project_id, session_id, artifact_id)

      {:error, _reason} ->
        # Payload inválido já vira `appsec.error` dentro do próprio
        # `emit_returning/5` (ArtifactSchemas) — nada mais a fazer aqui: sem
        # id de artefato não há como criar o handoff (ele referencia o
        # threat model), e inventar um handoff sem artefato mentiria sobre a
        # origem do parecer.
        :ok
    end
  end

  defp criar_handoffs_appsec(project_id, session_id, artifact_id) do
    Enum.each(@appsec_handoff_targets, fn to_agent ->
      case EngineApiClient.create_handoff(project_id, session_id, "appsec", to_agent, artifact_id) do
        {:ok, _handoff} ->
          :ok

        {:error, reason} ->
          # RN-116: falha de handoff nunca fica silenciosa — narra a origem
          # no fio, um evento por alvo (o handoff é a árvore inteira; um
          # alvo falhar não deve esconder que os outros dois deram certo).
          ArtifactEmitter.append(project_id, session_id, "appsec", "agent.error", %{
            origem: "infra",
            mensagem: "Não consegui oferecer o threat model ao #{to_agent}: #{inspect(reason)}.",
            reason: inspect(reason)
          })
      end
    end)
  end

  defp emit_bloqueio_appsec(project_id, story, %{
         reason: reason,
         diagnosis: diagnosis,
         origin: origin
       }) do
    ArtifactEmitter.append(project_id, Map.get(story, "sessionId"), "appsec", "agent.error", %{
      origem: origin,
      mensagem: "#{reason} (story #{Map.get(story, "id")}): #{diagnosis}",
      reason: diagnosis
    })
  end
end
