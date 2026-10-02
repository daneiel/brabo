import { useContext, useRef, useState, type CSSProperties } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { useAutoriaDaSessao } from '../lib/autoria-da-sessao';
import { autorDaMensagem } from '../lib/autor-da-mensagem';
import { useTranslation } from 'react-i18next';
import type { ActionType, ProposedAction } from '../lib/api-types';
import { AGENTS } from '../lib/agents';
import { ApiError, mensagemDaApi } from '../lib/api-client';
import { SEM_FRASE, descreverAcao } from '../lib/aprovacoes';
import {
  fraseDaDecisaoDaPolitica,
  fraseDaDecisaoForaDoRecorte,
  type DecisaoDaPoliticaLida,
} from '../lib/decisao-da-politica';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { Disclosure } from './ui/Disclosure';
import {
  AlertIcon,
  ChevronRightIcon,
  DiffIcon,
  PrIcon,
  StopSquareIcon,
  TerminalIcon,
  TrashIcon,
} from './ui/icons';
import { podeOferecerSemprePermitir } from '../lib/sempre-permitir';
import { OQueOPilotoLibera } from './OQueOPilotoLibera';
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
  propose_execution_plan: AlertIcon,
  assess_implementability: AlertIcon,
  // Efeito externo de verdade — gasta infra (ADR 0130/0133), mesmo calibre
  // visual de `spend`/`parallelize`.
  container_start: AlertIcon,
  // ADR 0136 (RN-495) — a página global de containers.
  container_stop: StopSquareIcon,
  container_remove: TrashIcon,
  // RN-508 (ADR 0145) — mesmo calibre visual de `container_start`: sobe
  // container real, só que na máquina do usuário, via runner.
  container_start_via_runner: AlertIcon,
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
  // Onda 2 (aba PRs): antes caía no despejo de JSON cru — o mesmo defeito
  // que a RN-096 já tinha corrigido pros outros tipos.
  'git_merge',
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
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  /**
   * Os três callbacks podem devolver a PROMESSA da chamada (AT-256): é ela que
   * deixa o card segurar os botões enquanto a decisão está em voo e dizer, no
   * próprio card, a frase da api quando ela recusa — em especial o 409 de
   * `InvalidActionTransitionError`, de ação que já saiu de `pending` por outro
   * caminho (auto-aprovação, outra aba, o painel). Devolver `void` continua
   * valendo: o card só não sabe do desfecho.
   */
  onApprove: () => void | Promise<unknown>;
  onDeny: (reason?: string) => void | Promise<unknown>;
  onAlwaysAllow: () => void | Promise<unknown>;
  /**
   * "Auto mode" (RN-153) — liga `agent_autonomy` com a curinga `actionType:
   * "*"` pro AGENTE desta ação: nenhum comando FUTURO dele precisa de
   * aprovação, até desligar. Ausente/`undefined` esconde o botão — é assim
   * que quem chama trata "sem papel maintainer" (o mesmo papel que já
   * protege `PUT .../agent-autonomy`): não passa o callback, sem duplicar a
   * checagem de papel aqui dentro.
   */
  onActivateAutoMode?: () => void;
  /**
   * O motivo da política e a raiz do escopo (AT-148, RN-614), lidos do
   * `proposed_action.created` por `decisaoDaPoliticaDaAcao` — a ação em si
   * (`proposed_actions`) não guarda nenhum dos dois. Três estados, e eles não
   * colapsam: `undefined` = esta tela não lê o event log, e o card cala;
   * `null` = a tela lê, mas o evento não está entre os carregados, e o card
   * DIZ isso; objeto = a frase de `lib/decisao-da-politica.ts`.
   */
  decisaoDaPolitica?: DecisaoDaPoliticaLida | null;
  /**
   * O MOTIVO, em texto, de os controles estarem inertes (AT-265): quem chama
   * sabe que o papel de quem olha não alcança o mínimo do endpoint de decisão.
   * O que se tira é o controle, nunca a informação — o card continua mostrando
   * a ação inteira. `title` em botão `disabled` não abre no Chromium, então o
   * motivo é uma linha visível. Ausente = controles normais.
   */
  bloqueio?: string;
  /**
   * Quem EMPILHA vários cards (a fila da aba Aprovações, o painel "precisa de
   * você", as pendências de outras sessões — AT-318) pede o detalhe fechado:
   * N detalhes abertos são de novo a parede de texto, e empurravam os outros
   * cards para fora da vista. Ausente = aberto enquanto a ação espera decisão
   * (o fio da sessão, onde o card é o assunto do momento).
   *
   * É a ÚNICA diferença entre as superfícies, e ela é de ESTADO INICIAL de um
   * colapso, não de aparência: desde a AT-322 o card tem uma variante só —
   * mesmos botões, mesma largura natural deles, mesmas notas. Quem decide a
   * largura do card é o CONTÊINER (o fio o centraliza em 560px, RN-173).
   */
  detalheRecolhido?: boolean;
}

