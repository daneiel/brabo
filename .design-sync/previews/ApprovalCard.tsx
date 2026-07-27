/*
 * Previews do ApprovalCard. A fábrica `acao` é a mesma de
 * apps/web/src/components/ApprovalCard.test.tsx (inclusive o comando
 * `rm -rf /tmp/build`, que é o caso que o teste usa para o estado pendente).
 *
 * Os três handlers são obrigatórios no contrato; aqui são no-ops porque o card
 * é estático. O que NÃO renderiza estaticamente é o textarea de motivo da
 * negação, que só aparece depois do clique em "Negar".
 */
import { ApprovalCard } from 'web';

type Acao = Parameters<typeof ApprovalCard>[0]['action'];

function acao(overrides: Partial<Acao> = {}): Acao {
  return {
    id: 'action-1',
    projectId: 'project-1',
    sessionId: 'session-1',
    seq: 1,
    actionType: 'terminal',
    payload: { command: 'rm -rf /tmp/build' },
    status: 'pending',
    resolvedPolicy: 'require_approval',
    actor: { kind: 'agent', id: 'dev-backend' },
    decidedBy: null,
    decidedAt: null,
    rejectionReason: null,
    executionResult: null,
    createdAt: '2026-07-26T14:12:00.000Z',
    updatedAt: '2026-07-26T14:12:00.000Z',
    ...overrides,
  } as Acao;
}

const noop = () => {};
const handlers = { onApprove: noop, onDeny: noop, onAlwaysAllow: noop };

/** O estado canônico: comando destrutivo esperando a autoridade do usuário. */
export function AguardandoAprovacao() {
  return <ApprovalCard action={acao()} {...handlers} />;
}

/** Na variante `chat` o card explica o efeito em permissions.json. */
export function NoChat() {
  return <ApprovalCard action={acao()} variant="chat" meta="há 2 minutos" {...handlers} />;
}

/** Urgência crítica — a cor entra por `--urgency-color`, setada em runtime. */
export function Critico() {
  return (
    <ApprovalCard
      action={acao({
        actionType: 'git_push',
        payload: { branch: 'main', remote: 'origin' },
      })}
      urgency="critico"
      meta="dev-backend · há 30 segundos"
      {...handlers}
    />
  );
}

/** Decidido: os botões saem e sobra o registro do que foi negado, e por quê. */
export function Negado() {
  return (
    <ApprovalCard
      action={acao({
        status: 'denied',
        rejectionReason: 'comando destrutivo fora do worktree do agente',
        decidedBy: 'user-1',
        decidedAt: '2026-07-26T14:13:10.000Z',
      })}
      {...handlers}
    />
  );
}

/** Patch de instrução da Anamnese: diff + rastro da hipótese que o originou. */
export function PatchDeInstrucao() {
  return (
    <ApprovalCard
      action={acao({
        actionType: 'instruction_patch',
        actor: { kind: 'agent', id: 'anamnese' },
        payload: {
          agent: 'dev-backend',
          fromVersion: 2,
          rationale: 'usuário é sênior em NestJS — explicação conceitual é ruído',
          hypothesisId: '01JEVHYP000000000000A1B2C3',
          files: [
            {
              path: 'dev-backend.md',
              additions: 1,
              deletions: 1,
              lines: [
                { kind: 'del', lineNo: 2, content: 'Explique cada conceito antes de aplicar.' },
                { kind: 'add', lineNo: 2, content: 'Assuma familiaridade com NestJS e Drizzle.' },
              ],
            },
          ],
        },
      })}
      {...handlers}
    />
  );
}

/** Na fila de aprovações o card é selecionável, para decidir em lote. */
export function SelecionavelNaFila() {
  return (
    <ApprovalCard
      action={acao()}
      variant="queue"
      selectable
      selected
      onToggleSelect={noop}
      meta="sessão #4 · dev-backend"
      {...handlers}
    />
  );
}
