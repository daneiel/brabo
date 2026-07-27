import { describe, expect, it } from 'vitest';
import {
  avaliarPr,
  ehAutorBot,
  ESCADA,
  FUNCOES_DE_TRABALHO,
  verificarContaminacao,
  type Ancestralidade,
  type EntradaPr,
  type Permanente,
} from './pr-police.ts';

/**
 * Ancestralidade da escada esticada e saudável: main ⊆ rc ⊆ qa ⊆ dev, e o head
 * contém só o que `nasceuDe` contém. É o cenário de repositório em ritmo
 * normal.
 */
function escadaEsticada(nasceuDe: Permanente): Ancestralidade {
  const iNasceu = ESCADA.indexOf(nasceuDe);
  const headContem: Partial<Record<Permanente, boolean>> = {};
  for (const p of ESCADA) {
    // O head contém o tip de tudo que é ancestral da sua origem — ou seja, dos
    // degraus MAIS ESTÁVEIS (índice maior) — e da própria origem.
    headContem[p] = ESCADA.indexOf(p) >= iNasceu;
  }

  const contida: Ancestralidade['contida'] = {};
  for (const a of ESCADA) {
    contida[a] = {};
    for (const b of ESCADA) {
      if (a === b) continue;
      // `a` está contida em `b` quando `a` é mais estável que `b`.
      contida[a]![b] = ESCADA.indexOf(a) > ESCADA.indexOf(b);
    }
  }

  return { headContem, contida };
}

function pr(over: Partial<EntradaPr> = {}): EntradaPr {
  return { head: 'feature/x', base: 'dev', ancestralidade: escadaEsticada('dev'), ...over };
}

// ---------------------------------------------------------------- 1. formato

describe('formato do nome', () => {
  it('reprova nome sem função e ensina o formato', () => {
    const v = avaliarPr(pr({ head: 'minha-branch' }));

    expect(v.ok).toBe(false);
    expect(v.violacoes[0]!.codigo).toBe('NOME-FORA-DO-FORMATO');
    // A mensagem tem que ENSINAR: citar o observado e o exemplo correto.
    expect(v.violacoes[0]!.observado).toContain('minha-branch');
    expect(v.violacoes[0]!.conserto).toContain('feature/minha-branch');
    expect(v.violacoes[0]!.conserto).toContain('→ rejeitada');
    expect(v.violacoes[0]!.conserto).toContain('→ aceita');
  });

  it.each([
    ['patch-1', 'default da UI web do GitHub em fork'],
    ['WIP', 'sem barra'],
    ['', 'vazio'],
  ])('reprova %s (%s)', (head) => {
    expect(avaliarPr(pr({ head })).ok).toBe(false);
  });

  it('reprova função com 16 caracteres e aceita com 15', () => {
    expect(avaliarPr(pr({ head: `${'a'.repeat(16)}/b` })).ok).toBe(false);
    // 15 caracteres passa o regex, mas cai na lista fechada — o importante é
    // que a violação seja de FUNÇÃO, não de formato.
    const v = avaliarPr(pr({ head: `${'a'.repeat(15)}/b` }));
    expect(v.violacoes[0]!.codigo).toBe('FUNCAO-DESCONHECIDA');
  });

  it('reprova descritivo com 33 caracteres e aceita com 32', () => {
    expect(avaliarPr(pr({ head: `feature/${'b'.repeat(33)}` })).ok).toBe(false);
    expect(avaliarPr(pr({ head: `feature/${'b'.repeat(32)}` })).ok).toBe(true);
  });

  it('reprova espaço no descritivo', () => {
    expect(avaliarPr(pr({ head: 'feature/com espaco' })).ok).toBe(false);
  });

  it('reprova `/x` — o regex aceita função vazia, a lista fechada não', () => {
    const v = avaliarPr(pr({ head: '/x' }));
    expect(v.ok).toBe(false);
    expect(v.violacoes[0]!.codigo).toBe('FUNCAO-DESCONHECIDA');
  });

  it('reprova `feature/` — o regex aceita descritivo vazio, a política não', () => {
    const v = avaliarPr(pr({ head: 'feature/' }));
    expect(v.ok).toBe(false);
    expect(v.violacoes[0]!.codigo).toBe('DESCRITIVO-VAZIO');
  });

  it('reprova caixa alta na função', () => {
    expect(avaliarPr(pr({ head: 'FEATURE/x' })).ok).toBe(false);
  });
});

