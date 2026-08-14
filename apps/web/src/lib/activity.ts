import type { ComponentType } from 'react';
import type { DelegationEventPayload, SessionEvent } from './api-types';
import { AGENTS } from './agents';
import {
  BranchIcon,
  CommitIcon,
  DiffIcon,
  HypothesisIcon,
  PermissionIcon,
  PrIcon,
  SessionIcon,
  StackIcon,
  TerminalIcon,
} from '../components/ui/icons';

export type ActivityKind =
  | 'commit'
  | 'pr'
  | 'hypothesis'
  | 'session'
  | 'permission'
  | 'terminal'
  | 'delegation'
  | 'generic';

export interface ActivityDisplay {
  kind: ActivityKind;
  icon: ComponentType<{ size?: number; className?: string }>;
  color: string;
  bad: boolean;
  text: string;
}

/**
 * Eventos de MÁQUINA — existem pro sistema derivar estado, não pro humano ler.
 *
 * `agent.status` passou a ser persistido no ADR 0021 (o painel precisa dele pra
 * saber quem está trabalhando), e sem esta lista ele vira ruído no feed: dois
 * "infra · agent.status" por turno, sem informação nenhuma. `tool.call`/
 * `tool.result`/`agent.response` são o mesmo caso — internos do ciclo do
 * agente, já visíveis na tela da sessão.
 *
 * Achado rodando o feed contra o event log REAL: 116 de 193 eventos caíam no
 * fallback genérico, quase todos destes tipos.
 */
const EVENTOS_DE_MAQUINA = new Set([
  'agent.status',
  'agent.response',
  'agent.delta',
  'tool.call',
  'tool.result',
  'context.compacted',
]);

/** Se o feed deve ESCONDER o evento (ruído de máquina, não narrativa). */
export function isMachineEvent(event: SessionEvent): boolean {
  return EVENTOS_DE_MAQUINA.has(event.type);
}

