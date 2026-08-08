import { describe, it, expect } from 'vitest';
import { etapasDaEsteira } from './PrGateTimeline';
import type { GateResumo, RegistroDeGates } from '../lib/api-types';

/**
 * FASE 15b: a esteira de PR na tela deixa de repetir a lista de etapas e passa
 * a derivá-la do registro de gates (ADR 0054).
 *
 * O que estes testes protegem não é o desenho — é a propriedade que motivou a
 * mudança: gate que sai do registro sai da tela sozinho, sem ninguém lembrar
 * de apagar a etapa.
 */
function gate(id: string, fluxo = 'pr'): GateResumo {
  return {
    id,
    fluxo,
    dono: 'area-qa',
    entrada: ['pr-aberta'],
    entregavel: 'veredito',
    aprovacaoHumana: false,
    severidade: 'block',
  };
}

function registro(gates: GateResumo[]): RegistroDeGates {
  return { version: 1, gates };
}

describe('etapasDaEsteira', () => {
  it('deriva as etapas dos gates de PR do registro', () => {
    const r = registro([
      gate('qa-verificada'),
      gate('secops-segura'),
      gate('merge-protegida'),
    ]);

    expect(etapasDaEsteira(r).map((e) => e.key)).toEqual([
      'dev',
      'qa',
      'secops',
      'user',
    ]);
  });

  it('gate que SAI do registro some da tela', () => {
    // O ponto da 15b. Antes, desativar o SecOps deixava uma etapa morta na
    // esteira até alguém lembrar de editar o componente.
    const r = registro([gate('qa-verificada'), gate('merge-protegida')]);

    expect(etapasDaEsteira(r).map((e) => e.key)).toEqual(['dev', 'qa', 'user']);
  });

  it('ignora gate de OUTRO fluxo', () => {
    // `story-promovida` é pre-dev; `pr-no-lugar-certo` é CI. Nenhum dos dois
    // pertence à esteira de uma PR de dev.
    const r = registro([
      gate('qa-verificada'),
      gate('story-promovida', 'pre-dev'),
      gate('pr-no-lugar-certo', 'ci'),
    ]);

    expect(etapasDaEsteira(r).map((e) => e.key)).toEqual(['dev', 'qa']);
  });

  it('os dois gates de infra não duplicam a etapa de QA', () => {
    // `infra-qa-verificada` e `qa-verificada` são gates distintos que a tela
    // mostra na MESMA etapa. Sem deduplicar, a esteira ganharia um "QA" a mais.
    const r = registro([gate('qa-verificada'), gate('qa-verificada')]);

    expect(etapasDaEsteira(r).map((e) => e.key)).toEqual(['dev', 'qa']);
  });

  it('gate de PR que a tela ainda não sabe desenhar é IGNORADO', () => {
    // O registro pode ganhar um gate de PR novo antes de a tela aprender a
    // desenhá-lo. Sem o filtro, ele entraria como uma etapa `undefined` — um
    // buraco na esteira, pior que a ausência.
    const r = registro([gate('qa-verificada'), gate('gate-que-ainda-nao-existe')]);

    expect(etapasDaEsteira(r).map((e) => e.key)).toEqual(['dev', 'qa']);
  });

  it('`dev` abre a esteira mesmo sem gate nenhum', () => {
    // Dev não é gate: é quem produz o que os gates julgam.
    expect(etapasDaEsteira(registro([])).map((e) => e.key)).toEqual(['dev']);
  });

  it('sem registro, mostra a esteira completa em vez de sumir', () => {
    // Carregando ou requisição falha: a esteira é informativa, e escondê-la
    // seria pior que mostrá-la sem a curadoria do registro.
    expect(etapasDaEsteira(undefined).map((e) => e.key)).toEqual([
      'dev',
      'qa',
      'secops',
      'user',
    ]);
  });

  it('os rótulos são de tela, não do registro', () => {
    const r = registro([gate('qa-verificada')]);
    expect(etapasDaEsteira(r).map((e) => e.label)).toEqual(['Dev', 'QA']);
  });
});