export function ApprovalCard({
  action,
  urgency,
  selectable,
  selected,
  onToggleSelect,
  onApprove,
  onDeny,
  onAlwaysAllow,
  onActivateAutoMode,
  decisaoDaPolitica,
  bloqueio,
  detalheRecolhido,
}: ApprovalCardProps) {
  const { t } = useTranslation('approvals');
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  // AT-256. `emVoo` segura o duplo clique (a segunda chamada era um 409 certo);
  // `recusa` guarda a frase da api; `obsoleta` é o 409 — a ação JÁ não está
  // `pending` no servidor, e o card fica inerte até a lista chegar e trocá-lo
  // pela linha de desfecho. A `ref` fecha a janela entre o clique e o render.
  const [emVoo, setEmVoo] = useState(false);
  const [recusa, setRecusa] = useState<string | null>(null);
  const [obsoleta, setObsoleta] = useState(false);
  const travaRef = useRef(false);

  async function decidir(chamada: () => void | Promise<unknown>) {
    if (travaRef.current) return;
    travaRef.current = true;
    setEmVoo(true);
    setRecusa(null);
    try {
      await chamada();
    } catch (erro) {
      setRecusa(mensagemDaApi(erro));
      if (erro instanceof ApiError && erro.status === 409) setObsoleta(true);
    } finally {
      travaRef.current = false;
      setEmVoo(false);
    }
  }
  const inerte = emVoo || obsoleta || !!bloqueio;

  const actor = AGENTS[action.actor.id as keyof typeof AGENTS];
  const actorLabel = actor?.name ?? action.actor.id;
  // RN-705: ator humano é nomeado pela leitura de membros (RN-655), nunca
  // pelo UUID. Sem `QueryClient` (teste isolado do card) fica o id.
  const temQueryClient = useContext(QueryClientContext) !== undefined;
  // Tipo que o web ainda não conhece não pode devolver `undefined` aqui: o
  // React trata isso como componente inválido e derruba a ÁRVORE, não o card.
  const Icon = ACTION_ICON[action.actionType] ?? AlertIcon;
  const isPending = action.status === 'pending';
  // Tipos do teto (git tipado, `container_remove`, `instruction_patch`,
  // paralelismo — AT-320): a api recusa (400) gravar o padrão de "sempre
  // permitir" pra eles, então mostrar o botão prometeria um efeito que o
  // clique não produz. A lista é a da api, conferida por teste.
  const podeSemprePermitir = podeOferecerSemprePermitir(action.actionType);
  // Mesma regra de `ehDevDeModulo`/`DEV_LEAD` em
  // `apps/api/src/domain/agents/agent-areas.ts` (RN-507) — sem cópia gerada
  // pro web porque só ESTE componente precisa saber, e só pra trocar o
  // TEXTO da nota (a api decide o destino da gravação sozinha). `dev-lead`
  // lidera a área de `dev`, mas não é membro dela — continua no texto de
  // sempre (permissions.json de projeto inteiro).
  const ehAgenteDeModulo =
    action.actor.kind === 'agent' &&
    action.actor.id.startsWith('dev-') &&
    action.actor.id !== 'dev-lead';
  const isCritical = urgency === 'critico';

  const payload = action.payload;
  const { verbo, trechos } = descreverAcao(action.actionType, payload);
  const temCorpoProprio = COM_CORPO_PROPRIO.has(action.actionType);

  /*
   * A regra do colapso é uma só: abre o que ainda espera decisão de quem está
   * olhando, salvo quando quem chama empilha N cards (`detalheRecolhido`). E o
   * payload CRU nunca nasce aberto, em superfície nenhuma — despejar JSON é o
   * defeito, não a densidade.
   */
  const detalheAberto = temCorpoProprio && isPending && !detalheRecolhido;

  return (
    <Card
      padding="none"
      recorta
      className={[styles.card, isCritical && styles.critical].filter(Boolean).join(' ')}
    >
      <div className={styles.header}>
        {selectable && (
          <input
            type="checkbox"
            className={styles.checkbox}
            checked={!!selected}
            onChange={onToggleSelect}
            aria-label={t('approvalCard.batchSelectAriaLabel')}
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
            <span className={styles.actorName}>
              {temQueryClient && action.actor.kind === 'user' ? (
                <NomeDoMembroAtor action={action} />
              ) : (
                actorLabel
              )}
            </span>
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
      <p className={styles.frase}>
        {trechos
          ? trechos.map((trecho, indice) =>
              // AT-322: comando, branch e caminho em mono e SEM aspas — a aspa
              // reta em fonte proporcional se lia como parte do comando.
              trecho.codigo ? (
                <code key={indice} className={styles.codigoNaFrase}>
                  {trecho.texto}
                </code>
              ) : (
                trecho.texto
              ),
            )
          : `${verbo} — ${SEM_FRASE}.`}
      </p>

      {/* AT-148 (RN-614): QUAL regra decidiu e, em `terminal`, contra qual
          raiz relativa — a MESMA frase da linha do evento no painel de log. */}
      {decisaoDaPolitica !== undefined && (
        <p className={styles.motivoDaPolitica} data-testid="motivo-da-politica">
          {decisaoDaPolitica === null
            ? fraseDaDecisaoForaDoRecorte()
            : fraseDaDecisaoDaPolitica(decisaoDaPolitica)}
        </p>
      )}

      <Disclosure
        titulo={temCorpoProprio ? t('approvalCard.details.title') : t('approvalCard.details.rawPayloadTitle')}
        padraoAberto={detalheAberto}
        className={styles.detalhes}
        classNameCabecalho={styles.detalhesCabecalho}
        trailing={
          temCorpoProprio
            ? undefined
            : t('approvalCard.details.fieldCount', { count: Object.keys(payload).length })
        }
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
            <Button variant="success" disabled={inerte} onClick={() => void decidir(() => onApprove())}>
              {t('approvalCard.actions.approve')}
            </Button>
            <Button variant="danger" disabled={inerte} onClick={() => void decidir(() => onDeny())}>
              {t('approvalCard.actions.deny')}
            </Button>
            {/* Patch de instrução NUNCA é auto-aprovável (teto em decide.ts):
                gravar a regra em permissions.json não muda nada, então o botão
                prometia um efeito que não existe. */}
            {podeSemprePermitir && (
              <Button variant="secondary" disabled={inerte} onClick={() => void decidir(() => onAlwaysAllow())}>
                {t('approvalCard.actions.alwaysAllow')}
              </Button>
            )}
            {/* "Auto mode" (RN-153) — só quando quem chama já confirmou papel
                maintainer e passou o callback; ausente some o botão em vez de
                desabilitar sem explicar (action.actor.kind === 'user' também
                cai aqui: não há AGENTE pra confiar). */}
            {onActivateAutoMode && (
              <Button variant="ghost" disabled={inerte} onClick={onActivateAutoMode}>
                {t('approvalCard.actions.autoMode')}
              </Button>
            )}
          </div>
          {/* AT-256: a frase da api, no card — nunca um toast genérico. Vale em
              toda superfície; `obsoleta` diz o porquê de os botões estarem
              inertes (o `title` de botão desabilitado não abre no Chromium). */}
          {bloqueio && (
            <p className={styles.note} data-testid="bloqueio-da-decisao">
              <AlertIcon size={14} className={styles.noteIcon} />
              <span>{bloqueio}</span>
            </p>
          )}
          {recusa && (
            <p className={styles.recusa} role="alert" data-testid="recusa-da-decisao">
              <AlertIcon size={14} className={styles.noteIcon} />
              <span>
                {recusa}
                {obsoleta && ` ${t('approvalCard.notes.obsolete')}`}
              </span>
            </p>
          )}
          {/* AT-322: a nota de "Sempre permitir" sai em TODA superfície onde o
              botão sai — antes só no fio, e a mesma decisão tinha texto numa
              tela e nenhum na outra. O texto só muda com o ATOR (RN-509), nunca
              com a tela. */}
          {podeSemprePermitir && (
            <p className={styles.note} data-testid="nota-sempre-permitir">
              <AlertIcon size={14} className={styles.noteIcon} />
              <span>
                {ehAgenteDeModulo
                  ? t('approvalCard.notes.alwaysAllowScoped', { agent: actorLabel })
                  : t('approvalCard.notes.alwaysAllow')}
              </span>
            </p>
          )}
          {/* A nota do modo automático sai onde o botão sai (RN-603): é a
              única frase que diz, antes do clique, o que o botão libera. Desde
              a RN-670 (ADR 0189) a lista inteira — o que o piloto libera e o
              que não libera — vem junto, a MESMA dos Executores e do card do
              agente. */}
          {onActivateAutoMode && (
            <>
              <p className={styles.note} data-testid="nota-modo-automatico">
                <AlertIcon size={14} className={styles.noteIcon} />
                <span>{t('approvalCard.notes.autoMode', { actor: actorLabel })}</span>
              </p>
              <OQueOPilotoLibera recolhido />
            </>
          )}
        </>
      ) : (
        <DecidedLine action={action} />
      )}
    </Card>
  );
}

