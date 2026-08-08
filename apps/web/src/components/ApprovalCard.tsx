import { useState, type CSSProperties } from 'react';
import type { ActionType, ProposedAction } from '../lib/api-types';
import { AGENTS } from '../lib/agents';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { AlertIcon, ChevronRightIcon, DiffIcon, PrIcon, TerminalIcon } from './ui/icons';
import styles from './ApprovalCard.module.css';

export type ApprovalUrgency = 'critico' | 'alta' | 'normal';

const URGENCY_COLOR: Record<ApprovalUrgency, string> = {
  critico: 'var(--danger)',
  alta: 'var(--warning)',
  normal: 'var(--text-muted)',
};

// Os dois mapas são exaustivos sobre `ActionType` de propósito: é o compilador
// que cobra a entrada quando o backend ganha um tipo novo. Enquanto a união do
// web era um subconjunto, os tipos do bootstrap de Gitflow caíam num
// `undefined` que derrubava a tela — o "fallback genérico" existia só no
// comentário.
const ACTION_VERB: Record<ActionType, string> = {
  terminal: 'quer executar comando',
  git_commit: 'propõe alteração',
  git_push: 'quer enviar alterações',
  pr_open: 'abriu pull request',
  spend: 'solicita gasto extra',
  git_repo_create: 'quer criar o repositório',
  git_branch_create: 'quer criar uma branch',
  git_branch_protect: 'quer proteger uma branch',
  write_file: 'propõe escrever um arquivo',
  open_adr_pr: 'abriu pull request de ADR',
  open_infra_pr: 'abriu pull request de infra',
  git_merge: 'quer fazer merge',
  instruction_patch: 'propõe ajustar a instrução de um agente',
};

const ACTION_ICON: Record<ActionType, typeof DiffIcon> = {
  terminal: TerminalIcon,
  git_commit: DiffIcon,
  git_push: DiffIcon,
  pr_open: PrIcon,
  spend: AlertIcon,
  git_repo_create: DiffIcon,
  git_branch_create: DiffIcon,
  git_branch_protect: AlertIcon,
  write_file: DiffIcon,
  open_adr_pr: PrIcon,
  open_infra_pr: PrIcon,
  git_merge: PrIcon,
  instruction_patch: DiffIcon,
};

interface DiffFile {
  path: string;
  additions: number;
  deletions: number;
  lines?: { kind: 'add' | 'del' | 'ctx'; content: string; lineNo?: number }[];
}

function readString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === 'string' ? value : undefined;
}

function readFiles(payload: Record<string, unknown>): DiffFile[] | undefined {
  const files = payload.files;
  if (!Array.isArray(files)) return undefined;
  return files as DiffFile[];
}

interface ApprovalCardProps {
  action: ProposedAction;
  urgency?: ApprovalUrgency;
  variant?: 'chat' | 'queue';
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  onApprove: () => void;
  onDeny: (reason?: string) => void;
  onAlwaysAllow: () => void;
}

export function ApprovalCard({
  action,
  urgency,
  variant = 'chat',
  selectable,
  selected,
  onToggleSelect,
  onApprove,
  onDeny,
  onAlwaysAllow,
}: ApprovalCardProps) {
  const [expandedFile, setExpandedFile] = useState<string | null>(null);

  const actor = AGENTS[action.actor.id as keyof typeof AGENTS];
  const actorLabel = actor?.name ?? action.actor.id;
  const Icon = ACTION_ICON[action.actionType];
  const isPending = action.status === 'pending';
  const podeSemprePermitir = action.actionType !== 'instruction_patch';
  const isCritical = urgency === 'critico';

  const payload = action.payload;

  return (
    <div
      className={[styles.card, variant === 'chat' && styles.chat, isCritical && styles.critical]
        .filter(Boolean)
        .join(' ')}
    >
      <div className={styles.header}>
        {selectable && (
          <input
            type="checkbox"
            className={styles.checkbox}
            checked={!!selected}
            onChange={onToggleSelect}
            aria-label="Selecionar para aprovação em lote"
          />
        )}
        <span className={styles.headerIcon}>
          <Icon size={15} />
        </span>
        <div className={styles.headerText}>
          {/* O verbo continua saindo de `ACTION_VERB` sem alteração — a FASE 19
              é dona do CONTEÚDO deste bloco. Aqui muda só a tipografia: nome do
              agente em título, verbo em corpo apagado, como no handoff. */}
          <div className={styles.title}>
            <span className={styles.actorName}>{actorLabel}</span>
            <span className={styles.verb}>{ACTION_VERB[action.actionType]}</span>
          </div>
        </div>
        {urgency && (
          <span className={styles.urgency} style={{ ['--urgency-color' as string]: URGENCY_COLOR[urgency] }}>
            <span className={[styles.urgencyDot, isCritical && styles.pulsing].filter(Boolean).join(' ')} />
            {urgency}
          </span>
        )}
      </div>

      <ApprovalBody
        actionType={action.actionType}
        payload={payload}
        executionResult={action.executionResult}
        expandedFile={expandedFile}
        onToggleFile={(path) => setExpandedFile((current) => (current === path ? null : path))}
      />

      {isPending ? (
        <>
          <div className={styles.actions}>
            <Button variant="success" onClick={onApprove}>
              Aprovar
            </Button>
            <Button variant="danger" onClick={() => onDeny()}>
              Negar
            </Button>
            {/* Patch de instrução NUNCA é auto-aprovável (teto em decide.ts):
                gravar a regra em permissions.json não muda nada, então o botão
                prometia um efeito que não existe. */}
            {podeSemprePermitir && (
              <Button variant="secondary" onClick={onAlwaysAllow}>
                Sempre permitir
              </Button>
            )}
          </div>
          {variant === 'chat' && podeSemprePermitir && (
            <span className={styles.note}>
              <AlertIcon size={12} />
              &quot;Sempre permitir&quot; grava a regra em .brabo/permissions.json
            </span>
          )}
        </>
      ) : (
        <DecidedLine action={action} />
      )}
    </div>
  );
}

