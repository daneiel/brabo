import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AT080, PARAMETROS_AT080 } from './heuristica.ts';
import {
  CORPUS_SINTETICO,
  RAIZ_DO_REPOSITORIO,
  SEQUENCIAS_SINTETICAS,
  corpusRealPadrao,
  dentroDoRepositorio,
  escreverCorpus,
  lerCorpus,
  linguaDoRotulo,
  type ItemDoCorpus,
} from './corpus.ts';
import {
  avaliarItens,
  avaliarSequencias,
  contar,
  esperadoDe,
  faixasDeConfianca,
  matrizDeConfusao,
  sequenciasDoCorpusReal,
  varredura,
  type Sequencia,
} from './medicao.ts';
import { lerOpcoes, relatorio } from './medir.ts';

const item = (id: string, idioma: string | null, texto: string): ItemDoCorpus => ({ id, idioma, texto, origem: 'sintetico' });

describe('régua de acerto', () => {
  it('pt/es/en esperam a própria língua; und, mul e qualquer outra língua esperam indeterminado', () => {
    expect(esperadoDe('pt-BR')).toBe('pt');
    expect(esperadoDe('es')).toBe('es');
    expect(esperadoDe('und')).toBe('indeterminado');
    expect(esperadoDe('mul')).toBe('indeterminado');
    expect(esperadoDe('fr')).toBe('indeterminado');
    expect(linguaDoRotulo('pt-BR')).toBe('pt');
  });

  it('separa perda de cobertura (indeterminado) de erro (língua errada) e conta falso es à parte', () => {
    const p = { ...PARAMETROS_AT080, minPalavras: 0 };
    const linhas = avaliarItens(
      [
        item('a', 'pt', 'você não isso então'),
        item('b', 'pt', 'ok'),
        item('c', 'gl', 'muy pero hola gracias'),
        item('d', 'und', 'ok'),
        item('e', null, 'sem rótulo não entra'),
      ],
      AT080,
      p,
    );
    expect(linhas).toHaveLength(4);
    expect(contar(linhas)).toEqual({ n: 4, acerto: 2, indeterminado: 1, erro: 1, falsoEs: 1 });
    expect(matrizDeConfusao(linhas).get('gl')).toEqual({ pt: 0, es: 1, en: 0, indeterminado: 0 });
  });

  it('faixa de confiança mede a vencedora CRUA, antes do limiar', () => {
    const linhas = avaliarItens([item('a', 'es', 'você não'), item('b', 'pt', 'você não')], AT080, {
      ...PARAMETROS_AT080,
      minPalavras: 50,
    });
    const cheia = faixasDeConfianca(linhas).find((f) => f.de === 1)!;
    expect(cheia).toMatchObject({ n: 2, vencedoraCerta: 1, vencedoraErrada: 1 });
  });

  it('a varredura mostra a cobertura caindo com a evidência mínima', () => {
    const itens = [item('a', 'pt', 'você não'), item('b', 'pt', 'você não isso então também obrigado pra')];
    const pontos = varredura(itens, AT080, PARAMETROS_AT080, [0.8], [0, 5]);
    expect(pontos.map((x) => x.cobertura)).toEqual([2, 1]);
  });
});

describe('corpus sintético versionado', () => {
  const corpus = lerCorpus(CORPUS_SINTETICO);

  it('toda linha é sintética, rotulada, com id único e caso', () => {
    expect(corpus.length).toBeGreaterThan(100);
    expect(new Set(corpus.map((i) => i.id)).size).toBe(corpus.length);
    for (const i of corpus) {
      expect(i.origem).toBe('sintetico');
      expect(i.idioma).toMatch(/^(und|mul|[a-z]{2,3}(-[A-Za-z0-9]+)*)$/);
      expect(i.caso).toBeTruthy();
    }
  });

  it('cobre os casos obrigatórios da AT-080 e línguas fora das três (lista aberta)', () => {
    const casos = new Set(corpus.map((i) => i.caso));
    for (const c of ['pt-typo', 'es-prosa', 'en-prosa', 'misto', 'curto-sem-idioma', 'so-codigo', 'so-log', 'pt-citacao-es', 'pt-tecnico']) {
      expect(casos, c).toContain(c);
    }
    expect(new Set(corpus.map((i) => linguaDoRotulo(i.idioma!)))).toContain('gl');
  });

  it('as sequências sintéticas passam com os parâmetros candidatos (linha de base, não meta)', () => {
    const { sequencias } = JSON.parse(readFileSync(SEQUENCIAS_SINTETICAS, 'utf8')) as { sequencias: Sequencia[] };
    const r = avaliarSequencias(sequencias, AT080, PARAMETROS_AT080);
    expect(r.length).toBeGreaterThanOrEqual(7);
    expect(r.filter((x) => !x.ok).map((x) => x.id)).toEqual([]);
  });

  it('o relatório nunca imprime o texto de um item', () => {
    const saida = relatorio(corpus, [], lerOpcoes(['--sem-cpu']));
    expect(saida).toContain('Matriz de confusão');
    for (const i of corpus.filter((x) => x.texto.length > 25)) {
      expect(saida.includes(i.texto), i.id).toBe(false);
    }
  });

  it('o CLI roda de ponta a ponta com o Node do repositório e sai com 0', () => {
    const saida = execFileSync(process.execPath, [join(RAIZ_DO_REPOSITORIO, 'scripts/idioma/medir.ts'), '--sem-cpu', '--variante', 'at080'], {
      encoding: 'utf8',
    });
    expect(saida).toContain('### Variante `at080`');
    expect(saida).toContain('**Sequências**');
  });
});

describe('corpus real fica fora do git', () => {
  it('recusa gravar dentro do checkout', () => {
    expect(dentroDoRepositorio(join(RAIZ_DO_REPOSITORIO, 'scripts/idioma/real.jsonl'))).toBe(true);
    expect(() => escreverCorpus(join(RAIZ_DO_REPOSITORIO, 'x.jsonl'), [])).toThrow(/fora do git/i);
  });

  it('o destino padrão é o cache do usuário, e grava com permissão 600', () => {
    const pasta = mkdtempSync(join(tmpdir(), 'corpus-idioma-'));
    expect(corpusRealPadrao({ XDG_CACHE_HOME: pasta })).toBe(join(pasta, 'brabo/corpus-idioma/mensagens.jsonl'));
    const destino = corpusRealPadrao({ XDG_CACHE_HOME: pasta });
    escreverCorpus(destino, [item('a', null, 'x')]);
    expect(statSync(destino).mode & 0o777).toBe(0o600);
    expect(lerCorpus(destino)).toHaveLength(1);
  });

  it('em sequência, agrupa por autor, ordena por instante e não expõe o id do autor', () => {
    const real = (id: string, grupo: string, em: string, idioma: string, texto: string): ItemDoCorpus => ({
      id,
      idioma,
      texto,
      origem: 'real',
      grupo,
      em,
    });
    const seqs = sequenciasDoCorpusReal([
      real('2', 'user-uuid-1', '2026-09-02', 'pt', 'segunda'),
      real('1', 'user-uuid-1', '2026-09-01', 'pt', 'primeira'),
      real('3', 'user-uuid-2', '2026-09-01', 'en', 'outra'),
    ]);
    expect(seqs.map((s) => s.id)).toEqual(['autor 1', 'autor 2']);
    expect(seqs[0]!.mensagens).toEqual(['primeira', 'segunda']);
    expect(seqs[0]!.esperadoFinal).toBe('pt');
  });
});