// Aceita number além de string: `toVersion`/`restoredFrom` chegam como número
// e, aceitando só string, sumiam em silêncio — a narração do patch saía sem a
// versão e a do rollback saía "revertida para a v?". Quem chama isto quer um
// campo PRA EXIBIR, e um número é exibível.
function payloadField(payload: unknown, key: string): string | undefined {
  if (payload && typeof payload === 'object' && key in payload) {
    const value = (payload as Record<string, unknown>)[key];
    if (typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }
  return undefined;
}

/**
 * Os passos do bootstrap de Gitflow em português (achado H).
 *
 * Escritos, não derivados do identificador: `create_qa_branch` viraria "create
 * qa branch", que é o mesmo identificador com espaços — e a queixa era
 * exatamente que a tela mostrava identificador interno em vez de dizer o que
 * aconteceu.
 *
 * `create_rc_branch` continua aqui mesmo tendo sido APOSENTADO (o degrau `rc`
 * saiu da política, ADR 0030): projetos bootstrapados por versões anteriores
 * têm o evento no log, e traduzi-lo é a diferença entre ler a história deles ou
 * ver "atividade em system".
 */
const PASSO_DO_BOOTSTRAP: Record<string, string> = {
  commit_pr_template: 'template de PR',
  commit_branching_policy: 'política de branches',
  create_dev_branch: 'branch dev',
  create_qa_branch: 'branch qa',
  create_rc_branch: 'branch rc',
  protect_branches: 'proteção das branches',
};

/** O motivo da falha, quando o evento o trouxe — senão, silêncio. */
function motivoDoBootstrap(payload: unknown): string {
  const motivo =
    payloadField(payload, 'reason') ?? payloadField(payload, 'error');
  return motivo ? `: ${motivo}` : '';
}

// Classifica eventos do event log em algo exibível — o backend guarda
// `type` como string livre (ver AppendSessionEventUseCase), então o
// mapeamento é por prefixo/valor conhecido, com fallback genérico.
export function classifyEvent(event: SessionEvent): ActivityDisplay {
  const { type, payload } = event;
  const actorLabel = event.actor.kind === 'agent' ? event.actor.id : event.actor.kind;

  const looksLikeCommit = type === 'action.executed' && payloadField(payload, 'command')?.includes('commit');
  if (type.startsWith('git.commit') || looksLikeCommit) {
    return {
      kind: 'commit',
      icon: CommitIcon,
      color: 'var(--text-secondary)',
      bad: false,
      text: `${actorLabel} fez commit ${payloadField(payload, 'sha') ?? ''}`.trim(),
    };
  }
  if (type.startsWith('git.push')) {
    return {
      kind: 'commit',
      icon: BranchIcon,
      color: 'var(--text-secondary)',
      bad: false,
      text: `${actorLabel} enviou alterações para ${payloadField(payload, 'branch') ?? 'branch'}`,
    };
  }
  if (type === 'pr.gate_changed') {
    const gate = payloadField(payload, 'gate');
    const veredito = payloadField(payload, 'veredito');
    return {
      kind: 'pr',
      icon: PrIcon,
      color: veredito === 'changes_requested' ? 'var(--danger)' : 'var(--accent)',
      bad: veredito === 'changes_requested',
      text: gate
        ? `gate ${gate}: ${veredito === 'approved' ? 'aprovado' : veredito === 'changes_requested' ? 'mudanças solicitadas' : 'atualizado'}`
        : `${actorLabel} atualizou o gate da PR`,
    };
  }
  if (type === 'infra.gate_changed') {
    const gate = payloadField(payload, 'gate');
    const veredito = payloadField(payload, 'veredito');
    return {
      kind: 'pr',
      icon: PrIcon,
      color: veredito === 'changes_requested' ? 'var(--danger)' : 'var(--accent)',
      bad: veredito === 'changes_requested',
      text: gate
        ? `PR de infra · gate ${gate}: ${veredito === 'approved' ? 'aprovado' : veredito === 'changes_requested' ? 'mudanças solicitadas' : 'atualizado'}`
        : `${actorLabel} atualizou o gate da PR de infra`,
    };
  }
  if (type.startsWith('pr.') || type.startsWith('pr_open')) {
    return {
      kind: 'pr',
      icon: PrIcon,
      color: 'var(--accent)',
      bad: false,
      text: `${actorLabel} abriu pull request${payloadField(payload, 'title') ? `: ${payloadField(payload, 'title')}` : ''}`,
    };
  }
  if (type === 'artifact.qa_verdict' || type === 'artifact.secops_verdict') {
    const gateLabel = type === 'artifact.qa_verdict' ? 'QA' : 'SecOps';
    const veredito = payloadField(payload, 'veredito');
    const approved = veredito === 'approved';
    // Parecer de gate de PR de infra (InfraGateRunner) tem `prActionId` no
    // payload em vez de `taskId` (o dev) — só o texto deixa claro a origem.
    const isInfra = payloadField(payload, 'prActionId') !== undefined;
    return {
      kind: 'hypothesis',
      icon: HypothesisIcon,
      color: approved ? 'var(--success)' : 'var(--danger)',
      bad: !approved,
      text: `${gateLabel}${isInfra ? ' (PR de infra)' : ''}: ${approved ? 'aprovado' : 'mudanças solicitadas'}`,
    };
  }
  if (type.startsWith('artifact.')) {
    const artifactKind = type.slice('artifact.'.length);
    const label =
      artifactKind === 'business_rule'
        ? `${actorLabel} registrou uma regra de negócio`
        : artifactKind === 'product_brief'
          ? `${actorLabel} consolidou o product brief`
          : artifactKind === 'module_map'
            ? `${actorLabel} definiu o mapa de módulos`
            : artifactKind === 'insight'
              ? `${actorLabel} registrou um insight de arquitetura`
              : `${actorLabel} emitiu um artefato (${artifactKind})`;
    return {
      kind: 'hypothesis',
      icon: HypothesisIcon,
      color: 'var(--accent)',
      bad: false,
      text: label,
    };
  }
  if (type === 'dev.blocked') {
    return {
      kind: 'commit',
      icon: CommitIcon,
      color: 'var(--danger)',
      bad: true,
      text: `${actorLabel} bloqueou a task: ${payloadField(payload, 'reason') ?? 'sem motivo informado'}`,
    };
  }
  // O circuit breaker (Fase 12b, RN-047) é o evento MAIS grave que um dev
  // agent produz — ele parou de trabalhar e só um humano o destrava. Cai
  // aqui, antes do genérico de `dev.`, porque naquele ele virava "atividade
  // em dev-api" em cinza neutro: indistinguível de ruído no sino de
  // notificações, enquanto UMA task bloqueada aparecia em vermelho.
  if (type === 'dev.idle_tripped') {
    const n = payloadField(payload, 'consecutiveBlocked');
    return {
      kind: 'commit',
      icon: CommitIcon,
      color: 'var(--danger)',
      bad: true,
      text:
        `${actorLabel} PAROU — circuit breaker` +
        (n ? `: ${n} tasks bloqueadas seguidas` : '') +
        '. Rearme no painel do time para retomar.',
    };
  }
  if (type.startsWith('dev.')) {
    return {
      kind: 'commit',
      icon: CommitIcon,
      color: type.includes('error') ? 'var(--danger)' : 'var(--text-secondary)',
      bad: type.includes('error'),
      text:
        type === 'dev.working'
          ? `${actorLabel} está implementando (${payloadField(payload, 'branch') ?? 'branch'})`
          : type === 'dev.started'
            ? `${actorLabel} começou a trabalhar`
            : type === 'dev.idle'
              ? `${actorLabel} sem tarefa disponível`
              : type === 'dev.awaiting_gate'
                ? `${actorLabel} abriu a PR e aguarda o gate`
                : type === 'dev.rearmed'
                  ? `${actorLabel} rearmou ${payloadField(payload, 'agentId') ?? 'o agente'}`
                  : `atividade em ${actorLabel}`,
    };
  }
  // O bootstrap de Gitflow (achado H). Os cinco tipos caíam no fallback final e
  // apareciam como "atividade em system" — cinco linhas idênticas e mudas
  // justamente na PRIMEIRA coisa que alguém vê num projeto recém-provisionado,
  // que é quando mais se quer saber o que está acontecendo.
  //
  // O `step` é o que dá conteúdo à linha; sem traduzi-lo, "passo concluído"
  // repetido seis vezes não é melhor que o genérico.
  if (type.startsWith('bootstrap.')) {
    const passo = PASSO_DO_BOOTSTRAP[payloadField(payload, 'step') ?? ''];
    const alvo = passo ?? 'um passo do bootstrap';

    return {
      kind: 'session',
      icon: StackIcon,
      color: 'var(--accent)',
      // Só `step_failed` é ruim. `degraded` e `skipped` são desfechos
      // PREVISTOS — provider sem a capability, ou passo já feito —, e pintá-los
      // de erro ensinaria a ignorar o vermelho.
      bad: type === 'bootstrap.step_failed',
      text:
        type === 'bootstrap.step_started'
          ? `bootstrap: ${alvo}`
          : type === 'bootstrap.step_completed'
            ? `bootstrap: ${alvo} — pronto`
            : type === 'bootstrap.step_failed'
              ? `bootstrap: ${alvo} falhou${motivoDoBootstrap(payload)}`
              : type === 'bootstrap.step_degraded'
                ? `bootstrap: ${alvo} não é suportado por ${payloadField(payload, 'provider') ?? 'este provider'}`
                : type === 'bootstrap.step_skipped'
                  ? `bootstrap: ${alvo} já estava feito`
                  : `bootstrap: ${alvo}`,
    };
  }
  if (type.startsWith('execution.')) {
    return {
      kind: 'session',
      icon: StackIcon,
      color: 'var(--accent)',
      bad: false,
      text:
        type === 'execution.activated'
          ? 'execução ativada'
          : type === 'execution.parallelization_suggested'
            ? `sugestão: dev extra para ${payloadField(payload, 'module') ?? 'um módulo'}`
            : type === 'execution.parallelization_accepted'
              ? `dev extra aceito para ${payloadField(payload, 'module') ?? 'um módulo'}`
              : `atividade em ${actorLabel}`,
    };
  }
  // A fase de execução narrada de verdade (Fase 4a): claim, bloqueio e
  // desbloqueio de task caíam no genérico "atualizou o backlog", sem dizer
  // QUAL task — justamente os eventos que o painel existe pra mostrar.
  if (type === 'backlog.task_claimed') {
    return {
      kind: 'commit',
      icon: CommitIcon,
      color: 'var(--accent)',
      bad: false,
      text: `pegou a task "${payloadField(payload, 'title') ?? 'sem título'}"${
        payloadField(payload, 'module') ? ` (${payloadField(payload, 'module')})` : ''
      }`,
    };
  }
  if (type === 'backlog.task_blocked') {
    return {
      kind: 'commit',
      icon: CommitIcon,
      color: 'var(--danger)',
      bad: true,
      text: `task bloqueada: ${payloadField(payload, 'reason') ?? 'sem motivo registrado'}`,
    };
  }
  if (type === 'backlog.task_unblocked') {
    return {
      kind: 'commit',
      icon: CommitIcon,
      color: 'var(--success)',
      bad: false,
      text: `task desbloqueada`,
    };
  }
  if (type === 'backlog.task_status_changed') {
    return {
      kind: 'commit',
      icon: CommitIcon,
      color: 'var(--text-muted)',
      bad: false,
      text: `task → ${payloadField(payload, 'status') ?? 'novo status'}`,
    };
  }
  // Fase 12c (RN-048). As três precedem o fallback `type.startsWith('backlog.')`
  // lá embaixo, que as reduziria a "criou uma história" — mesmo cuidado que a
  // 12b tomou com `dev.idle_tripped`.
  if (type === 'backlog.story_promotion_proposed') {
    return {
      kind: 'generic',
      icon: StackIcon,
      color: 'var(--warning)',
      // Não é falha: o PO fez o trabalho dele. É uma decisão esperando você.
      bad: false,
      text: `história "${payloadField(payload, 'title') ?? 'sem título'}" pronta, aguardando sua promoção`,
    };
  }
  if (type === 'backlog.story_promotion_returned') {
    return {
      kind: 'generic',
      icon: StackIcon,
      color: 'var(--danger)',
      bad: true,
      text: `você devolveu "${payloadField(payload, 'title') ?? 'uma história'}" ao PO: ${payloadField(payload, 'reason') ?? 'sem motivo'}`,
    };
  }
  if (type === 'backlog.story_transitioned') {
    const para = payloadField(payload, 'to');
    // `ready` com ator `user` é a promoção manual; com ator `po`, o modo auto.
    const quem = actorLabel === 'user' ? 'você promoveu' : `${actorLabel} moveu`;
    return {
      kind: 'generic',
      icon: StackIcon,
      color: para === 'ready' ? 'var(--success)' : 'var(--text-muted)',
      bad: false,
      text:
        para === 'ready'
          ? `${quem} uma história a pronta — as tarefas dela ficaram pegáveis`
          : `história → ${para ?? 'novo estado'}`,
    };
  }
  // RN-165, e pela MESMA razão das três acima: sem este ramo o fallback
  // `type.startsWith('backlog.')` narraria "o po atualizou o backlog" — que é
  // o oposto do que aconteceu. `bad`, porque é: a execução não sai do lugar.
  if (type === 'backlog.epic_without_story') {
    // `payloadField` só devolve string/número — `epicTitles` é lista, e por
    // isso é lida aqui, com degradação para a frase sem os nomes.
    const titulos =
      payload && typeof payload === 'object' && 'epicTitles' in payload
        ? (payload as { epicTitles?: unknown }).epicTitles
        : undefined;
    const nomes = Array.isArray(titulos)
      ? titulos.filter((t): t is string => typeof t === 'string')
      : [];
    return {
      kind: 'generic',
      icon: StackIcon,
      color: 'var(--danger)',
      bad: true,
      text:
        `${actorLabel} encerrou com épico sem nenhuma história` +
        (nomes.length > 0 ? ` (${nomes.join(', ')})` : '') +
        ' — sem história não há tarefa, e a execução trava',
    };
  }
  if (type === 'backlog.story_demoted') {
    return {
      kind: 'generic',
      icon: StackIcon,
      color: 'var(--danger)',
      bad: true,
      text: `história rebaixada a draft (módulo removido do module_map)`,
    };
  }
  // Achado R. É AVISO, não erro: a história foi criada e segue o fluxo —
  // por isso `warning` e não `danger`, e por isso o texto nomeia a outra
  // história, que é o que permite ao usuário julgar em um olhar.
  if (type === 'backlog.story_overlap_warned') {
    return {
      kind: 'generic',
      icon: StackIcon,
      color: 'var(--warning)',
      bad: false,
      text: `história "${payloadField(payload, 'title') ?? 'nova'}" não acrescenta cobertura sobre "${payloadField(payload, 'sobrepoeTitulo') ?? 'outra'}"`,
    };
  }
  if (type.startsWith('adr.')) {
    return {
      kind: 'pr',
      icon: PrIcon,
      color: type.includes('failed') ? 'var(--danger)' : 'var(--accent)',
      bad: type.includes('failed'),
      text:
        type === 'adr.pr_opened'
          ? `PR de ADR aberta no repositório`
          : `falha ao abrir a PR de ADR`,
    };
  }
  if (type === 'infra.artifact_blocked') {
    return {
      kind: 'commit',
      icon: CommitIcon,
      color: 'var(--danger)',
      bad: true,
      text: `PR de infra bloqueada: ${payloadField(payload, 'reason') ?? 'ciclo de correção esgotado'}`,
    };
  }
  if (type.startsWith('infra.')) {
    return {
      kind: 'pr',
      icon: PrIcon,
      color: type.includes('failed') ? 'var(--danger)' : 'var(--accent)',
      bad: type.includes('failed'),
      text:
        type === 'infra.pr_opened'
          ? `PR de infra aberta no repositório${payloadField(payload, 'title') ? `: ${payloadField(payload, 'title')}` : ''}`
          : type === 'infra.pr_failed'
            ? 'falha ao abrir a PR de infra'
            : `atividade em ${actorLabel}`,
    };
  }
  if (type.startsWith('backlog.')) {
    const what = type.slice('backlog.'.length).replace('_created', '');
    const label =
      what === 'epic'
        ? 'criou um épico'
        : what === 'story'
          ? 'criou uma história'
          : what === 'task'
            ? 'criou uma tarefa'
            : 'atualizou o backlog';
    return {
      kind: 'generic',
      icon: StackIcon,
      color: 'var(--accent)',
      bad: false,
      text: `${actorLabel} ${label}`,
    };
  }
  // Anamnese / patches de instrução (Fase 4b).
  if (type === 'instruction.patched' || type === 'instruction.rolled_back') {
    const agent = payloadField(payload, 'agent') ?? 'um agente';
    const to = payloadField(payload, 'toVersion');
    const restored = payloadField(payload, 'restoredFrom');
    return {
      kind: 'generic',
      icon: DiffIcon,
      color: 'var(--accent)',
      bad: false,
      text:
        type === 'instruction.patched'
          ? `instrução de ${agent} atualizada${to ? ` (v${to})` : ''}`
          : `instrução de ${agent} revertida para a v${restored ?? '?'}`,
    };
  }
  if (type === 'instruction.patch_failed') {
    return {
      kind: 'generic',
      icon: DiffIcon,
      color: 'var(--danger)',
      bad: true,
      text: `falha ao aplicar patch de instrução: ${payloadField(payload, 'reason') ?? 'motivo não informado'}`,
    };
  }
  if (type === 'anamnese.run_failed') {
    return {
      kind: 'hypothesis',
      icon: HypothesisIcon,
      color: 'var(--danger)',
      bad: true,
      text: `rodada da Anamnese não concluiu: ${payloadField(payload, 'reason') ?? 'motivo não informado'}`,
    };
  }
  if (type.startsWith('anamnese.')) {
    const competency = payloadField(payload, 'competency');
    return {
      kind: 'hypothesis',
      icon: HypothesisIcon,
      color: 'var(--accent)',
      bad: false,
      text:
        type === 'anamnese.profile_updated'
          ? `perfil de proficiência atualizado${competency ? `: ${competency} = ${payloadField(payload, 'level') ?? '?'}` : ''}`
          : type === 'anamnese.run_completed'
            ? 'rodada da Anamnese concluída'
            : `atividade em ${actorLabel}`,
    };
  }
  if (type === 'architecture.readiness_confirmed') {
    return {
      kind: 'session',
      icon: StackIcon,
      color: 'var(--accent)',
      bad: false,
      text: 'usuário confirmou a arquitetura pronta — handoff para o InfraAgent oferecido',
    };
  }
  if (type === 'agent.activated') {
    return {
      kind: 'session',
      icon: SessionIcon,
      color: 'var(--accent)',
      bad: false,
      text: `${actorLabel} entrou na sessão`,
    };
  }
  if (type.startsWith('handoff.')) {
    return {
      kind: 'generic',
      icon: PrIcon,
      color: 'var(--accent)',
      bad: false,
      text: `${actorLabel} ofereceu um handoff para ${payloadField(payload, 'toAgent') ?? 'outro agente'}`,
    };
  }
  // Psicólogo (Fase 4b). Os tipos reais são `psychologist.*` — o antigo
  // branch `startsWith('hypothesis')` nunca batia em nada.
  if (type === 'psychologist.analysis_failed') {
    return {
      kind: 'hypothesis',
      icon: HypothesisIcon,
      color: 'var(--danger)',
      bad: true,
      text: `análise do Psicólogo não concluiu: ${payloadField(payload, 'reason') ?? 'motivo não informado'}`,
    };
  }
  if (type.startsWith('psychologist.')) {
    const alvo = payloadField(payload, 'agenteAlvo');
    const text =
      type === 'psychologist.hypothesis_proposed'
        ? `nova hipótese sobre ${alvo ?? 'um agente'}`
        : type === 'psychologist.hypothesis_accepted'
          ? `hipótese sobre ${alvo ?? 'um agente'} aceita`
          : type === 'psychologist.hypothesis_dismissed'
            ? `hipótese sobre ${alvo ?? 'um agente'} descartada`
            : type === 'psychologist.hypothesis_accepted_for_anamnese'
              ? `hipótese encaminhada para a Anamnese`
              : type === 'psychologist.analysis_completed'
                ? `análise do Psicólogo concluída (${payloadField(payload, 'tier') ?? 'triagem'})`
                : // Dispensada NÃO é falha: a sessão não tinha o que analisar.
                  // Pintar de `bad` treinaria quem lê o log a ignorar o
                  // evento de falha de verdade (mesma razão do
                  // `anamnese.run_skipped`).
                  type === 'psychologist.analysis_skipped'
                  ? `análise do Psicólogo dispensada: sessão sem eventos a analisar`
                  : `atividade em ${actorLabel}`;
    return {
      kind: 'hypothesis',
      icon: HypothesisIcon,
      color: 'var(--accent)',
      bad: false,
      text,
    };
  }
  if (type.includes('closed_abnormally')) {
    return {
      kind: 'session',
      icon: SessionIcon,
      color: 'var(--danger)',
      bad: true,
      text: 'Sessão encerrada de forma anormal',
    };
  }
  if (type.startsWith('permission.')) {
    const granted = type.includes('grant') || type.includes('always');
    return {
      kind: 'permission',
      icon: PermissionIcon,
      color: granted ? 'var(--success)' : 'var(--danger)',
      bad: !granted,
      text: granted
        ? `${actorLabel} concedeu permissão${payloadField(payload, 'pattern') ? ` para ${payloadField(payload, 'pattern')}` : ''}`
        : `${actorLabel} negou permissão`,
    };
  }
  // Ações git executadas viram `action.<kind>` (execute-git-action.use-case).
  // Sem estes ramos a PR de um dev — o evento central da fase de execução —
  // era narrada como "executou um comando", junto de qualquer terminal.
  if (type === 'action.pr_open') {
    return {
      kind: 'pr',
      icon: PrIcon,
      color: 'var(--accent)',
      bad: false,
      text: `${actorLabel} abriu PR${
        payloadField(payload, 'sourceBranch') ? ` de ${payloadField(payload, 'sourceBranch')}` : ''
      }`,
    };
  }
  if (type === 'action.git_commit' || type === 'action.git_push') {
    return {
      kind: 'commit',
      icon: CommitIcon,
      color: 'var(--text-secondary)',
      bad: false,
      text: `${actorLabel} ${type === 'action.git_commit' ? 'commitou' : 'publicou'}${
        payloadField(payload, 'branch') ? ` em ${payloadField(payload, 'branch')}` : ''
      }`,
    };
  }
  if (type.startsWith('action.') || type.startsWith('terminal')) {
    return {
      kind: 'terminal',
      icon: TerminalIcon,
      color: type.includes('failed') ? 'var(--danger)' : 'var(--text-secondary)',
      bad: type.includes('failed'),
      text: `${actorLabel} ${type.includes('failed') ? 'falhou ao executar comando' : 'executou um comando'}`,
    };
  }
  // Delegação de área (Fase 8b QA, Fase 8c Infra — ADR 0038): o lead
  // registra o desfecho de CADA delegado, separado do parecer/PR
  // consolidado que a área devolve pra fora. Antes do 8d caía no fallback
  // genérico ("qa · delegation.completed") — sem rótulo do subagente nem
  // do desfecho.
  if (type.startsWith('delegation.')) {
    const p = payload as DelegationEventPayload;
    const subagentLabel = AGENTS[p.subagent as keyof typeof AGENTS]?.name ?? p.subagent;
    if (type === 'delegation.completed') {
      return {
        kind: 'delegation',
        icon: BranchIcon,
        color: 'var(--success)',
        bad: false,
        text: `${subagentLabel} concluiu a delegação (${p.area})`,
      };
    }
    if (type === 'delegation.failed') {
      return {
        kind: 'delegation',
        icon: BranchIcon,
        color: 'var(--danger)',
        bad: true,
        text: `${subagentLabel} falhou — origem: ${p.failureOrigin ?? '?'}`,
      };
    }
    return {
      kind: 'delegation',
      icon: BranchIcon,
      color: 'var(--text-secondary)',
      bad: false,
      text: `${subagentLabel} dispensada — ${p.justification ?? 'sem justificativa'}`,
    };
  }

  // Tipo sem tradução específica: nunca mostra o tipo cru (`activity-catalog.test.ts`
  // quebra se um tipo do catálogo gerado cair aqui) — o humano lê "atividade
  // em X", não um identificador interno tipo "infra.foo_bar".
  return {
    kind: 'generic',
    icon: SessionIcon,
    color: 'var(--text-secondary)',
    bad: false,
    text: `atividade em ${actorLabel}`,
  };
}
