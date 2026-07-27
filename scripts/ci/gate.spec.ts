import { describe, expect, it } from 'vitest';
import {
  avaliarGate,
  destravar,
  escreverGate,
  formatarGate,
  GATE_LIMPO,
  higienizar,
  lerGate,
  proximaNaOrdem,
  travar,
  type EntradaDeHistorico,
  type Gate,
} from './gate.ts';

const REPO = 'daneiel/brabo';

function hotfix(tag: string, prQa = 60, prDev = 61): EntradaDeHistorico {
  return {
    tag,
    sha: 'abc12345',
    em: '2026-07-27T10:00:00Z',
    prs: { qa: prQa, dev: prDev },
  };
}

/** O gate logo depois de um hotfix entrar em `main`. */
function travado(...tags: string[]): Gate {
  return tags.reduce((g, t, i) => travar(g, hotfix(t, 60 + i * 2, 61 + i * 2)), {
    ...GATE_LIMPO,
  });
}

// ---------------------------------------------------------- 1. gate limpo

describe('gate limpo', () => {
  it('deixa passar qualquer PR', () => {
    for (const [head, base] of [
      ['feature/x', 'dev'],
      ['dev', 'qa'],
      ['main', 'qa'],
      ['hotfix/y', 'main'],
    ]) {
      const v = avaliarGate(GATE_LIMPO, { head: head!, base: base! });
      expect(v.ok).toBe(true);
      expect(v.motivo).toBe('GATE-LIMPO');
    }
  });

  it('gate ausente ou vazio é gate limpo', () => {
    expect(lerGate(null).locked).toEqual([]);
    expect(lerGate('').locked).toEqual([]);
    expect(lerGate(escreverGate(GATE_LIMPO)).awaiting).toBeNull();
  });

  it('gate ILEGÍVEL levanta — não vira gate limpo', () => {
    // Tratar corrompido como limpo liberaria todos os merges justamente
    // quando o estado é desconhecido.
    expect(() => lerGate('{ nao é json')).toThrow(/não é JSON válido/);
  });
});

// ------------------------------------------------------ 2. cadeia do hotfix

describe('cadeia completa do hotfix', () => {
  it('trava qa e dev, na ordem, aguardando a tag', () => {
    const g = travado('v0.2.1');
    expect(g.locked).toEqual(['qa', 'dev']);
    expect(g.order).toEqual(['qa', 'dev']);
    expect(g.awaiting).toBe('v0.2.1');
    expect(proximaNaOrdem(g)).toBe('qa');
  });

  it('main→qa é a retropropagação da vez', () => {
    const v = avaliarGate(travado('v0.2.1'), { head: 'main', base: 'qa' }, REPO);
    expect(v.ok).toBe(true);
    expect(v.motivo).toBe('RETROPROPAGACAO-DA-VEZ');
    expect(v.detalhe).toContain('depois vem');
  });

  it('destrava qa, e aí dev vira a da vez', () => {
    const g = destravar(travado('v0.2.1'), 'qa');
    expect(g.locked).toEqual(['dev']);
    expect(g.awaiting).toBe('v0.2.1');
    expect(proximaNaOrdem(g)).toBe('dev');
    expect(avaliarGate(g, { head: 'main', base: 'dev' }).ok).toBe(true);
  });

  it('a ÚLTIMA destrava limpa o awaiting e o histórico', () => {
    const g = destravar(destravar(travado('v0.2.1'), 'qa'), 'dev');
    expect(g.locked).toEqual([]);
    expect(g.awaiting).toBeNull();
    expect(g.historico).toEqual([]);
    expect(avaliarGate(g, { head: 'feature/x', base: 'dev' }).ok).toBe(true);
  });
});

// -------------------------------------------------------- 3. fora de ordem