function DecidedLine({ action }: { action: ProposedAction }) {
  if (action.status === 'denied') {
    return (
      <div className={styles.decided} style={{ ['--decided-color' as string]: 'var(--danger)' } as CSSProperties}>
        <span className={styles.decidedDot} />
        <span className={styles.decidedText}>Negado{action.rejectionReason ? ` · ${action.rejectionReason}` : ''}</span>
      </div>
    );
  }
  if (action.status === 'auto_approved' && action.resolvedPolicy === 'auto_approve') {
    return (
      <div className={styles.decided} style={{ ['--decided-color' as string]: 'var(--accent)' } as CSSProperties}>
        <span className={styles.decidedDot} />
        <span className={styles.decidedText}>Sempre permitido · gravado em permissions.json</span>
      </div>
    );
  }
  if (action.status === 'failed') {
    return (
      <div className={styles.decided} style={{ ['--decided-color' as string]: 'var(--danger)' } as CSSProperties}>
        <span className={styles.decidedDot} />
        <span className={styles.decidedText}>Falhou</span>
      </div>
    );
  }
  const text = action.actionType === 'terminal' ? 'Aprovado · comando em execução' : 'Aprovado';
  return (
    <div className={styles.decided} style={{ ['--decided-color' as string]: 'var(--success)' } as CSSProperties}>
      <span className={styles.decidedDot} />
      <span className={styles.decidedText}>{text}</span>
    </div>
  );
}

/**
 * As linhas do diff no formato unificado do handoff (seção 6): número à
 * direita numa calha de 34px, coluna de sinal de 14px, conteúdo em `pre`.
 *
 * Uma implementação só porque havia duas idênticas — a de `instruction_patch` e
 * a de `git_commit`/`git_push` —, e é assim que elas voltavam a divergir a cada
 * ajuste de medida.
 */
function DiffLines({ lines }: { lines: NonNullable<DiffFile['lines']> }) {
  return (
    <div className={styles.diffLines}>
      {lines.map((line, index) => (
        <div
          key={index}
          className={[styles.diffLine, line.kind === 'add' && styles.add, line.kind === 'del' && styles.del]
            .filter(Boolean)
            .join(' ')}
        >
          <span className={styles.lineNo}>{line.lineNo ?? ''}</span>
          <span
            className={[styles.sign, line.kind === 'add' && styles.add, line.kind === 'del' && styles.del]
              .filter(Boolean)
              .join(' ')}
          >
            {line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ''}
          </span>
          <span className={styles.diffContent}>{line.content}</span>
        </div>
      ))}
    </div>
  );
}

interface ApprovalBodyProps {
  actionType: ActionType;
  payload: Record<string, unknown>;
  executionResult: ProposedAction['executionResult'];
  expandedFile: string | null;
  onToggleFile: (path: string) => void;
}