// --------------------------------------------------------------- 2. taxonomia

describe('taxonomia', () => {
  it.each(FUNCOES_DE_TRABALHO)('aceita %s/ mirando dev, família trabalho', (funcao) => {
    const v = avaliarPr(pr({ head: `${funcao}/algo`, base: 'dev' }));
    expect(v.ok).toBe(true);
    expect(v.familia).toBe('trabalho');
  });

  it('aceita rcfix mirando rc, família correcao-alta', () => {
    const v = avaliarPr(pr({ head: 'rcfix/x', base: 'rc', ancestralidade: escadaEsticada('rc') }));
    expect(v.ok).toBe(true);
    expect(v.familia).toBe('correcao-alta');
  });

  it('aceita hotfix mirando main, família correcao-alta', () => {
    const v = avaliarPr(
      pr({ head: 'hotfix/x', base: 'main', ancestralidade: escadaEsticada('main') }),
    );
    expect(v.ok).toBe(true);
    expect(v.familia).toBe('correcao-alta');
  });

  it.each([
    ['ci/algo', 'chore'],
    ['fix/algo', 'bugfix'],
    ['feat/algo', 'feature'],
    ['style/algo', 'refactor'],
  ])('reprova %s e sugere %s', (head, sugerido) => {
    const v = avaliarPr(pr({ head }));
    expect(v.ok).toBe(false);
    expect(v.violacoes[0]!.codigo).toBe('FUNCAO-DESCONHECIDA');
    expect(v.violacoes[0]!.conserto).toContain(sugerido);
  });
});

// ----------------------------------------------------------------- 3. destino

describe('destino', () => {
  it.each(['qa', 'rc', 'main'])('reprova feature/x mirando %s', (base) => {
    const v = avaliarPr(pr({ head: 'feature/x', base }));
    expect(v.ok).toBe(false);
    expect(v.violacoes.some((x) => x.codigo === 'DESTINO-INVALIDO')).toBe(true);
    expect(v.familia).toBeNull();
  });

  it('a mensagem de destino explica que promoção é PR entre permanentes', () => {
    const v = avaliarPr(pr({ head: 'feature/x', base: 'qa' }));
    const d = v.violacoes.find((x) => x.codigo === 'DESTINO-INVALIDO')!;
    expect(d.observado).toContain('`qa`');
    expect(d.regra).toContain('`dev`');
    expect(d.conserto).toContain('gh pr edit');
  });

  it.each(['dev', 'qa', 'main'])('reprova rcfix/x mirando %s', (base) => {
    const v = avaliarPr(pr({ head: 'rcfix/x', base, ancestralidade: escadaEsticada('rc') }));
    expect(v.ok).toBe(false);
  });

  it.each(['dev', 'qa', 'rc'])('reprova hotfix/x mirando %s', (base) => {
    const v = avaliarPr(pr({ head: 'hotfix/x', base, ancestralidade: escadaEsticada('main') }));
    expect(v.ok).toBe(false);
  });
});

// ------------------------------------------------------------------ 4. escada

