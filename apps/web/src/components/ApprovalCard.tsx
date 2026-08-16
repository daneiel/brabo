import { useState, type CSSProperties } from 'react';
import type { ActionType, ProposedAction } from '../lib/api-types';
import { AGENTS } from '../lib/agents';
import { SEM_FRASE, descreverAcao } from '../lib/aprovacoes';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Disclosure } from './ui/Disclosure';
import { AlertIcon, ChevronRightIcon, DiffIcon, PrIcon, TerminalIcon } from './ui/icons';
import styles from './ApprovalCard.module.css';

export type ApprovalUrgency = 'critico' | 'alta' | 'normal';

const URGENCY_COLOR: Record<ApprovalUrgency, string> = {
  critico: 'var(--danger)',
  alta: 'var(--warning)',
  normal: 'var(--text-muted)',
};

// O mapa é exaustivo sobre `ActionType` de propósito: é o compilador que cobra
// a entrada quando o backend ganha um tipo novo. Enquanto a união do web era um
// subconjunto, os tipos do bootstrap de Gitflow caíam num `undefined` que
// derrubava a tela — e como a união VOLTOU a ficar defasada (`parallelize`,
// `raise_max_parallel`), a leitura também tem fallback: o compilador cobra o
// que ele enxerga, e a lista do backend está num arquivo que o web não importa.
//
// O verbo saiu daqui: mora em `lib/aprovacoes.ts` junto com a frase, porque
// quem consome os dois são três telas e não só este card (FASE 19).
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
  parallelize: AlertIcon,
  raise_max_parallel: AlertIcon,
};

/**
 * Os tipos com corpo visual PRÓPRIO — diff, comando, branches da PR. Para eles
 * o colapso guarda um detalhe rico; para o resto guarda o payload cru, e é o
 * default de aberto/fechado que muda entre os dois casos.
 */
const COM_CORPO_PROPRIO: ReadonlySet<string> = new Set<ActionType>([
  'terminal',
  'pr_open',
  'instruction_patch',
  'git_commit',
  'git_push',
  'write_file',
]);

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

/** Como `readString`, mas trata string vazia/só-espaço como ausente — é o que
 *  distingue "o modelo não preencheu o campo" de um valor real. */
function eValido(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '';
}

const PREVIEW_MAX_LINHAS = 25;
const PREVIEW_MAX_CARACTERES = 4000;

/** Preview do `content` de `write_file`: corta por linha PRIMEIRO (é código,
 *  não prosa) e por caractere depois, para uma única linha gigante não
 *  estourar o card. Nunca despeja o arquivo inteiro — RN-096 vale para
 *  qualquer payload, não só o genérico. */
