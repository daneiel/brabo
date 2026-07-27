/*
 * Previews do HypothesisCard — uma hipótese do Psicólogo sobre um agente.
 * Os campos do domínio são em pt-BR (observacao/hipotese/sugestao), e
 * `evidenceEventIds` é o que torna a hipótese navegável até o event log.
 */
import { HypothesisCard } from 'web';

type Hipotese = Parameters<typeof HypothesisCard>[0]['hypothesis'];

const noop = () => {};

function hipotese(overrides: Partial<Hipotese> = {}): Hipotese {
  return {
    id: '01JEVHYP000000000000A1B2C3',
    projectId: 'project-1',
    sessionId: 'session-1',
    analysisId: 'analysis-1',
    agenteAlvo: 'dev-backend',
    observacao:
      'Em 4 das 5 últimas tarefas, o dev-backend pediu confirmação antes de escolher entre Drizzle e SQL cru.',
    hipotese:
      'A instrução do agente não diz qual é o default do projeto, então ele trata uma decisão já tomada como aberta.',
    sugestao:
      'Fixar na instrução que Drizzle é o padrão e SQL cru é exceção justificada em ADR.',
    confiancaPercent: 78,
    evidenceEventIds: ['evt-1042', 'evt-1088', 'evt-1131'],
    terminationAnalysis: null,
    status: 'proposed',
    decidedBy: null,
    decidedAt: null,
    createdAt: '2026-07-26T13:40:00.000Z',
    updatedAt: '2026-07-26T13:40:00.000Z',
    ...overrides,
  } as Hipotese;
}

/** Proposta, esperando decisão: é aqui que os dois botões aparecem. */
export function Proposta() {
  return (
    <HypothesisCard
      hypothesis={hipotese()}
      projectId="project-1"
      onAccept={noop}
      onDismiss={noop}
    />
  );
}

/** Confiança baixa — o card tem que deixar o número visível, não escondê-lo. */
export function ConfiancaBaixa() {
  return (
    <HypothesisCard
      hypothesis={hipotese({
        confiancaPercent: 34,
        agenteAlvo: 'qa',
        observacao: 'O QA reprovou duas PRs seguidas citando o mesmo item de cobertura.',
        hipotese: 'Pode ser rigor legítimo, e não um problema de instrução — evidência fraca.',
        sugestao: 'Aguardar mais duas rodadas antes de mexer na instrução do QA.',
        evidenceEventIds: ['evt-1201'],
      })}
      projectId="project-1"
      onAccept={noop}
      onDismiss={noop}
    />
  );
}

/** Aceita: decidida, com autor e data — sem botões. */
export function Aceita() {
  return (
    <HypothesisCard
      hypothesis={hipotese({
        status: 'accepted',
        decidedBy: 'user-1',
        decidedAt: '2026-07-26T14:02:00.000Z',
      })}
      projectId="project-1"
      onAccept={noop}
      onDismiss={noop}
    />
  );
}

/** Com análise de término: a hipótese nasceu de uma sessão que morreu. */
export function ComAnaliseDeTermino() {
  return (
    <HypothesisCard
      hypothesis={hipotese({
        agenteAlvo: 'infra',
        observacao: 'A sessão terminou durante um rollout do engine.',
        hipotese: 'O término não é comportamento do agente — é o drain do nó reciclando o pod.',
        sugestao: 'Não gerar patch de instrução para este caso; a causa é operacional.',
        confiancaPercent: 91,
        terminationAnalysis: {
          causa: 'node_shutdown',
          estadoDaSessao: 'closed_abnormally',
          analise:
            'Encerramento anormal de causa conhecida: o pod recebeu SIGTERM e drenou as sessões antes de sair.',
        },
      })}
      projectId="project-1"
      onAccept={noop}
      onDismiss={noop}
    />
  );
}
