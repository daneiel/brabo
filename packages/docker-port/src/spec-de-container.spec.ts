import { describe, expect, it } from 'vitest';
import {
  EspecificacaoInvalidaError,
  especificacaoValidada,
  referenciaDeImagemAceitavel,
  TETO_DE_RECURSOS,
} from './spec-de-container.ts';
import { PONTO_DE_MONTAGEM } from './docker-port.ts';

/**
 * O que se prova aqui é o PARSE — a fronteira entre um JSON que veio de outro
 * processo e o tipo fechado que a porta aceita. Cada caso de recusa abaixo é
 * uma frase que alguém poderia escrever no corpo de uma requisição e que este
 * lado não deixa virar `docker run`.
 */

const VALIDA = {
  workspaceDirName: 'exp002-f52be111',
  projectId: 'f52be111-0000-4000-8000-000000000000',
  projectSlug: 'exp002',
  workspaceId: 'aaaaaaaa-0000-4000-8000-000000000000',
  imagem: 'node:22-bookworm-slim',
  imagemVersao: 3,
  rede: 'none',
  raizDoProjeto: '/home/alguem/projetos/exp002',
  cpus: 2,
  memoriaMb: 4096,
  pidsLimit: 512,
};

describe('especificacaoValidada — caminho feliz', () => {
  it('devolve a especificação fechada, com a versão do artefato como texto', () => {
    const spec = especificacaoValidada(VALIDA);

    expect(spec.workspaceDirName).toBe('exp002-f52be111');
    expect(spec.imagem).toBe('node:22-bookworm-slim');
    // `version` é número no artefato e vira rótulo (`brabo.image.version`),
    // que é texto. A conversão é aqui para o adaptador nunca decidir formato.
    expect(spec.imagemVersao).toBe('3');
    expect(spec.rede).toBe('none');
    expect(spec.cpus).toBe(2);
    expect(spec.memoriaMb).toBe(4096);
    expect(spec.pidsLimit).toBe(512);
    // A marca só sai de `raizDeProjetoValidada` — o valor chega normalizado.
    expect(spec.raizDoProjeto).toBe('/home/alguem/projetos/exp002');
  });

  it('aceita digest no lugar da tag, e `egress` no lugar de `none`', () => {
    const spec = especificacaoValidada({
      ...VALIDA,
      imagem: 'ghcr.io/org/app@sha256:abc123',
      rede: 'egress',
    });

    expect(spec.imagem).toBe('ghcr.io/org/app@sha256:abc123');
    expect(spec.rede).toBe('egress');
  });

  it('o destino do mount não é parâmetro nenhum, aqui nem em lugar nenhum', () => {
    expect(PONTO_DE_MONTAGEM).toBe('/work');
    expect(Object.keys(especificacaoValidada(VALIDA))).not.toContain('destino');
  });
});

describe('especificacaoValidada — o que ela recusa', () => {
  it('recusa imagem que começa com `-`, porque o CLI a leria como FLAG', () => {
    // `execFile` sem shell resolve injeção de COMANDO. Injeção de ARGUMENTO é
    // outra coisa, e é esta linha que a fecha.
    expect(() =>
      especificacaoValidada({ ...VALIDA, imagem: '--privileged' }),
    ).toThrow(EspecificacaoInvalidaError);
  });

  it('recusa `latest` — o nome não determina a imagem', () => {
    expect(() =>
      especificacaoValidada({ ...VALIDA, imagem: 'node:latest' }),
    ).toThrow(/latest/);
  });

  it('recusa referência sem tag nem digest', () => {
    expect(referenciaDeImagemAceitavel('node')).toBe(false);
    // Dois-pontos de PORTA não é tag.
    expect(referenciaDeImagemAceitavel('registry.local:5000/app')).toBe(false);
    expect(referenciaDeImagemAceitavel('registry.local:5000/app:1.2')).toBe(
      true,
    );
  });

  it('recusa metacaractere de shell na referência', () => {
    expect(referenciaDeImagemAceitavel('node:22 && rm -rf /')).toBe(false);
    expect(referenciaDeImagemAceitavel('node:22;id')).toBe(false);
  });

  it('recusa `host` como rede — ela não é um valor deste produto', () => {
    const erro = pegar(() =>
      especificacaoValidada({ ...VALIDA, rede: 'host' }),
    );

    expect(erro).toBeInstanceOf(EspecificacaoInvalidaError);
    expect((erro as EspecificacaoInvalidaError).campo).toBe('rede');
    expect(erro?.message).toContain('ADR 0065');
  });

  it('recusa recurso acima do teto em vez de rebaixar em silêncio', () => {
    const erro = pegar(() =>
      especificacaoValidada({ ...VALIDA, cpus: TETO_DE_RECURSOS.cpus + 1 }),
    );

    expect((erro as EspecificacaoInvalidaError).campo).toBe('cpus');
    // A mensagem diz o teto: rebaixar calado faria o container ser uma coisa e
    // o registro dizer outra.
    expect(erro?.message).toContain(String(TETO_DE_RECURSOS.cpus));
  });

  it('recusa `workspaceDirName` com travessia — ele vira caminho e nome', () => {
    for (const nome of ['../fora', 'com/barra', 'com espaço', '']) {
      expect(() =>
        especificacaoValidada({ ...VALIDA, workspaceDirName: nome }),
      ).toThrow(EspecificacaoInvalidaError);
    }
  });

  it('recusa a raiz do filesystem e pasta de sistema como raiz do projeto', () => {
    // A recusa vem de `raizDeProjetoValidada` (a marca), não daqui — este
    // teste existe para provar que o parse NÃO tem um caminho que a contorne.
    expect(() =>
      especificacaoValidada({ ...VALIDA, raizDoProjeto: '/' }),
    ).toThrow(/raiz do filesystem/);
    expect(() =>
      especificacaoValidada({ ...VALIDA, raizDoProjeto: '/var/run' }),
    ).toThrow(/pasta de sistema/);
  });

  it('nomeia o CAMPO recusado, sempre', () => {
    const casos: Array<[string, Record<string, unknown>]> = [
      ['projectId', { projectId: null }],
      ['projectSlug', { projectSlug: { nome: 'exp002' } }],
      ['imagemVersao', { imagemVersao: undefined }],
      ['memoriaMb', { memoriaMb: 0 }],
    ];

    for (const [campo, patch] of casos) {
      const erro = pegar(() => especificacaoValidada({ ...VALIDA, ...patch }));
      expect(erro, `esperava recusa em ${campo}`).toBeInstanceOf(
        EspecificacaoInvalidaError,
      );
      expect((erro as EspecificacaoInvalidaError).campo).toBe(campo);
    }
  });

  it('declara ORIGEM política — a recusa é deliberada, não falha de infra', () => {
    const erro = pegar(() =>
      especificacaoValidada({ ...VALIDA, imagem: 'node:latest' }),
    );

    expect((erro as EspecificacaoInvalidaError).origem).toBe('politica');
  });
});

function pegar(f: () => unknown): Error | undefined {
  try {
    f();
    return undefined;
  } catch (erro) {
    return erro as Error;
  }
}