describe('escada', () => {
  it.each([
    ['dev', 'qa'],
    ['qa', 'rc'],
    ['rc', 'main'],
  ])('aceita a promoção %s → %s', (head, base) => {
    const v = avaliarPr({ head, base });
    expect(v.ok).toBe(true);
    expect(v.familia).toBe('promocao');
  });

  it.each([
    ['main', 'rc'],
    ['rc', 'qa'],
    ['qa', 'dev'],
  ])('aceita a retropropagação %s → %s', (head, base) => {
    const v = avaliarPr({ head, base });
    expect(v.ok).toBe(true);
    expect(v.familia).toBe('retropropagacao');
  });

  it.each([
    ['dev', 'rc', 'qa'],
    ['dev', 'main', 'qa'],
    ['qa', 'main', 'rc'],
  ])('reprova a promoção %s → %s por pular %s', (head, base, pulado) => {
    const v = avaliarPr({ head, base });
    expect(v.ok).toBe(false);
    expect(v.violacoes[0]!.codigo).toBe('PROMOCAO-NAO-ADJACENTE');
    expect(v.violacoes[0]!.observado).toContain(pulado);
    // O conserto tem que dizer o caminho em etapas, não só "é proibido".
    expect(v.violacoes[0]!.conserto).toContain('etapas');
  });

  it.each([
    ['main', 'dev'],
    ['rc', 'dev'],
    ['main', 'qa'],
  ])('reprova a retropropagação %s → %s por pular degrau', (head, base) => {
    expect(avaliarPr({ head, base }).ok).toBe(false);
  });

  it('reprova permanente mirando ela mesma', () => {
    expect(avaliarPr({ head: 'dev', base: 'dev' }).ok).toBe(false);
  });

  it('reprova permanente mirando branch de trabalho', () => {
    expect(avaliarPr({ head: 'dev', base: 'feature/x' }).ok).toBe(false);
  });

  it('não aplica o regex de nome a PR entre permanentes', () => {
    // `main` não tem barra: se a ordem de avaliação estiver invertida, todo PR
    // de promoção recebe "use funcao/descritivo", que é uma mensagem absurda.
    const v = avaliarPr({ head: 'rc', base: 'main' });
    expect(v.ok).toBe(true);
    expect(v.violacoes).toHaveLength(0);
  });

  it('head chamado `main` vindo de FORK é branch de trabalho, não promoção', () => {
    const v = avaliarPr({ head: 'main', base: 'dev', mesmoRepositorio: false });
    expect(v.ok).toBe(false);
    expect(v.violacoes[0]!.codigo).toBe('NOME-FORA-DO-FORMATO');
  });
});

// ------------------------------------------------------------- 5. contaminação

describe('contaminação de origem', () => {
  it('reprova rcfix nascido de dev', () => {
    const v = avaliarPr(pr({ head: 'rcfix/x', base: 'rc', ancestralidade: escadaEsticada('dev') }));
    expect(v.ok).toBe(false);
    const c = v.violacoes.find((x) => x.codigo === 'ORIGEM-CONTAMINADA')!;
    expect(c.observado).toContain('`dev`');
    expect(c.conserto).toContain('git checkout -b');
    expect(c.conserto).toContain('origin/rc');
  });

  it('reprova hotfix nascido de dev', () => {
    const v = avaliarPr(
      pr({ head: 'hotfix/x', base: 'main', ancestralidade: escadaEsticada('dev') }),
    );
    expect(v.ok).toBe(false);
    const c = v.violacoes.find((x) => x.codigo === 'ORIGEM-CONTAMINADA')!;
    expect(c.porque).toContain('produção');
  });

  it('reprova hotfix nascido de rc', () => {
    const v = avaliarPr(
      pr({ head: 'hotfix/x', base: 'main', ancestralidade: escadaEsticada('rc') }),
    );
    expect(v.ok).toBe(false);
  });

  it('aceita feature nascida de main — contaminação só conta para BAIXO', () => {
    // Uma feature que nasceu de main por engano não introduz nada estranho em
    // dev. A política pega o que leva código não validado à produção, não o
    // contrário.
    const v = avaliarPr(
      pr({ head: 'feature/x', base: 'dev', ancestralidade: escadaEsticada('main') }),
    );
    expect(v.ok).toBe(true);
  });

  it('aceita hotfix defasado — o teste é de contaminação, não de atualidade', () => {
    // Nasceu de main há meses; main andou depois. O head NÃO contém o tip
    // atual de main, e mesmo assim está limpo.
    const a = escadaEsticada('main');
    a.headContem.main = false;
    expect(avaliarPr(pr({ head: 'hotfix/x', base: 'main', ancestralidade: a })).ok).toBe(true);
  });

  it('aceita rcfix quando qa é ancestral de rc — regressão do falso positivo pós-promoção', () => {
    // Logo depois de `qa → rc`, o tip de qa está DENTRO de rc. Um rcfix
    // legítimo contém o tip de qa, e sem o teste dinâmico de "mais avançada"
    // isso viraria contaminação.
    const a = escadaEsticada('rc');
    a.headContem.qa = true;
    a.contida.qa = { ...a.contida.qa, rc: true };
    expect(avaliarPr(pr({ head: 'rcfix/x', base: 'rc', ancestralidade: a })).ok).toBe(true);
  });

  it('avisa em vez de reprovar quando a ancestralidade não pôde ser medida', () => {
    const v = avaliarPr(pr({ head: 'hotfix/x', base: 'main', ancestralidade: undefined }));
    expect(v.ok).toBe(true);
    expect(v.avisos.join(' ')).toContain('não verificada');
  });

  it('trabalho não tem verificação de contaminação: dev é o topo', () => {
    const r = verificarContaminacao('dev', escadaEsticada('main'));
    expect(r.contaminadaPor).toHaveLength(0);
    expect(r.naoVerificado).toHaveLength(0);
  });

  it('permanente inexistente entra como não verificada, nunca como aprovada', () => {
    // `qa` e `rc` ainda não existiam no remoto: a medida não existe. Tratar
    // ausência como `false` faria toda checagem passar em silêncio.
    const r = verificarContaminacao('main', { headContem: { dev: true }, contida: {} });
    expect(r.naoVerificado).toContain('qa');
    expect(r.naoVerificado).toContain('rc');
  });
});