function DecidedLine({ action }: { action: ProposedAction }) {
  const { t } = useTranslation('approvals');
  if (action.status === 'denied') {
    return (
      <div className={styles.decided} style={{ ['--decided-color' as string]: 'var(--danger)' } as CSSProperties}>
        <span className={styles.decidedDot} />
        <span className={styles.decidedText}>
          {t('approvalCard.decided.denied')}
          {action.rejectionReason ? ` · ${action.rejectionReason}` : ''}
        </span>
      </div>
    );
  }
  if (action.status === 'auto_approved' && action.resolvedPolicy === 'auto_approve') {
    return (
      <div className={styles.decided} style={{ ['--decided-color' as string]: 'var(--accent)' } as CSSProperties}>
        <span className={styles.decidedDot} />
        <span className={styles.decidedText}>{t('approvalCard.decided.alwaysAllowed')}</span>
      </div>
    );
  }
  if (action.status === 'failed') {
    return (
      <div className={styles.decided} style={{ ['--decided-color' as string]: 'var(--danger)' } as CSSProperties}>
        <span className={styles.decidedDot} />
        <span className={styles.decidedText}>{t('approvalCard.decided.failed')}</span>
      </div>
    );
  }
  const text =
    action.actionType === 'terminal'
      ? t('approvalCard.decided.approvedTerminal')
      : t('approvalCard.decided.approved');
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
  const { t } = useTranslation('approvals');
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
            <span className={styles.vazio}>{t('approvalCard.body.terminal.invalidCommand')}</span>
          )}
        </div>
        {executionResult && (
          <div className={styles.outputBlock}>
            <div className={styles.outputHeader}>
              <span>{t('approvalCard.body.terminal.outputHeader')}</span>
              {compressionPct !== null && compressionPct > 0 && (
                <span>{t('approvalCard.body.terminal.compression', { percent: compressionPct })}</span>
              )}
            </div>
            <div className={styles.outputBody}>
              {executionResult.stdout || executionResult.stderr || t('approvalCard.body.terminal.emptyOutput')}
            </div>
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
          ? t('approvalCard.body.writeFile.invalidBoth')
          : !caminhoValido
            ? t('approvalCard.body.writeFile.invalidPath')
            : t('approvalCard.body.writeFile.invalidContent');
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
            <span>{t('approvalCard.body.writeFile.previewHeader')}</span>
            {truncado && (
              <span>
                {t('approvalCard.body.writeFile.linesTruncated', { shown: linhasMostradas, count: totalLinhas })}
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
    const title = readString(payload, 'title') ?? t('approvalCard.body.prOpen.defaultTitle');
    const source = readString(payload, 'sourceBranch') ?? '?';
    const target = readString(payload, 'targetBranch') ?? '?';
    const summary = readString(payload, 'summary');

    return (
      <div className={styles.body}>
        <div className={styles.prTitle}>{title}</div>
        <div className={styles.prBranches}>
          <Badge tone="neutral" square size="md">{source}</Badge>
          <span className={styles.arrow} aria-hidden="true">
            →
          </span>
          <Badge tone="neutral" square size="md">{target}</Badge>
        </div>
        {summary && <div className={styles.prSummary}>{summary}</div>}
      </div>
    );
  }

  if (actionType === 'git_merge') {
    const pr = readString(payload, 'pullRequestId');
    const source = readString(payload, 'sourceBranch');
    const target = readString(payload, 'targetBranch');
    const title = readString(payload, 'title');

    return (
      <div className={styles.body}>
        <div className={styles.prTitle}>
          {title ??
            (pr
              ? t('approvalCard.body.gitMerge.prTitle', { pr })
              : t('approvalCard.body.gitMerge.defaultTitle'))}
        </div>
        <div className={styles.prBranches}>
          <Badge tone="neutral" square size="md">{source ?? '?'}</Badge>
          <span className={styles.arrow} aria-hidden="true">
            →
          </span>
          <Badge tone="neutral" square size="md">{target ?? '?'}</Badge>
        </div>
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
            <Badge tone="neutral" square size="md" style={{ marginLeft: 8 }}>
              v{fromVersion} → v{fromVersion + 1}
            </Badge>
          )}
        </div>
        {/* Badge de origem: qual hipótese aceita do Psicólogo gerou este
            patch (rastreabilidade hipótese→patch→versão). */}
        {hypothesisId && (
          <div className={styles.prSummary}>
            <Badge tone="accent">
              {t('approvalCard.body.instructionPatch.hypothesisOrigin', { id: hypothesisId.slice(-8) })}
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
        <div className={styles.commandLine}>{message || t('approvalCard.body.gitCommitPush.noDetails')}</div>
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
        <div className={styles.semPayload}>{t('approvalCard.body.empty')}</div>
      </div>
    );
  }

  return (
    <div className={styles.body}>
      <pre className={styles.payloadCru}>{JSON.stringify(payload, null, 2)}</pre>
    </div>
  );
}

/**
 * O nome de quem propôs, quando é uma PESSOA (RN-705): a mesma leitura de
 * membros do fio da sessão (RN-652/655). Quem a tela não sabe nomear vira
 * "outro membro", nunca o UUID cru.
 */
function NomeDoMembroAtor({ action }: { action: ProposedAction }) {
  const { t } = useTranslation('approvals');
  const autoria = useAutoriaDaSessao(action.projectId);
  const autor = autorDaMensagem(action.actor, autoria);
  if (autor.tipo === 'voce') return <>{autor.nome ?? t('approvalCard.actorYou')}</>;
  if (autor.tipo === 'membro') return <>{autor.nome}</>;
  if (autor.tipo === 'outroMembro') return <>{t('approvalCard.actorOtherMember')}</>;
  return <>{action.actor.id}</>;
}
