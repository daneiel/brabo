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

  # RN-722: o SecOps não suspende — o ciclo roda inteiro dentro do
  # `handle_cast`. Respondeu, então não há task em voo; ocupado, não responde
  # e o `GateRescuer` trata o silêncio como "vivo".
  @impl true
  def handle_call({:em_voo?, _task_id}, _from, state), do: {:reply, false, state}

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

    {diff_note, dependencias} =
      case Diff.compute(project_id, worktree) do
        {:ok, diff_text} ->
          paths = Diff.changed_paths(diff_text)

          {"#{length(paths)} arquivo(s) alterado(s) nesta PR.", dependencias_commitadas(paths)}

        {:error, reason} ->
          {"diff indisponível (#{inspect(reason)}).", []}
      end

    case Scanner.run(semgrep(), worktree, "semgrep") do
      {_findings, semgrep_note} when is_binary(semgrep_note) ->
        sast_nao_rodou(project_id, dev_state, task_id, semgrep_note)

      {semgrep_findings, nil} ->
        julgar(
          project_id,
          dev_state,
          task_id,
          worktree,
          diff_note,
          semgrep_findings ++ dependencias
        )
    end
  end

  # RN-761 (AT-446): diretório de dependência instalada no diff é achado do
  # gate, com ou sem scanner — a PR de 1.453 arquivos, 1.437 em
  # `node_modules/`, passou aprovada.
  @doc false
  def dependencias_commitadas(paths) do
    paths
    |> Engine.Actions.DiretoriosDeDependencia.commitados()
    |> Enum.map(fn dir ->
      n = Enum.count(paths, &(dir in Path.split(&1)))

      %{
        tool: "brabo",
        path: dir,
        line: 0,
        message:
          "diretório de dependência/build commitado (#{n} arquivo(s)); " <>
            "tire-o do commit e do repositório e ponha no .gitignore"
      }
    end)
  end

  # RN-714 (AT-380): a análise estática (semgrep) que NÃO rodou — binário
  # ausente, saída inválida, exceção ou teto de tempo — não vira aprovação.
  # Nenhum veredito é gravado: a PR fica em `awaiting_secops` (o gate segue
  # PENDENTE e bloqueia), o contrato externo continua com os dois vereditos de
  # sempre, e o motivo vai ao fio como `agent.error` de origem `infra`. A linha
  # de `GateState` fica `in_progress` de propósito: é ela que faz o
  # `GateRescuer` reexecutar o gate (no boot e depois do limiar de staleness),
  # e é assim que corrigir o ambiente volta a julgar.
  #
  # AT-386: o resgate repete o ciclo enquanto o ambiente não muda, e cada
  # repetição gravava um `agent.error` idêntico. Se o último evento do SecOps
  # desta task (erro ou veredito) já é este erro com o MESMO motivo, nada é
  # gravado — só Logger. Motivo novo, ou veredito no meio, grava de novo.
  # Leitura ilegível não prova repetição: grava.
  defp sast_nao_rodou(project_id, dev_state, task_id, nota) do
    if erro_ja_registrado?(project_id, dev_state.session_id, task_id, nota) do
      Logger.info(
        "secops: SAST segue sem rodar (#{nota}) na task #{task_id}; agent.error já no fio, não repetido"
      )
    else
      gravar_sast_nao_rodou(project_id, dev_state, task_id, nota)
    end
  end

  # Leitura CONTIDA (ADR 0060): só os dois tipos do SecOps, cauda com teto.
  defp erro_ja_registrado?(project_id, session_id, task_id, nota) do
    case Engine.Agents.Reidratacao.eventos_do_tipo(project_id, session_id, [
           "agent.error",
           "artifact.secops_verdict"
         ]) do
      {:ok, eventos, _truncado?} ->
        eventos
        |> Enum.filter(&do_secops_da_task?(&1, task_id))
        |> List.last()
        |> case do
          %{"type" => "agent.error", "payload" => %{"reason" => ^nota}} -> true
          _ -> false
        end

      {:error, _} ->
        false
    end
  end

  defp do_secops_da_task?(%{"actorId" => "secops", "type" => "agent.error"} = e, task_id),
    do: get_in(e, ["payload", "taskId"]) == task_id

  defp do_secops_da_task?(%{"type" => "artifact.secops_verdict"} = e, task_id),
    do: get_in(e, ["payload", "taskId"]) == task_id

  defp do_secops_da_task?(_, _), do: false

  defp gravar_sast_nao_rodou(project_id, dev_state, task_id, nota) do
    ArtifactEmitter.append(project_id, dev_state.session_id, "secops", "agent.error", %{
      taskId: task_id,
      origem: "infra",
      mensagem:
        "SAST não rodou: #{nota} — o gate SecOps fica pendente e bloqueia a PR (task #{task_id}); " <>
          "reexecute o gate depois de corrigir.",
      reason: nota
    })
  end

  defp julgar(project_id, dev_state, task_id, worktree, diff_note, semgrep_findings) do
    {gitleaks_findings, gitleaks_note} = Scanner.run(gitleaks(), worktree, "gitleaks")
    findings = semgrep_findings ++ gitleaks_findings
    skipped_notes = Enum.filter([gitleaks_note], & &1)

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

  # RN-636 (ADR 0182): o AppSec só oferece a quem ainda NÃO recebeu oferta
  # pendente nem está ativo no projeto. Antes eram três ofertas por história
  # com `run_design`, aos mesmos três destinos, empilhadas na tela. A pergunta
  # é feita à api no modo `create_handoff_if_absent/5` — sob o lock do destino,
  # onde não há corrida com outra oferta — e as duas respostas "já atendido"
  # NÃO são falha: nenhuma vira `agent.error`. O threat model continua gravado
  # como artefato de qualquer jeito; o que deixa de existir é a oferta repetida.
  defp criar_handoffs_appsec(project_id, session_id, artifact_id) do
    Enum.each(@appsec_handoff_targets, fn to_agent ->
      case EngineApiClient.create_handoff_if_absent(
             project_id,
             session_id,
             "appsec",
             to_agent,
             artifact_id
           ) do
        {:ok, _handoff} ->
          :ok

        {:error, {409, %{"reason" => "agente_ja_ativo"}}} ->
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