function previewConteudo(content: string): {
  texto: string;
  truncado: boolean;
  totalLinhas: number;
  linhasMostradas: number;
} {
  const linhas = content.split('\n');
  const cortadoPorLinha = linhas.length > PREVIEW_MAX_LINHAS;
  let texto = cortadoPorLinha ? linhas.slice(0, PREVIEW_MAX_LINHAS).join('\n') : content;
  const cortadoPorCaractere = texto.length > PREVIEW_MAX_CARACTERES;
  if (cortadoPorCaractere) texto = texto.slice(0, PREVIEW_MAX_CARACTERES);
  return {
    texto,
    truncado: cortadoPorLinha || cortadoPorCaractere,
    totalLinhas: linhas.length,
    linhasMostradas: Math.min(PREVIEW_MAX_LINHAS, linhas.length),
  };
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
  /**
   * "Auto mode" (RN-153) — liga `agent_autonomy` com a curinga `actionType:
   * "*"` pro AGENTE desta ação: nenhum comando FUTURO dele precisa de
   * aprovação, até desligar. Ausente/`undefined` esconde o botão — é assim
   * que quem chama trata "sem papel maintainer" (o mesmo papel que já
   * protege `PUT .../agent-autonomy`): não passa o callback, sem duplicar a
   * checagem de papel aqui dentro.
   */
  onActivateAutoMode?: () => void;
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
  onActivateAutoMode,
}: ApprovalCardProps) {
  const [expandedFile, setExpandedFile] = useState<string | null>(null);

  const actor = AGENTS[action.actor.id as keyof typeof AGENTS];
  const actorLabel = actor?.name ?? action.actor.id;
  // Tipo que o web ainda não conhece não pode devolver `undefined` aqui: o
  // React trata isso como componente inválido e derruba a ÁRVORE, não o card.
  const Icon = ACTION_ICON[action.actionType] ?? AlertIcon;
  const isPending = action.status === 'pending';
  const podeSemprePermitir = action.actionType !== 'instruction_patch';
  const isCritical = urgency === 'critico';

  const payload = action.payload;
  const { verbo, frase } = descreverAcao(action.actionType, payload);
  const temCorpoProprio = COM_CORPO_PROPRIO.has(action.actionType);

  /*
   * O default do colapso sai de `variant` e `status`, que JÁ existem — nenhuma
   * prop nova (FASE 19, item 14). Não é economia de digitação: prop nova
   * obrigatória obrigaria a abrir os dois call sites, e um deles
   * (`SessionPage.tsx`) pertence a outra fase da mesma onda.
   *
   * A regra que os dois defaults expressam é uma só: abre o que ainda espera
   * decisão de quem está olhando. No chat a ação pendente é o assunto do
   * momento; na fila são N cards, e N detalhes abertos são de novo a parede de
   * texto que esta fase existe para desfazer. E o payload CRU nunca nasce
   * aberto, em variante nenhuma — despejar JSON é o defeito, não a densidade.
   */
  const detalheAberto = temCorpoProprio && variant === 'chat' && isPending;

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
          {/* Tipografia do handoff: nome do agente em título, verbo em corpo
              apagado. O verbo vem de `lib/aprovacoes.ts` — mesma fonte que a
              frase logo abaixo e que a aba Insights. */}
          <div className={styles.title}>
            <span className={styles.actorName}>{actorLabel}</span>
            <span className={styles.verb}>{verbo}</span>
          </div>
        </div>
        {urgency && (
          <span className={styles.urgency} style={{ ['--urgency-color' as string]: URGENCY_COLOR[urgency] }}>
            <span className={[styles.urgencyDot, isCritical && styles.pulsing].filter(Boolean).join(' ')} />
            {urgency}
          </span>
        )}
      </div>

      {/* A FRASE é a linha que responde "o que acontece se eu aprovar" — sempre
          visível, sempre antes de qualquer detalhe. Tipo que o web ainda não
          conhece não tem frase: aí a linha degrada para verbo + "ver detalhes",
          e o detalhe é o payload cru COLAPSADO. O que nunca mais acontece é o
          despejo de `chave: JSON.stringify(valor)` que estava aqui. */}
      <p className={styles.frase}>{frase ?? `${verbo} — ${SEM_FRASE}.`}</p>

      <Disclosure
        titulo={temCorpoProprio ? 'Detalhes' : 'Payload cru'}
        padraoAberto={detalheAberto}
        className={styles.detalhes}
        classNameCabecalho={styles.detalhesCabecalho}
        trailing={temCorpoProprio ? undefined : `${Object.keys(payload).length} campo(s)`}
      >
        <ApprovalBody
          actionType={action.actionType}
          payload={payload}
          executionResult={action.executionResult}
          expandedFile={expandedFile}
          onToggleFile={(path) => setExpandedFile((current) => (current === path ? null : path))}
        />
      </Disclosure>

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
            {/* "Auto mode" (RN-153) — só quando quem chama já confirmou papel
                maintainer e passou o callback; ausente some o botão em vez de
                desabilitar sem explicar (action.actor.kind === 'user' também
                cai aqui: não há AGENTE pra confiar). */}
            {onActivateAutoMode && (
              <Button variant="ghost" onClick={onActivateAutoMode}>
                Modo automático
              </Button>
            )}
          </div>
          {variant === 'chat' && podeSemprePermitir && (
            <span className={styles.note}>
              <AlertIcon size={12} />
              &quot;Sempre permitir&quot; grava a regra em .brabo/permissions.json
            </span>
          )}
          {variant === 'chat' && onActivateAutoMode && (
            <span className={styles.note}>
              <AlertIcon size={12} />
              &quot;Modo automático&quot; libera TODA ação futura de {actorLabel} sem perguntar —
              exceto merge em branch protegida, patch de instrução e paralelismo, que continuam
              sempre pedindo sua decisão. Dá pra desligar depois no card do agente.
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
    const command = readString(payload, 'command');
    const comandoValido = eValido(command);
    const compressionPct =
      executionResult?.compressedBytes != null && executionResult.rawBytes > 0
        ? Math.round((1 - executionResult.compressedBytes / executionResult.rawBytes) * 100)
        : null;

    return (
      <div className={`${styles.body} ${styles.bodyCode}`}>
        <div className={styles.commandLine}>
          {comandoValido ? (
            <>
              <span className={styles.prompt}>$</span> {command}
            </>
          ) : (
            // Payload malformado de verdade (o modelo produziu uma tool-call
            // sem `command`) — um prompt "$ " em branco lia como bug de
            // renderização, não como o que era: a ferramenta não recebeu
            // argumento nenhum.
            <span className={styles.vazio}>O modelo não produziu um comando válido para esta ação.</span>
          )}
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

  if (actionType === 'write_file') {
    const path = readString(payload, 'path');
    const caminhoValido = eValido(path);
    const content = readString(payload, 'content');
    const conteudoValido = eValido(content);

    // O corpo próprio existe para responder "o que vai ser escrito" sem um
    // clique — mas só quando há o que mostrar. Payload malformado (path ou
    // content ausente/vazio) degrada para a mesma mensagem clara do terminal,
    // nunca para um preview em branco.
    if (!caminhoValido || !conteudoValido) {
      const mensagem =
        !caminhoValido && !conteudoValido
          ? 'O modelo não produziu um caminho e um conteúdo válidos para esta ação.'
          : !caminhoValido
            ? 'O modelo não produziu um caminho válido para esta ação.'
            : 'O modelo não produziu um conteúdo válido para esta ação.';
      return (
        <div className={`${styles.body} ${styles.bodyCode}`}>
          <div className={styles.commandLine}>
            <span className={styles.vazio}>{mensagem}</span>
          </div>
        </div>
      );
    }

    const { texto: preview, truncado, totalLinhas, linhasMostradas } = previewConteudo(content);

    return (
      <div className={`${styles.body} ${styles.bodyCode}`}>
        <div className={styles.commandLine}>{path}</div>
        <div className={styles.outputBlock}>
          <div className={styles.outputHeader}>
            <span>preview do conteúdo</span>
            {truncado && (
              <span>
                {linhasMostradas} de {totalLinhas} linha(s)
              </span>
            )}
          </div>
          <div className={styles.outputBody}>
            {preview}
            {truncado ? '\n…' : ''}
          </div>
        </div>
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
            // Não migrado para o `Disclosure` do design system, de propósito
            // (Onda 4/frente H4): esta faixa gira o chevron com
            // `transform: rotate(90deg)` + transição (`.chevron.open`,
            // ApprovalCard.module.css) — o `Disclosure` genérico TROCA o
            // ícone (Right→Down), sem animação nenhuma. Forçar a migração
            // aqui apagaria a micro-interação sem ganho nenhum, já que a
            // exclusividade (só um arquivo aberto por vez) já vem de fora
            // (`expandedFile`), a mesma coisa que o `Disclosure` controlado
            // faria. O que ESTAVA faltando, e que não é peculiaridade
            // nenhuma — é o mesmo defeito que o `Disclosure` existe para
            // fechar —, era `aria-controls`/região nomeada: corrigido aqui
            // sem trocar de componente (RN-250).
            const idDiff = `arquivo-diff-${encodeURIComponent(file.path)}`;
            return (
              <div key={file.path}>
                {/* `<button>` e não `<div onClick>`: a faixa abre e fecha o
                    diff, e como div ela ficava fora da ordem de tabulação e
                    inacessível pelo teclado. */}
                <button
                  type="button"
                  className={styles.fileRow}
                  aria-expanded={open}
                  aria-controls={idDiff}
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
                {/* A região existe mesmo fechada — mesma razão do
                    `Disclosure`: `aria-controls` apontando para um id morto
                    é pior que não ter o atributo. */}
                <div id={idDiff} role="region" aria-label={file.path} hidden={!open}>
                  {open && file.lines && <DiffLines lines={file.lines} />}
                </div>
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

  /*
   * O resto — e o tipo que o web ainda não conhece.
   *
   * Aqui morava o defeito que a FASE 19 veio matar: uma linha por chave, com
   * `JSON.stringify` no valor, SEMPRE visível. Quem abria a fila de aprovações
   * lia `worktree: /workspaces/dev-api` e `coAuthor: Brabo User <…>` antes de
   * qualquer coisa que dissesse o que ia acontecer.
   *
   * A informação não some — some do caminho de leitura. Quem precisa do payload
   * abre o colapso; quem precisa decidir lê a frase e clica. E o JSON vem
   * INDENTADO, num bloco de código, porque o objetivo de mostrá-lo é ele ser
   * lido, não ocupar espaço.
   */
  const chaves = Object.keys(payload);
  if (chaves.length === 0) {
    return (
      <div className={styles.body}>
        <div className={styles.semPayload}>Esta ação não carrega payload.</div>
      </div>
    );
  }

  return (
    <div className={styles.body}>
      <pre className={styles.payloadCru}>{JSON.stringify(payload, null, 2)}</pre>
    </div>
  );
}
