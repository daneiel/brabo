import { describe, expect, it } from 'vitest';
import {
  acaoDeSubidaDoModo,
  decidirSubida,
  podeDecidirCicloDeVida,
} from './containers-subida';
import type { ContainerOverviewItem, RegistroDeContainer } from '../lib/api-types';

function registro(
  overrides: Partial<RegistroDeContainer> = {},
): RegistroDeContainer {
  return {
    status: 'running',
    imageVersion: 1,
    imagem: 'node:22-bookworm-slim',
    resources: { cpus: 2, memoryMb: 4096, pidsLimit: 512 },
    failureReason: null,
    createdAt: '2026-08-01T10:00:00.000Z',
    statusChangedAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  };
}

function item(overrides: Partial<ContainerOverviewItem> = {}): ContainerOverviewItem {
  return {
    projectId: 'proj-1',
    projectName: 'core',
    projectSlug: 'core',
    executionMode: 'container',
    registrado: null,
    temImagemDecidida: true,
    workspaceVerifiedAt: null,
    observado: null,
    naoObservado: null,
    detalheDaObservacao: null,
    naoVerificado: 'sem_container_registrado',
    acaoPendente: null,
    ...overrides,
  };
}

describe('acaoDeSubidaDoModo', () => {
  it('runner sobe pelo agente local; container e mounted sobem pelo broker', () => {
    expect(acaoDeSubidaDoModo('runner')).toBe('container_start_via_runner');
    expect(acaoDeSubidaDoModo('container')).toBe('container_start');
    expect(acaoDeSubidaDoModo('mounted')).toBe('container_start');
  });
});

describe('decidirSubida', () => {
  it('projeto sem container, imagem decidida, maintainer com sessão: pode subir pelo broker', () => {
    const decisao = decidirSubida({
      item: item(),
      papel: 'maintainer',
      temSessao: true,
    });

    expect(decisao).toEqual({
      pode: true,
      acao: 'container_start',
      ressalva: null,
    });
  });

  it('o cenário real: runner sem container, imagem decidida e pasta confirmada — sobe via runner, com ressalva', () => {
    const decisao = decidirSubida({
      item: item({
        executionMode: 'runner',
        workspaceVerifiedAt: '2026-09-01T10:00:00.000Z',
      }),
      papel: 'maintainer',
      temSessao: true,
    });

    expect(decisao).toEqual({
      pode: true,
      acao: 'container_start_via_runner',
      // `workspaceVerifiedAt` é registro de UMA confirmação, nunca batimento
      // (RN-468): a tela oferece, mas não promete que o agente está de pé.
      ressalva: 'runner_pode_estar_desconectado',
    });
  });

  it('container/mounted nunca ganham a ressalva do runner', () => {
    for (const modo of ['container', 'mounted'] as const) {
      const decisao = decidirSubida({
        item: item({ executionMode: modo }),
        papel: 'owner',
        temSessao: true,
      });
      expect(decisao).toMatchObject({ pode: true, ressalva: null });
    }
  });

  it('já rodando ou provisionando: subir não é a próxima ação', () => {
    for (const status of ['running', 'provisioning'] as const) {
      expect(
        decidirSubida({
          item: item({ registrado: registro({ status }) }),
          papel: 'owner',
          temSessao: true,
        }),
      ).toEqual({ pode: false, motivo: 'ja_esta_de_pe' });
    }
  });

  it('stopped/failed/removed: pode subir de novo', () => {
    for (const status of ['stopped', 'failed', 'removed'] as const) {
      expect(
        decidirSubida({
          item: item({ registrado: registro({ status }) }),
          papel: 'maintainer',
          temSessao: true,
        }),
      ).toMatchObject({ pode: true, acao: 'container_start' });
    }
  });

  it('sem imagem decidida: recusa em vez de propor uma ação que já se sabe que falha (portão da RN-105)', () => {
    expect(
      decidirSubida({
        item: item({ temImagemDecidida: false }),
        papel: 'owner',
        temSessao: true,
      }),
    ).toEqual({ pode: false, motivo: 'sem_imagem_decidida' });
  });

  it('o portão da imagem vale nos TRÊS modos — inclusive runner com pasta confirmada', () => {
    expect(
      decidirSubida({
        item: item({
          executionMode: 'runner',
          temImagemDecidida: false,
          workspaceVerifiedAt: '2026-09-01T10:00:00.000Z',
        }),
        papel: 'owner',
        temSessao: true,
      }),
    ).toEqual({ pode: false, motivo: 'sem_imagem_decidida' });
  });

  it('runner que nunca teve pasta confirmada: motivo PRÓPRIO, nunca colapsado com "sem imagem"', () => {
    expect(
      decidirSubida({
        item: item({ executionMode: 'runner', workspaceVerifiedAt: null }),
        papel: 'owner',
        temSessao: true,
      }),
    ).toEqual({ pode: false, motivo: 'runner_nunca_confirmou' });
  });

  it('mounted sem workspaceVerifiedAt segue podendo subir — a coluna só tem sentido em runner (RN-423)', () => {
    expect(
      decidirSubida({
        item: item({ executionMode: 'mounted', workspaceVerifiedAt: null }),
        papel: 'maintainer',
        temSessao: true,
      }),
    ).toMatchObject({ pode: true, acao: 'container_start' });
  });

  it('papel abaixo de maintainer não alcança o mínimo do ENDPOINT', () => {
    for (const papel of ['viewer', 'developer'] as const) {
      expect(
        decidirSubida({ item: item(), papel, temSessao: true }),
      ).toEqual({ pode: false, motivo: 'sem_papel' });
    }
  });

  it('papel AUSENTE (consulta em voo ou falhada) não alcança nada', () => {
    expect(
      decidirSubida({ item: item(), papel: undefined, temSessao: true }),
    ).toEqual({ pode: false, motivo: 'sem_papel' });
    expect(
      decidirSubida({ item: item(), papel: null, temSessao: true }),
    ).toEqual({ pode: false, motivo: 'sem_papel' });
  });

  it('sem sessão: recusa, porque toda proposed_action nasce dentro de uma', () => {
    expect(
      decidirSubida({ item: item(), papel: 'owner', temSessao: false }),
    ).toEqual({ pode: false, motivo: 'sem_sessao' });
  });

  it('o estado do MUNDO vence a capacidade de quem olha — um viewer lê "falta imagem", não só "você não pode"', () => {
    expect(
      decidirSubida({
        item: item({ temImagemDecidida: false }),
        papel: 'viewer',
        temSessao: false,
      }),
    ).toEqual({ pode: false, motivo: 'sem_imagem_decidida' });
  });
});

describe('podeDecidirCicloDeVida', () => {
  it('maintainer e owner sim; viewer, developer e ausente não', () => {
    expect(podeDecidirCicloDeVida('maintainer')).toBe(true);
    expect(podeDecidirCicloDeVida('owner')).toBe(true);
    expect(podeDecidirCicloDeVida('developer')).toBe(false);
    expect(podeDecidirCicloDeVida('viewer')).toBe(false);
    expect(podeDecidirCicloDeVida(undefined)).toBe(false);
  });
});