describe('fora de ordem', () => {
  it('main→dev antes de qa é BARRADO, dizendo o que destravar antes', () => {
    const v = avaliarGate(travado('v0.2.1'), { head: 'main', base: 'dev' }, REPO);
    expect(v.ok).toBe(false);
    expect(v.motivo).toBe('FORA-DE-ORDEM');
    expect(v.detalhe).toContain('destrave `qa` antes de `dev`');
    // A mensagem tem que EXPLICAR, não só recusar.
    expect(v.detalhe).toContain('sem a correção');
    expect(v.detalhe).toContain(`https://github.com/${REPO}/pull/60`);
  });

  it('depois que qa sai, dev deixa de estar fora de ordem', () => {
    const g = destravar(travado('v0.2.1'), 'qa');
    expect(avaliarGate(g, { head: 'main', base: 'dev' }).motivo).toBe(
      'RETROPROPAGACAO-DA-VEZ',
    );
  });
});

// ------------------------------------------------------- 4. trabalho barrado

describe('trabalho durante gate ativo', () => {
  it('feature/ para dev fica VERMELHO citando a trava e o PR que resolve', () => {
    const v = avaliarGate(travado('v0.2.1'), { head: 'feature/x', base: 'dev' }, REPO);
    expect(v.ok).toBe(false);
    expect(v.motivo).toBe('DESTINO-TRAVADO');
    expect(v.detalhe).toContain('v0.2.1');
    expect(v.detalhe).toContain('DESFAZER a correção');
    expect(v.detalhe).toContain(`https://github.com/${REPO}/pull/61`);
  });

  it('bugfix/ para dev também é BARRADO — bugfix não é retropropagação', () => {
    // A tentação é achar que "é correção, então pode passar". Não pode: ela
    // nasce de `dev`, não de `main`, e não carrega o hotfix. Deixá-la entrar
    // não resolve a trava e ainda empilha trabalho por cima do buraco.
    const v = avaliarGate(travado('v0.2.1'), { head: 'bugfix/y', base: 'dev' }, REPO);
    expect(v.ok).toBe(false);
    expect(v.motivo).toBe('DESTINO-TRAVADO');
  });

  it('promoção dev→qa é barrada durante o gate', () => {
    expect(avaliarGate(travado('v0.2.1'), { head: 'dev', base: 'qa' }).ok).toBe(false);
  });

  it('outro hotfix para main PASSA — main nunca é travada', () => {
    const v = avaliarGate(travado('v0.2.1'), { head: 'hotfix/z', base: 'main' });
    expect(v.ok).toBe(true);
  });

  it('head chamado `main` vindo de FORK não conta como retropropagação', () => {
    const v = avaliarGate(
      travado('v0.2.1'),
      { head: 'main', base: 'dev', mesmoRepositorio: false },
      REPO,
    );
    expect(v.ok).toBe(false);
    expect(v.motivo).toBe('DESTINO-TRAVADO');
  });

  it('o trabalho LIBERA depois da cadeia inteira', () => {
    let g = travado('v0.2.1');
    expect(avaliarGate(g, { head: 'feature/x', base: 'dev' }).ok).toBe(false);
    g = destravar(g, 'qa');
    expect(avaliarGate(g, { head: 'feature/x', base: 'dev' }).ok).toBe(false);
    g = destravar(g, 'dev');
    expect(avaliarGate(g, { head: 'feature/x', base: 'dev' }).ok).toBe(true);
  });
});

// ------------------------------------------------------------- 5. acúmulo

describe('acúmulo de hotfixes', () => {
  it('segundo hotfix durante gate ativo entra no histórico sem fila nova', () => {
    const g = travado('v0.2.1', 'v0.2.2');
    expect(g.historico).toHaveLength(2);
    expect(g.historico.map((h) => h.tag)).toEqual(['v0.2.1', 'v0.2.2']);
    expect(g.awaiting).toBe('v0.2.2');
    // A ordem e a trava continuam as mesmas: os PRs de backmerge já abertos
    // carregam `main`, e `main` já tem os dois hotfixes.
    expect(g.locked).toEqual(['qa', 'dev']);
  });

  it('hotfix novo REtrava uma branch já destravada', () => {
    // qa tinha saído; o hotfix seguinte traz conteúdo novo que precisa descer.
    let g = destravar(travado('v0.2.1'), 'qa');
    expect(g.locked).toEqual(['dev']);
    g = travar(g, hotfix('v0.2.2', 70, 71));
    expect(g.locked).toEqual(['qa', 'dev']);
  });

  it('a mensagem aponta o PR do hotfix MAIS RECENTE', () => {
    const g = travado('v0.2.1', 'v0.2.2');
    const v = avaliarGate(g, { head: 'feature/x', base: 'dev' }, REPO);
    // Os PRs do segundo hotfix são 62/63 pelo helper.
    expect(v.detalhe).toContain('/pull/63');
    expect(v.detalhe).toContain('v0.2.2');
  });

  it('a cadeia acumulada fecha com as mesmas duas destravas', () => {
    let g = travado('v0.2.1', 'v0.2.2');
    g = destravar(g, 'qa');
    g = destravar(g, 'dev');
    expect(g.locked).toEqual([]);
    expect(g.awaiting).toBeNull();
    expect(g.historico).toEqual([]);
  });
});

