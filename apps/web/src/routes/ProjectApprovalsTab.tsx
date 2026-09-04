import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  approveAction,
  approveAlwaysAction,
  denyAction,
  getProjectPermissions,
  setAgentAutonomy,
  setProjectPermissions,
} from '../lib/api-client';
import { useBacklog, useCurrentWorkspaceWithRole, useInfraArtifacts, useLatestSession, usePendingActions, useSessionEvents } from '../lib/hooks';
import {
  AGENT_AUTONOMY_ALL_ACTIONS,
  type CoverageMatrixRow,
  type PermissionListName,
  type QaVerdictPayload,
  type SecOpsVerdictPayload,
  type Task,
} from '../lib/api-types';
import { ApprovalCard } from '../components/ApprovalCard';
import { PrGateTimeline, type GateVerdict } from '../components/PrGateTimeline';
import { getRegistroDeGates } from '../lib/api-client';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Table, type TableColumn } from '../components/ui/Table';
import { Badge } from '../components/ui/Badge';
import { useToast } from '../components/ui/ToastProvider';
import { AlertCircleIcon, CheckIcon, SearchIcon, TrashIcon } from '../components/ui/icons';
import { ErroDeCarregamento } from '../components/ErroDeCarregamento';
import { AGENTS, AREAS } from '../lib/agents';
import type { DelegationEventPayload } from '../lib/api-types';
import styles from './ProjectApprovalsTab.module.css';

/** O mínimo de uma query do TanStack que o bloco abaixo consome. */
interface EstadoDaQuery<T> {
  data: T | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
}

/**
 * Os três estados da RN-088 em UMA peça, com o ERRO antes do vazio.
 *
 * Cada bloco desta aba tem query própria, e todos colapsavam os três: `data ??
 * []` seguido de `length === 0` fazia a api respondendo 429 dizer "Tudo limpo —
 * nenhuma aprovação pendente", que é a mentira mais cara que esta tela
 * específica pode contar.
 *
 * Só carregando e erro moram aqui. O VAZIO fica com quem chama, porque a frase
 * do vazio é diferente em cada bloco e é ela que explica de onde o dado viria.
 */
function BlocoDeDados<T>({
  query,
  titulo,
  carregando,
  children,
}: {
  query: EstadoDaQuery<T>;
  titulo: string;
  carregando?: string;
  children: (dado: T) => ReactNode;
}) {
  const { t } = useTranslation('approvals');
  const textoCarregando = carregando ?? t('approvalsTab.genericLoading');
  if (query.isError) {
    return (
      <ErroDeCarregamento
        titulo={titulo}
        erro={query.error}
        onTentarDeNovo={() => void query.refetch()}
      />
    );
  }
  if (query.data === undefined) {
    return <div className={styles.clean}>{textoCarregando}</div>;
  }
  return <>{children(query.data)}</>;
}

interface PermissionRow {
  pattern: string;
  list: PermissionListName;
}

interface ProjectApprovalsTabProps {
  projectId: string;
}