function ApprovalBody({ actionType, payload, executionResult, expandedFile, onToggleFile }: ApprovalBodyProps) {
  if (actionType === 'terminal') {
    const command = readString(payload, 'command') ?? '';
    const compressionPct =
      executionResult?.compressedBytes != null && executionResult.rawBytes > 0
        ? Math.round((1 - executionResult.compressedBytes / executionResult.rawBytes) * 100)
        : null;

    return (
      <div className={`${styles.body} ${styles.bodyCode}`}>
        <div className={styles.commandLine}>
          <span className={styles.prompt}>$</span> {command}
        </div>
        {executionResult && (
          <div className={styles.outputBlock}>
            <div className={styles.outputHeader}>
              <span>terminal · output</span>
              {compressionPct !== null && compressionPct > 0 && <span>rtk −{compressionPct}%</span>}
            </div>
            <div className={styles.outputBody}>{executionResult.stdout || executionResult.stderr || '(sem saída)'}</div>
          </div>
        )}
      </div>
    );
  }

  if (actionType === 'pr_open') {
    const title = readString(payload, 'title') ?? 'Pull request';
    const source = readString(payload, 'sourceBranch') ?? '?';
    const target = readString(payload, 'targetBranch') ?? '?';
    const summary = readString(payload, 'summary');

    return (
      <div className={styles.body}>
        <div className={styles.prTitle}>{title}</div>
        <div className={styles.prBranches}>
          <span className={styles.branchPill}>{source}</span>
          <span className={styles.arrow} aria-hidden="true">
            →
          </span>
          <span className={styles.branchPill}>{target}</span>
        </div>
        {summary && <div className={styles.prSummary}>{summary}</div>}
      </div>
    );
  }

  if (actionType === 'instruction_patch') {
    const agentId = readString(payload, 'agent') ?? '?';
    const agent = AGENTS[agentId as keyof typeof AGENTS]?.name ?? agentId;
    const rationale = readString(payload, 'rationale');
    const hypothesisId = readString(payload, 'hypothesisId');
    const fromVersion = payload.fromVersion;
    // TODOS os arquivos, não só o primeiro: o payload de patch traz um por
    // arquivo de instrução, e o branch de git_commit já loopava — aqui um
    // segundo arquivo ficava invisível na hora de aprovar.
    const files = readFiles(payload) ?? [];

    return (
      <div className={styles.body}>
        <div className={styles.prTitle}>
          {agent}
          {typeof fromVersion === 'number' && (
            <span className={styles.branchPill} style={{ marginLeft: 8 }}>
              v{fromVersion} → v{fromVersion + 1}
            </span>
          )}
        </div>
        {/* Badge de origem: qual hipótese aceita do Psicólogo gerou este
            patch (rastreabilidade hipótese→patch→versão). */}
        {hypothesisId && (
          <div className={styles.prSummary}>
            <Badge tone="accent">
              origem: hipótese {hypothesisId.slice(-8)}
            </Badge>
          </div>
        )}
        {rationale && <div className={styles.prSummary}>{rationale}</div>}
        {files.map((file) => (
          <div key={file.path}>
            {files.length > 1 && (
              <div className={styles.prSummary}>{file.path}</div>
            )}
            {file.lines && <DiffLines lines={file.lines} />}
          </div>
        ))}
      </div>
    );
  }

  if (actionType === 'git_commit' || actionType === 'git_push') {
    const files = readFiles(payload);
    if (files && files.length > 0) {
      return (
        <div className={styles.body}>
          {files.map((file) => {
            const open = expandedFile === file.path;
            return (
              <div key={file.path}>
                {/* `<button>` e não `<div onClick>`: a faixa abre e fecha o
                    diff, e como div ela ficava fora da ordem de tabulação e
                    inacessível pelo teclado. */}
                <button
                  type="button"
                  className={styles.fileRow}
                  aria-expanded={open}
                  onClick={() => onToggleFile(file.path)}
                >
                  <span className={[styles.chevron, open && styles.open].filter(Boolean).join(' ')}>
                    <ChevronRightIcon size={14} />
                  </span>
                  <span className={styles.filePath}>{file.path}</span>
                  <span className={styles.diffStat}>
                    <span className={styles.diffAdd}>+{file.additions}</span>
                    <span className={styles.diffDel}>−{file.deletions}</span>
                  </span>
                </button>
                {open && file.lines && <DiffLines lines={file.lines} />}
              </div>
            );
          })}
        </div>
      );
    }
    const message = readString(payload, 'message') ?? readString(payload, 'branch') ?? '';
    return (
      <div className={`${styles.body} ${styles.bodyCode}`}>
        <div className={styles.commandLine}>{message || 'Sem detalhes adicionais.'}</div>
      </div>
    );
  }

  // spend e demais tipos sem variante visual específica no spec
  return (
    <div className={styles.body}>
      {Object.entries(payload).map(([key, value]) => (
        <div key={key} className={styles.genericLine}>
          {key}: {typeof value === 'object' ? JSON.stringify(value) : String(value)}
        </div>
      ))}
    </div>
  );
}
