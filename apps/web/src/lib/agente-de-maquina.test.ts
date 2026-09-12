import { describe, expect, it } from 'vitest';
import type { RunnerDeviceKeyListItem } from './api-types';
import {
  maquinaJaPareada,
  podeLerChavesDeDispositivo,
  reconhecerAgenteDeMaquina,
} from './agente-de-maquina';

/**
 * O reconhecimento de agente local de MÁQUINA já pareado (RN-548, ADR 0154).
 *
 * A derivação está aqui, fora do componente, e é aqui que ela é provada: o que
 * o painel faz com o resultado é desenho, e tem prova própria em
 * `RunnerOnboardingPanel.test.tsx`.
 */

function chave(parcial: Partial<RunnerDeviceKeyListItem> = {}): RunnerDeviceKeyListItem {
  return {
    id: 'chave-1',
    name: 'laptop',
    projectId: null,
    especie: 'maquina',
    createdAt: '2026-09-01T10:00:00.000Z',
    revokedAt: null,
    lastUsedAt: null,
    ...parcial,
  };
}

describe('reconhecerAgenteDeMaquina — caminho feliz', () => {
  it('chave de máquina ativa e já usada: pareada, com o uso MAIS RECENTE', () => {
    const resultado = reconhecerAgenteDeMaquina({
      papel: 'developer',
      carregando: false,
      chaves: [
        chave({ id: 'a', name: 'laptop', lastUsedAt: '2026-09-01T12:00:00.000Z' }),
        chave({ id: 'b', name: 'desktop', lastUsedAt: '2026-09-10T08:00:00.000Z' }),
      ],
    });

    expect(resultado).toEqual({
      estado: 'pareada',
      nomes: ['laptop', 'desktop'],
      ultimoUso: '2026-09-10T08:00:00.000Z',
    });
    expect(maquinaJaPareada(resultado)).toBe(true);
  });
});

describe('reconhecerAgenteDeMaquina — os estados não colapsam (RN-088/RN-470)', () => {
  it('papel abaixo de developer: `semPapel`, e a tela nem pergunta', () => {
    expect(podeLerChavesDeDispositivo('viewer')).toBe(false);
    expect(podeLerChavesDeDispositivo('developer')).toBe(true);
    expect(podeLerChavesDeDispositivo(undefined)).toBe(false);

    expect(
      reconhecerAgenteDeMaquina({ papel: 'viewer', carregando: false, chaves: [chave()] }),
    ).toEqual({ estado: 'semPapel' });
  });

  it('403 da api também é `semPapel`: o papel de workspace é proxy, a api é a autoridade', () => {
    expect(
      reconhecerAgenteDeMaquina({
        papel: 'maintainer',
        carregando: false,
        chaves: undefined,
        falhou: true,
        statusDoErro: 403,
      }),
    ).toEqual({ estado: 'semPapel' });
  });

  it('consulta falhada NUNCA vira "não tem" — vira `naoSei`', () => {
    expect(
      reconhecerAgenteDeMaquina({
        papel: 'developer',
        carregando: false,
        chaves: undefined,
        falhou: true,
        statusDoErro: 500,
      }),
    ).toEqual({ estado: 'naoSei' });
  });

  it('falha SEM status (erro de rede) também é `naoSei`, e não fica girando em `verificando`', () => {
    expect(
      reconhecerAgenteDeMaquina({
        papel: 'developer',
        carregando: false,
        chaves: undefined,
        falhou: true,
        statusDoErro: null,
      }),
    ).toEqual({ estado: 'naoSei' });
  });

  it('em voo é `verificando`, e sem resposta também — nenhum dos dois afirma nada', () => {
    expect(
      reconhecerAgenteDeMaquina({ papel: 'developer', carregando: true, chaves: undefined }),
    ).toEqual({ estado: 'verificando' });
    expect(
      reconhecerAgenteDeMaquina({ papel: 'developer', carregando: false, chaves: undefined }),
    ).toEqual({ estado: 'verificando' });
  });

  it('só chave de PROJETO: `semChaveDeMaquina` — a espécie é o que decide, não a presença', () => {
    const resultado = reconhecerAgenteDeMaquina({
      papel: 'developer',
      carregando: false,
      chaves: [
        chave({ especie: 'projeto', projectId: 'proj-1', lastUsedAt: '2026-09-01T12:00:00.000Z' }),
      ],
    });

    expect(resultado).toEqual({ estado: 'semChaveDeMaquina' });
    expect(maquinaJaPareada(resultado)).toBe(false);
  });

  it('chave de máquina REVOGADA não é pareamento, e tem estado próprio', () => {
    const resultado = reconhecerAgenteDeMaquina({
      papel: 'developer',
      carregando: false,
      chaves: [chave({ name: 'laptop', revokedAt: '2026-09-05T00:00:00.000Z' })],
    });

    expect(resultado).toEqual({ estado: 'revogada', nomes: ['laptop'] });
    expect(maquinaJaPareada(resultado)).toBe(false);
  });

  it('ativa e nunca usada é a ÓRFÃ da RN-519 na espécie nova — não é "pareada e funcionando"', () => {
    const resultado = reconhecerAgenteDeMaquina({
      papel: 'developer',
      carregando: false,
      chaves: [chave({ name: 'laptop', lastUsedAt: null })],
    });

    expect(resultado).toEqual({ estado: 'pareadaNuncaUsada', nomes: ['laptop'] });
    // Já pareada mesmo assim: o gesto é subir o agente, não parear de novo.
    expect(maquinaJaPareada(resultado)).toBe(true);
  });

  it('uma revogada e uma ativa: manda a ATIVA, e só ela é nomeada', () => {
    expect(
      reconhecerAgenteDeMaquina({
        papel: 'developer',
        carregando: false,
        chaves: [
          chave({ id: 'velha', name: 'antiga', revokedAt: '2026-09-05T00:00:00.000Z' }),
          chave({ id: 'nova', name: 'laptop', lastUsedAt: '2026-09-09T09:00:00.000Z' }),
        ],
      }),
    ).toEqual({
      estado: 'pareada',
      nomes: ['laptop'],
      ultimoUso: '2026-09-09T09:00:00.000Z',
    });
  });
});
