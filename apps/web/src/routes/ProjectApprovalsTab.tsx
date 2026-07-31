import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { approveAction, approveAlwaysAction, denyAction, getProjectPermissions, setProjectPermissions } from '../lib/api-client';
import { useBacklog, useInfraArtifacts, useLatestSession, usePendingActions, useSessionEvents } from '../lib/hooks';
import type {
  CoverageMatrixRow,
  PermissionListName,
  QaVerdictPayload,
  SecOpsVerdictPayload,
  Task,
} from '../lib/api-types';
import { ApprovalCard } from '../components/ApprovalCard';
import { PrGateTimeline, type GateVerdict } from '../components/PrGateTimeline';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Table, type TableColumn } from '../components/ui/Table';
import { Badge } from '../components/ui/Badge';
import { CheckIcon, SearchIcon, TrashIcon } from '../components/ui/icons';
import { AGENTS, AREAS } from '../lib/agents';
import type { DelegationEventPayload } from '../lib/api-types';
import styles from './ProjectApprovalsTab.module.css';

interface PermissionRow {
  pattern: string;
  list: PermissionListName;
}

interface ProjectApprovalsTabProps {
  projectId: string;
}

export function ProjectApprovalsTab({ projectId }: ProjectApprovalsTabProps) {
  const { latest: latestSession } = useLatestSession(projectId);
  const actionsQuery = usePendingActions(projectId, latestSession?.id);
  const eventsQuery = useSessionEvents(projectId, latestSession?.id);
  const { data: epics } = useBacklog(projectId);
  const { data: infraArtifacts } = useInfraArtifacts(projectId);
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

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
    { key: 'pattern', label: 'Padrão', width: '2fr', render: (r) => <span style={{ fontFamily: 'var(--font-mono)' }}>{r.pattern}</span> },
    {
      key: 'type',
      label: 'Tipo',
      width: '110px',
      render: (r) => <Badge tone={r.list === 'deny' ? 'danger' : r.list === 'allow' ? 'success' : 'warning'}>{r.list}</Badge>,
    },
    {
      key: 'action',
      label: 'Ação',
      width: '90px',
      render: (r) => (
        <button type="button" className={styles.revoke} onClick={() => revokeRule(r)}>
          <TrashIcon size={14} /> revogar
        </button>
      ),
    },
  ];

  return (
    <div>
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <div className={styles.title}>Pendentes</div>
            <div className={styles.subtitle}>{pending.length} ordenadas por urgência</div>
          </div>
        </div>

        {selected.size > 0 && (
          <div className={styles.selectionBar}>
            <span>{selected.size} selecionadas</span>
            <Button variant="success" onClick={approveSelected}>
              Aprovar selecionados
            </Button>
          </div>
        )}

        {pending.length === 0 ? (
          <div className={styles.clean}>
            <CheckIcon size={22} />
            Tudo limpo — nenhuma aprovação pendente.
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
              />
            ))}
          </div>
        )}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <div className={styles.title}>PRs em revisão</div>
            <div className={styles.subtitle}>
              {gateTasks.length} PR(s) de dev agents passando pelos gates de QA/SecOps
            </div>
          </div>
        </div>

        {gateTasks.length === 0 ? (
          <div className={styles.clean}>Nenhuma PR de dev agent em revisão ainda.</div>
        ) : (
          <div className={styles.queue}>
            {gateTasks.map((task) => (
              <PrGateTimeline
                key={task.id}
                task={task}
                prAction={prActionFor(task.id)}
                verdicts={verdictsFor(task.id)}
              />
            ))}
          </div>
        )}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <div className={styles.title}>PRs de infra em revisão</div>
            <div className={styles.subtitle}>
              {(infraArtifacts ?? []).length} PR(s) de infra passando pelos gates de QA/SecOps
            </div>
          </div>
        </div>

        {(infraArtifacts ?? []).length === 0 ? (
          <div className={styles.clean}>Nenhuma PR de infra em revisão ainda.</div>
        ) : (
          <div className={styles.queue}>
            {(infraArtifacts ?? []).map((artifact) => (
              <PrGateTimeline
                key={artifact.id}
                task={artifact}
                prAction={infraPrActionFor(artifact.prActionId)}
                verdicts={infraVerdictsFor(artifact.prActionId)}
              />
            ))}
          </div>
        )}
      </div>

      <div className={styles.section}>
        <div className={styles.title}>Permissões do projeto</div>
        <div className={styles.subtitle} style={{ marginBottom: 12 }}>
          Regras gravadas em .brabo/permissions.json
        </div>
        <div className={styles.banner}>
          Ordem de avaliação: <b className={styles.deny}>deny</b> sempre vence <b className={styles.allow}>allow</b>, independente da ordem no arquivo.
        </div>
        <div className={styles.searchRow}>
          <Input placeholder="Buscar por padrão ou tipo…" icon={<SearchIcon size={14} />} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Table columns={columns} rows={filteredRows} rowKey={(r) => `${r.list}:${r.pattern}`} emptyMessage="Nenhuma regra configurada ainda." />
      </div>
    </div>
  );
}
