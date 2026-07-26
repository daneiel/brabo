/*
 * Previews do PrGateTimeline — o stepper dev→qa→secops→você de uma PR de agente,
 * com os pareceres dos gates. `gateStatus` diz onde a PR parou; `verdicts` são
 * os pareceres já emitidos, e o do QA pode trazer a coverage_matrix.
 */
import { useEffect, useRef } from 'react';
import { PrGateTimeline } from 'web';

/*
 * Os pareceres nascem COLAPSADOS: o header de cada um é um <button> que abre o
 * corpo, e a coverage_matrix do QA só existe lá dentro. Sem expandir, a prop
 * `coverageMatrix` não produz saída visível nenhuma no card. O único <button>
 * do componente é justamente esse header, então clicar no primeiro depois do
 * mount abre o parecer do QA — síncrono no effect, sem depender de animação.
 */
function ParecerAberto({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button')?.click();
  }, []);
  return <div ref={ref}>{children}</div>;
}

type Props = Parameters<typeof PrGateTimeline>[0];
type Tarefa = Props['task'];
type Parecer = Props['verdicts'][number];
type Acao = NonNullable<Props['prAction']>;

const prAction = {
  id: 'action-9',
  projectId: 'project-1',
  sessionId: 'session-1',
  seq: 9,
  actionType: 'pr_open',
  payload: {
    title: 'expor oban_queue_depth no /metrics',
    sourceBranch: 'feature/dev-backend/oban-metrics',
    targetBranch: 'dev',
    url: 'https://github.com/acme/plataforma/pull/128',
  },
  status: 'executed',
  resolvedPolicy: 'require_approval',
  actor: { kind: 'agent', id: 'dev-backend' },
  decidedBy: 'user-1',
  decidedAt: '2026-07-26T13:20:00.000Z',
  rejectionReason: null,
  executionResult: null,
  createdAt: '2026-07-26T13:18:00.000Z',
  updatedAt: '2026-07-26T13:20:00.000Z',
} as Acao;

const tarefa = (overrides: Partial<Tarefa> = {}): Tarefa =>
  ({
    title: 'expor oban_queue_depth no /metrics',
    blocked: false,
    blockedReason: null,
    gateStatus: 'awaiting_qa',
    ...overrides,
  }) as Tarefa;

const parecerQa: Parecer = {
  seq: 11,
  gate: 'qa',
  veredito: 'approved',
  resumo: 'Cobertura do caminho feliz e de fila vazia; a métrica é lida do Oban, não calculada na mão.',
  itens: [
    'teste do caminho feliz com três filas populadas',
    'teste de fila vazia — a série tem que sair como 0, não ausente',
  ],
  coverageMatrix: [
    { rule: 'a métrica expõe uma série por fila', tests: ['oban_queue_depth_test.exs:14'], covered: true },
    { rule: 'fila vazia reporta 0', tests: ['oban_queue_depth_test.exs:38'], covered: true },
    { rule: 'a métrica sobrevive a restart do nó', tests: [], covered: false },
  ],
};

const parecerSecops: Parecer = {
  seq: 14,
  gate: 'secops',
  veredito: 'changes_requested',
  resumo: 'O endpoint /metrics está aberto sem restrição de origem.',
  itens: [
    'bloquear /metrics no Ingress de produção',
    'a NetworkPolicy tem que liberar só o namespace de monitoring',
  ],
};

/** Esperando o QA: o primeiro gate, sem nenhum parecer ainda. */
export function AguardandoQa() {
  return <PrGateTimeline task={tarefa()} prAction={prAction} verdicts={[]} />;
}

/** QA aprovou com coverage_matrix — inclusive uma regra descoberta. */
export function QaAprovou() {
  return (
    <PrGateTimeline
      task={tarefa({ gateStatus: 'awaiting_secops' })}
      prAction={prAction}
      verdicts={[parecerQa]}
    />
  );
}

/** SecOps pediu mudanças: a PR volta para o dev, e a task fica bloqueada. */
export function SecopsPediuMudancas() {
  return (
    <PrGateTimeline
      task={tarefa({
        gateStatus: 'awaiting_secops',
        blocked: true,
        blockedReason: 'SecOps pediu mudanças: /metrics exposto no Ingress',
      })}
      prAction={prAction}
      verdicts={[parecerQa, parecerSecops]}
    />
  );
}

/** Os dois gates passaram — o merge é decisão manual do usuário, sempre. */
export function AguardandoVoce() {
  return (
    <PrGateTimeline
      task={tarefa({ gateStatus: 'awaiting_user' })}
      prAction={prAction}
      verdicts={[parecerQa, { ...parecerSecops, veredito: 'approved', resumo: 'Sem exposição indevida após a correção.', itens: [] }]}
    />
  );
}

/** Parecer do QA aberto: é aqui que a coverage_matrix aparece de verdade —
 * inclusive a regra sem teste, que é o ponto de existir uma matriz. */
export function CoberturaDoQaAberta() {
  return (
    <ParecerAberto>
      <PrGateTimeline
        task={tarefa({ gateStatus: 'awaiting_secops' })}
        prAction={prAction}
        verdicts={[parecerQa]}
      />
    </ParecerAberto>
  );
}

/** Sem `prAction`: a task tem gate, mas a PR ainda não foi aberta. */
export function SemPr() {
  return <PrGateTimeline task={tarefa({ gateStatus: null })} verdicts={[]} />;
}
