import { describe, expect, it } from 'vitest';
import {
  CADENCIA_DA_ESPERA_MS,
  CONSULTAS_POR_BATIMENTO,
  esperaDaConsulta,
  esperarPrimeiroProjeto,
  TETO_DE_FALHAS_DE_CONSULTA,
  type DependenciasDaEspera,
} from './espera-de-projetos.ts';
import { CredencialNaoEDeMaquinaError, type ProjetoDoRunner } from './projetos.ts';

/**
 * A espera roda com o relógio INJETADO: `esperar` só registra quanto tempo
 * teria dormido e devolve na hora. Um teste que dormisse de verdade provaria a
 * mesma coisa em vinte minutos, e é justamente a CADÊNCIA que ele precisa
 * afirmar — dormir de verdade a tornaria invisível.
 */
function projeto(id: string): ProjetoDoRunner {
  return {
    projectId: id,
    name: `projeto ${id}`,
    workspaceDirName: `dir-${id}`,
    workspaceVerifiedAt: null,
  };
}

interface Gravacao {
  esperas: number[];
  logs: string[];
  erros: string[];
}

function montar(
  respostas: Array<ProjetoDoRunner[] | Error>,
  opcoes: { pararApos?: number } = {},
): { deps: DependenciasDaEspera; gravacao: Gravacao; consultas: () => number } {
  const gravacao: Gravacao = { esperas: [], logs: [], erros: [] };
  let consultas = 0;

  const deps: DependenciasDaEspera = {
    listar: async () => {
      const resposta = respostas[consultas] ?? [];
      consultas++;
      if (resposta instanceof Error) throw resposta;
      return resposta;
    },
    esperar: async (ms) => {
      gravacao.esperas.push(ms);
    },
    deveParar: () =>
      opcoes.pararApos !== undefined && gravacao.esperas.length > opcoes.pararApos,
    log: (linha) => gravacao.logs.push(linha),
    erro: (linha) => gravacao.erros.push(linha),
  };

  return { deps, gravacao, consultas: () => consultas };
}

describe('a espera do primeiro projeto (RN-550)', () => {
  it('caminho feliz: espera, reconsulta e devolve a PRIMEIRA lista não-vazia — e para de esperar ali', async () => {
    const { deps, gravacao, consultas } = montar([[], [], [projeto('p-1')]]);

    const desfecho = await esperarPrimeiroProjeto(deps);

    expect(desfecho).toEqual({ tipo: 'projetos', projetos: [projeto('p-1')] });
    // Três consultas, e nenhuma quarta: o desfecho ENCERRA a espera.
    expect(consultas()).toBe(3);
    // A primeira coisa é ESPERAR — quem chama acabou de consultar.
    expect(gravacao.esperas).toEqual([
      CADENCIA_DA_ESPERA_MS[0],
      CADENCIA_DA_ESPERA_MS[1],
      CADENCIA_DA_ESPERA_MS[2],
    ]);
    expect(gravacao.logs.join('\n')).toContain('a espera ACABA');
  });

  it('a cadência escalona e ESTABILIZA no último degrau — nunca cresce sem fim', () => {
    expect(esperaDaConsulta(1)).toBe(CADENCIA_DA_ESPERA_MS[0]);
    expect(esperaDaConsulta(CADENCIA_DA_ESPERA_MS.length)).toBe(
      CADENCIA_DA_ESPERA_MS[CADENCIA_DA_ESPERA_MS.length - 1],
    );
    expect(esperaDaConsulta(500)).toBe(CADENCIA_DA_ESPERA_MS[CADENCIA_DA_ESPERA_MS.length - 1]);
  });

  it('lista vazia por muito tempo NÃO fica calada: um batimento a cada N consultas, dizendo quantas foram', async () => {
    const vazias: ProjetoDoRunner[][] = Array.from({ length: CONSULTAS_POR_BATIMENTO }, () => []);
    const { deps, gravacao } = montar([...vazias, [projeto('p-1')]]);

    await esperarPrimeiroProjeto(deps);

    const batimentos = gravacao.logs.filter((linha) => linha.includes('seguindo'));
    expect(batimentos).toHaveLength(1);
    expect(batimentos[0]).toContain(`${CONSULTAS_POR_BATIMENTO} consultas`);
    // E o silêncio entre batimentos é deliberado: uma linha por consulta seria
    // ruído por minuto, para sempre, no `journalctl`.
    expect(gravacao.logs.filter((linha) => linha.includes('seguindo'))).toHaveLength(1);
  });

  it('FALHA: consultas que só dão erro esgotam o teto, e o desfecho DIZ o número em vez de morrer calado', async () => {
    const erros = Array.from(
      { length: TETO_DE_FALHAS_DE_CONSULTA },
      (_, i) => new Error(`api fora do ar (${i})`),
    );
    const { deps, gravacao } = montar(erros);

    const desfecho = await esperarPrimeiroProjeto(deps);

    expect(desfecho.tipo).toBe('desistiu');
    if (desfecho.tipo !== 'desistiu') throw new Error('desfecho inesperado');
    expect(desfecho.mensagem).toContain(`${TETO_DE_FALHAS_DE_CONSULTA} consultas seguidas`);
    // Cada falha foi RELATADA com a posição dela no teto — um processo que
    // some depois de dez minutos sem dizer nada é o silêncio que este
    // repositório recusa.
    expect(gravacao.erros).toHaveLength(TETO_DE_FALHAS_DE_CONSULTA);
    expect(gravacao.erros[0]).toContain(`1/${TETO_DE_FALHAS_DE_CONSULTA}`);
  });

  it('uma resposta no meio ZERA o contador de falhas: o teto é de falhas SEGUIDAS', async () => {
    const respostas: Array<ProjetoDoRunner[] | Error> = [];
    for (let i = 0; i < TETO_DE_FALHAS_DE_CONSULTA - 1; i++) respostas.push(new Error('502'));
    respostas.push([]); // respondeu — vazio é resposta, e é sucesso
    for (let i = 0; i < TETO_DE_FALHAS_DE_CONSULTA - 1; i++) respostas.push(new Error('502'));
    respostas.push([projeto('p-1')]);

    const desfecho = await esperarPrimeiroProjeto(montar(respostas).deps);

    expect(desfecho.tipo).toBe('projetos');
  });

  it('credencial que não é de máquina SOBE intacta — esperar não transforma chave de projeto em chave de máquina', async () => {
    const { deps } = montar([new CredencialNaoEDeMaquinaError('— presa ao projeto X')]);

    await expect(esperarPrimeiroProjeto(deps)).rejects.toBeInstanceOf(
      CredencialNaoEDeMaquinaError,
    );
  });

  it('SIGTERM no meio da espera devolve `parado`, sem consultar de novo', async () => {
    const { deps, gravacao, consultas } = montar([[], [], [projeto('p-1')]], { pararApos: 1 });

    const desfecho = await esperarPrimeiroProjeto(deps);

    expect(desfecho).toEqual({ tipo: 'parado' });
    expect(consultas()).toBe(1);
    expect(gravacao.esperas).toHaveLength(2);
  });
});