export function ProjectApprovalsTab({ projectId }: ProjectApprovalsTabProps) {
  const { t } = useTranslation('approvals');
  const sessionsQuery = useLatestSession(projectId);
  const latestSession = sessionsQuery.latest;
  const actionsQuery = usePendingActions(projectId, latestSession?.id);
  const eventsQuery = useSessionEvents(projectId, latestSession?.id);
  const backlogQuery = useBacklog(projectId);
  const infraQuery = useInfraArtifacts(projectId);
  const epics = backlogQuery.data;
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  // "Auto mode" (RN-153) exige `maintainer` no endpoint que grava a curinga —
  // mesma aproximação (papel de WORKSPACE) que `ProjectSettingsTab.tsx` já
  // usa pra gate de `maintainer`/`owner`: não existe hoje um papel de
  // PROJETO no cliente, só o de workspace que a listagem devolve.
  const { data: workspaceComPapel } = useCurrentWorkspaceWithRole();
  const podeAtivarAutoMode =
    workspaceComPapel?.role === 'owner' || workspaceComPapel?.role === 'maintainer';

  const allActions = actionsQuery.data?.items ?? [];
  const events = eventsQuery.data?.items ?? [];

  // Tasks que já entraram no fluxo de gate (Fase 4a) — bloqueadas ou com
  // gateStatus setado (mesmo já tendo chegado a awaiting_user).
  const gateTasks: Task[] = (epics ?? []).flatMap((epic) =>
    epic.stories.flatMap((story) =>
      story.tasks.filter((t) => t.gateStatus !== null || t.blocked),
    ),
  );

  function prActionFor(taskId: string) {
    return allActions
      .filter(
        (a) =>
          a.actionType === 'pr_open' &&
          (a.payload as { storyTaskId?: string }).storyTaskId === taskId,
      )
      .sort((a, b) => b.seq - a.seq)[0];
  }

  // Rótulo pro sub-parecer/dispensa dentro do card expandido — nome
  // reconhecido (AGENTS) quando o subagente é um dos conhecidos, senão o
  // id cru (mesma degradação graciosa do resto da UI pra agente
  // desconhecido).
  function labelFor(agentId: string): string {
    return AGENTS[agentId as keyof typeof AGENTS]?.name ?? agentId;
  }

  // Pareceres INTERNOS dos subagentes de QA (Fase 8b/8d) — mesmo `taskId`
  // do parecer consolidado, mas `actor.id` é a subespecialidade
  // (`qa-automacao`/`qa-performance-seguranca`), nunca `qa`. Ver `AREAS.qa.
  // members`.
  function subVerdictsFor(taskId: string): NonNullable<GateVerdict['subVerdicts']> {
    const membros: string[] = AREAS.qa.members;
    return events
      .filter((e) => e.type === 'artifact.qa_verdict' && membros.includes(e.actor.id))
      .filter((e) => (e.payload as { taskId?: string }).taskId === taskId)
      .sort((a, b) => a.seq - b.seq)
      .map((e) => {
        const payload = e.payload as QaVerdictPayload;
        return {
          agentId: e.actor.id,
          label: labelFor(e.actor.id),
          veredito: payload.veredito,
          resumo: payload.resumo,
          itens: payload.itens,
        };
      });
  }

  // Delegações DISPENSADAS da área de QA pra esta task (Fase 8b) — a
  // subespecialidade de Performance/Segurança quando a story não tem RNF
  // pertinente, sempre com justificativa (nunca silêncio).
  function dispensedFor(taskId: string): NonNullable<GateVerdict['dispensed']> {
    return events
      .filter((e) => e.type === 'delegation.dispensed')
      .filter((e) => {
        const payload = e.payload as DelegationEventPayload;
        return payload.area === 'qa' && payload.taskId === taskId;
      })
      .sort((a, b) => a.seq - b.seq)
      .map((e) => {
        const payload = e.payload as DelegationEventPayload;
        return {
          agentId: payload.subagent,
          label: labelFor(payload.subagent),
          justification: payload.justification ?? '',
        };
      });
  }

  // O card PRINCIPAL da timeline é só o parecer CONSOLIDADO — `actor.id ===
  // 'qa'`/`'secops'`. Antes do 8d isto filtrava só por tipo+taskId, e o
  // parecer INTERNO de cada subespecialidade (mesmo taskId, actor.id
  // diferente) vazava como um card "QA" a mais, indistinguível do
  // consolidado, numa story com RNF de performance (Fase 8b). Os internos
  // agora só aparecem dentro do expand (`subVerdictsFor`/`dispensedFor`).
  function verdictsFor(taskId: string): GateVerdict[] {
    return events
      .filter(
        (e) =>
          (e.type === 'artifact.qa_verdict' && e.actor.id === 'qa') ||
          (e.type === 'artifact.secops_verdict' && e.actor.id === 'secops'),
      )
      .filter((e) => {
        const payload = e.payload as { taskId?: string };
        return payload.taskId === taskId;
      })
      .sort((a, b) => a.seq - b.seq)
      .map((e) => {
        if (e.type === 'artifact.qa_verdict') {
          const payload = e.payload as QaVerdictPayload;
          return {
            seq: e.seq,
            gate: 'qa' as const,
            veredito: payload.veredito,
            resumo: payload.resumo,
            itens: payload.itens,
            coverageMatrix: payload.coverageMatrix as CoverageMatrixRow[] | undefined,
            subVerdicts: subVerdictsFor(taskId),
            dispensed: dispensedFor(taskId),
          };
        }
        const payload = e.payload as SecOpsVerdictPayload;
        return {
          seq: e.seq,
          gate: 'secops' as const,
          veredito: payload.veredito,
          resumo: payload.resumo,
          itens: payload.itens,
        };
      });
  }

  // PRs de infra (Fase 4a — InfraAgent), mesmo espírito de prActionFor/
  // verdictsFor mas chaveado por `prActionId` direto (o artefato de infra
  // já guarda o id da proposed_action, sem busca por payload).
  function infraPrActionFor(prActionId: string) {
    return allActions.find((a) => a.id === prActionId);
  }

  function infraVerdictsFor(prActionId: string): GateVerdict[] {
    return events
      .filter((e) => e.type === 'artifact.qa_verdict' || e.type === 'artifact.secops_verdict')
      .filter((e) => (e.payload as { prActionId?: string }).prActionId === prActionId)
      .sort((a, b) => a.seq - b.seq)
      .map((e) => {
        if (e.type === 'artifact.qa_verdict') {
          const payload = e.payload as QaVerdictPayload;
          return {
            seq: e.seq,
            gate: 'qa' as const,
            veredito: payload.veredito,
            resumo: payload.resumo,
            itens: payload.itens,
          };
        }
        const payload = e.payload as SecOpsVerdictPayload;
        return {
          seq: e.seq,
          gate: 'secops' as const,
          veredito: payload.veredito,
          resumo: payload.resumo,
          itens: payload.itens,
        };
      });
  }

  const permissionsQuery = useQuery({
    queryKey: ['permissions', projectId],
    queryFn: () => getProjectPermissions(projectId),
  });

  // O registro de gates (ADR 0054) — FASE 15b. SEM `projectId` na chave: o
  // registro é fato do produto, e cachear por projeto criaria N cópias do
  // mesmo. `staleTime` alto pelo mesmo motivo: ele muda quando o produto
  // muda, não durante a sessão de alguém.
  const gatesQuery = useQuery({
    queryKey: ['registro-de-gates'],
    queryFn: getRegistroDeGates,
    staleTime: 60 * 60 * 1000,
  });

  const pending = (actionsQuery.data?.items ?? []).filter((a) => a.status === 'pending');

  function invalidateActions() {
    queryClient.invalidateQueries({ queryKey: ['session-actions', projectId, latestSession?.id] });
  }

  async function handleApprove(actionId: string) {
    if (!latestSession) return;
    await approveAction(projectId, latestSession.id, actionId);
    invalidateActions();
  }
  async function handleDeny(actionId: string) {
    if (!latestSession) return;
    await denyAction(projectId, latestSession.id, actionId);
    invalidateActions();
  }
  async function handleAlwaysAllow(actionId: string) {
    if (!latestSession) return;
    await approveAlwaysAction(projectId, latestSession.id, actionId);
    invalidateActions();
    queryClient.invalidateQueries({ queryKey: ['permissions', projectId] });
  }

  // "Auto mode" (RN-153) — grava a curinga `actionType: "*"` pro agente que
  // propôs ESTA ação. NÃO aprova a ação em si (quem aprova é o botão
  // Aprovar); liga a autonomia pras PRÓXIMAS. Mesma `queryKey` que a Visão
  // Geral/Executores leem (`agent-autonomy`), então o toggle de lá já nasce
  // ligado sem um segundo clique — e é ele que serve de "desligar" depois.
  async function handleActivateAutoMode(agentId: string) {
    try {
      await setAgentAutonomy(projectId, {
        agentId,
        actionType: AGENT_AUTONOMY_ALL_ACTIONS,
        mode: 'auto_approve',
      });
      await queryClient.invalidateQueries({ queryKey: ['agent-autonomy', projectId] });
      showToast({ title: t('approvalsTab.toast.autoModeOnTitle'), message: agentId, tone: 'success' });
    } catch {
      showToast({
        title: t('approvalsTab.toast.autoModeOnErrorTitle'),
        message: agentId,
        tone: 'danger',
      });
    }
  }

  function toggleSelect(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function approveSelected() {
    if (!latestSession) return;
    await Promise.all(Array.from(selected).map((id) => approveAction(projectId, latestSession.id, id)));
    setSelected(new Set());
    invalidateActions();
  }

  async function revokeRule(row: PermissionRow) {
    if (!permissionsQuery.data) return;
    const updated = {
      ...permissionsQuery.data,
      [row.list]: permissionsQuery.data[row.list].filter((p) => p !== row.pattern),
    };
    await setProjectPermissions(projectId, updated);
    queryClient.invalidateQueries({ queryKey: ['permissions', projectId] });
  }

  const rows: PermissionRow[] = permissionsQuery.data
    ? (['allow', 'deny', 'ask'] as PermissionListName[]).flatMap((list) =>
        permissionsQuery.data![list].map((pattern) => ({ pattern, list })),
      )
    : [];
  const filteredRows = rows.filter((r) => r.pattern.toLowerCase().includes(search.toLowerCase()) || r.list.includes(search.toLowerCase()));

  const columns: TableColumn<PermissionRow>[] = [
    {
      key: 'pattern',
      label: t('approvalsTab.permissions.columnPattern'),
      width: '2.4fr',
      render: (r) => <span className={styles.pattern}>{r.pattern}</span>,
    },
    {
      key: 'type',
      label: t('approvalsTab.permissions.columnType'),
      width: '0.9fr',
      render: (r) => (
        <Badge square tone={r.list === 'deny' ? 'danger' : r.list === 'allow' ? 'success' : 'warning'}>
          {r.list}
        </Badge>
      ),
    },
    {
      key: 'action',
      label: t('approvalsTab.permissions.columnAction'),
      width: '64px',
      // Botão QUADRADO só de ícone, como no desenho — o rótulo "revogar" ao
      // lado do ícone comia a largura de uma coluna inteira. O nome acessível
      // carrega o padrão porque "Revogar" sozinho, repetido por linha, não diz
      // revogar o quê.
      render: (r) => (
        <button
          type="button"
          className={styles.revoke}
          title={t('approvalsTab.permissions.revoke')}
          aria-label={t('approvalsTab.permissions.revokeAriaLabel', { pattern: r.pattern })}
          onClick={() => revokeRule(r)}
        >
          <TrashIcon size={14} />
        </button>
      ),
    },
  ];

  return (
    <div>
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.title}>{t('approvalsTab.pending.title')}</h2>
          <span className={styles.eyebrow}>{t('approvalsTab.pending.eyebrow')}</span>
          <span className={styles.espacador} />
          {selected.size > 0 && (
            <div className={styles.selectionBar}>
              <span className={styles.selectionCount}>
                {t('approvalsTab.pending.selectedCount', { count: selected.size })}
              </span>
              <Button variant="success" onClick={approveSelected}>
                <CheckIcon size={15} />
                {t('approvalsTab.pending.approveSelected')}
              </Button>
              <Button variant="secondary" onClick={() => setSelected(new Set())}>
                {t('approvalsTab.pending.clear')}
              </Button>
            </div>
          )}
        </div>

        <BlocoDeDados
          query={sessionsQuery}
          titulo={t('approvalsTab.pending.sessionsError')}
          carregando={t('approvalsTab.pending.findingSession')}
        >
          {() =>
            !latestSession ? (
              <div className={styles.clean}>{t('approvalsTab.pending.noSession')}</div>
            ) : (
              <BlocoDeDados
                query={actionsQuery}
                titulo={t('approvalsTab.pending.queueError')}
                carregando={t('approvalsTab.pending.loadingQueue')}
              >
                {() =>
                  pending.length === 0 ? (
                    <div className={styles.vazioCard}>
                      <span className={styles.vazioIcone}>
                        <CheckIcon size={24} />
                      </span>
                      <p className={styles.vazioTexto}>{t('approvalsTab.pending.empty')}</p>
                    </div>
                  ) : (
                    <div className={styles.queue}>
                      {pending.map((action) => (
                        <ApprovalCard
                          key={action.id}
                          action={action}
                          variant="queue"
                          selectable
                          selected={selected.has(action.id)}
                          onToggleSelect={() => toggleSelect(action.id)}
                          onApprove={() => handleApprove(action.id)}
                          onDeny={() => handleDeny(action.id)}
                          onAlwaysAllow={() => handleAlwaysAllow(action.id)}
                          onActivateAutoMode={
                            podeAtivarAutoMode && action.actor.kind === 'agent'
                              ? () => handleActivateAutoMode(action.actor.id)
                              : undefined
                          }
                        />
                      ))}
                    </div>
                  )
                }
              </BlocoDeDados>
            )
          }
        </BlocoDeDados>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.title}>{t('approvalsTab.devPrs.title')}</h2>
          <span className={styles.eyebrow}>
            {t('approvalsTab.devPrs.eyebrow', { count: gateTasks.length })}
          </span>
        </div>

        <BlocoDeDados
          query={backlogQuery}
          titulo={t('approvalsTab.devPrs.backlogError')}
          carregando={t('approvalsTab.devPrs.loading')}
        >
          {() =>
            gateTasks.length === 0 ? (
              <div className={styles.clean}>{t('approvalsTab.devPrs.empty')}</div>
            ) : (
              <div className={styles.queue}>
                {gateTasks.map((task) => (
                  <PrGateTimeline
                    key={task.id}
                    task={task}
                    prAction={prActionFor(task.id)}
                    verdicts={verdictsFor(task.id)}
                    registro={gatesQuery.data}
                  />
                ))}
              </div>
            )
          }
        </BlocoDeDados>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.title}>{t('approvalsTab.infraPrs.title')}</h2>
          <span className={styles.eyebrow}>
            {t('approvalsTab.infraPrs.eyebrow', { count: (infraQuery.data ?? []).length })}
          </span>
        </div>

        <BlocoDeDados
          query={infraQuery}
          titulo={t('approvalsTab.infraPrs.error')}
          carregando={t('approvalsTab.infraPrs.loading')}
        >
          {(infraArtifacts) =>
            infraArtifacts.length === 0 ? (
              <div className={styles.clean}>{t('approvalsTab.infraPrs.empty')}</div>
            ) : (
              <div className={styles.queue}>
                {infraArtifacts.map((artifact) => (
                  <PrGateTimeline
                    key={artifact.id}
                    task={artifact}
                    prAction={infraPrActionFor(artifact.prActionId)}
                    verdicts={infraVerdictsFor(artifact.prActionId)}
                  />
                ))}
              </div>
            )
          }
        </BlocoDeDados>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.title}>{t('approvalsTab.permissions.title')}</h2>
          <span className={styles.eyebrow}>.brabo/permissions.json</span>
        </div>
        <p className={styles.subtitle}>{t('approvalsTab.permissions.subtitle')}</p>
        <div className={styles.banner}>
          <AlertCircleIcon size={15} className={styles.bannerIcone} />
          <span>
            {t('approvalsTab.permissions.bannerPrefix')} <b className={styles.deny}>deny</b>{' '}
            {t('approvalsTab.permissions.bannerMiddle')} <b className={styles.allow}>allow</b>
            {t('approvalsTab.permissions.bannerSuffix')}
          </span>
        </div>
        <div className={styles.searchRow}>
          <Input
            mono
            placeholder={t('approvalsTab.permissions.searchPlaceholder')}
            icon={<SearchIcon size={15} />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <BlocoDeDados
          query={permissionsQuery}
          titulo={t('approvalsTab.permissions.error')}
          carregando={t('approvalsTab.permissions.loading')}
        >
          {() => (
            <Table
              columns={columns}
              rows={filteredRows}
              rowKey={(r) => `${r.list}:${r.pattern}`}
              emptyMessage={
                rows.length === 0
                  ? t('approvalsTab.permissions.emptyNoRules')
                  : t('approvalsTab.permissions.emptyNoMatch')
              }
            />
          )}
        </BlocoDeDados>
      </div>
    </div>
  );
}