// ---------------------------------------------- 6. higiene contra registro velho

describe('higiene: a trava é conferida, não só declarada', () => {
  it('gate limpo não mexe em nada', () => {
    const h = higienizar(GATE_LIMPO, () => true);
    expect(h.removidas).toEqual([]);
    expect(h.gate).toBe(GATE_LIMPO);
  });

  it('trava cai quando o hotfix JÁ está na branch', () => {
    // O caso real: os PRs de retropropagação levam o `gate.json` para `qa` e
    // `dev`; meses depois uma promoção sobe aquela cópia velha de volta para
    // `main`. Sem higiene, o repositório trava para sempre — não existe
    // retropropagação pendente que resolva.
    const h = higienizar(travado('v0.2.1'), () => true);
    expect(h.removidas).toEqual(['qa', 'dev']);
    expect(h.gate.locked).toEqual([]);
    expect(h.gate.awaiting).toBeNull();
  });

  it('trava fica de pé quando o hotfix ainda NÃO desceu', () => {
    const h = higienizar(travado('v0.2.1'), () => false);
    expect(h.removidas).toEqual([]);
    expect(h.gate.locked).toEqual(['qa', 'dev']);
  });

  it('cai só a branch que já recebeu; a outra continua travada', () => {
    const h = higienizar(travado('v0.2.1'), (b) => b === 'qa');
    expect(h.removidas).toEqual(['qa']);
    expect(h.gate.locked).toEqual(['dev']);
    expect(proximaNaOrdem(h.gate)).toBe('dev');
  });

  it('NÃO CONSEGUIR VERIFICAR mantém a trava', () => {
    // Desconhecido não é permissão. Um erro de git virando "pode passar"
    // desligaria o gate exatamente quando o estado é incerto.
    const h = higienizar(travado('v0.2.1'), () => null);
    expect(h.removidas).toEqual([]);
    expect(h.naoVerificadas).toEqual(['qa', 'dev']);
    expect(h.gate.locked).toEqual(['qa', 'dev']);
  });

  it('a pergunta é feita com o sha do hotfix MAIS RECENTE', () => {
    const vistos: string[] = [];
    higienizar(travado('v0.2.1', 'v0.2.2'), (_b, sha) => {
      vistos.push(sha);
      return false;
    });
    expect(vistos).toEqual(['abc12345', 'abc12345']);
  });

  it('depois da higiene o trabalho volta a passar', () => {
    const { gate } = higienizar(travado('v0.2.1'), () => true);
    expect(avaliarGate(gate, { head: 'feature/x', base: 'dev' }).ok).toBe(true);
  });
});

// ------------------------------------------------------- 7. serialização

describe('serialização', () => {
  it('sobrevive à ida e volta', () => {
    const g = travado('v0.2.1');
    expect(lerGate(escreverGate(g))).toEqual(g);
  });

  it('o arquivo termina em quebra de linha', () => {
    expect(escreverGate(GATE_LIMPO).endsWith('\n')).toBe(true);
  });

  it('a saída legível diz o que está acontecendo', () => {
    const entrada = { head: 'feature/x', base: 'dev' };
    const texto = formatarGate(entrada, avaliarGate(travado('v0.2.1'), entrada, REPO));
    expect(texto).toContain('backmerge-gate: feature/x → dev');
    expect(texto).toContain('DESTINO-TRAVADO');
    expect(texto).toContain('branching-policy.md');
  });
});