// -------------------------------------------------------------- 6. isenção

describe('isenção de bot', () => {
  it.each(['dependabot[bot]', 'github-actions[bot]'])('isenta %s', (autor) => {
    const v = avaliarPr({
      head: 'dependabot/npm_and_yarn/brace-expansion-5.0.8',
      base: 'main',
      autor,
    });
    expect(v.ok).toBe(true);
    expect(v.isento).toBe(true);
  });

  it('isenta por type=Bot mesmo sem o sufixo no login', () => {
    expect(avaliarPr({ head: 'qualquer-coisa', base: 'main', tipoDoAutor: 'Bot' }).isento).toBe(
      true,
    );
  });

  it('NÃO isenta humano com branch nomeada de dependabot/ — a isenção é por autor', () => {
    const v = avaliarPr({
      head: 'dependabot/npm_and_yarn/x',
      base: 'main',
      autor: 'daneiel',
    });
    expect(v.ok).toBe(false);
    expect(v.isento).toBe(false);
  });

  it('reconhece bot por sufixo e por tipo', () => {
    expect(ehAutorBot('renovate[bot]')).toBe(true);
    expect(ehAutorBot('daneiel')).toBe(false);
    expect(ehAutorBot('daneiel', 'Bot')).toBe(true);
  });
});

// ------------------------------------------------- 7. qualidade da mensagem

describe('toda violação ensina', () => {
  const casos: EntradaPr[] = [
    pr({ head: 'minha-branch' }),
    pr({ head: 'feature/' }),
    pr({ head: 'ci/x' }),
    pr({ head: 'feature/x', base: 'qa' }),
    { head: 'dev', base: 'main' },
    pr({ head: 'hotfix/x', base: 'main', ancestralidade: escadaEsticada('dev') }),
  ];

  it.each(casos)('$head → $base tem os quatro campos preenchidos', (entrada) => {
    const v = avaliarPr(entrada);
    expect(v.ok).toBe(false);
    for (const violacao of v.violacoes) {
      // Impede que alguém acrescente regra nova com mensagem seca.
      expect(violacao.observado.length).toBeGreaterThan(10);
      expect(violacao.regra.length).toBeGreaterThan(10);
      expect(violacao.porque.length).toBeGreaterThan(10);
      expect(violacao.conserto.length).toBeGreaterThan(5);
    }
  });
});
