import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AA_NAO_TEXTO,
  AA_TEXTO_NORMAL,
  lerCor,
  lerTokens,
  razaoDeContraste,
  resolverToken,
} from './contraste';

// A partir do cwd (`apps/web`), não de `import.meta.url`: o ambiente jsdom não
// garante URL de arquivo, e a leitura falhava antes de rodar teste nenhum.
const css = readFileSync(resolve(process.cwd(), '../../design/tokens.css'), 'utf8');

/**
 * Contraste dos tokens, medido.
 *
 * "Baixa visibilidade" é o defeito de UI mais fácil de introduzir e o mais
 * difícil de pegar em revisão: a cor parece boa no monitor de quem escreveu.
 * Este teste transforma a impressão em número, contra os MESMOS tokens que a
 * interface consome.
 *
 * Desde o ADR 0074 os pares são medidos nos DOIS temas (RN-183). Antes só o
 * escuro fechava, e o argumento era honesto enquanto durou: dark é o tema
 * primário e o claro era INALCANÇÁVEL — nenhum caminho do produto escrevia
 * `data-theme`. Com o botão do shell, medir só o primário passaria a esconder
 * metade da superfície visível do produto.
 */
const dark = lerTokens(css, ':root');
const claroBruto = lerTokens(css, `\\[data-theme='light'\\]`);
/**
 * O tema claro RESOLVIDO. `[data-theme='light']` sobrescreve os tokens de cor
 * e herda o resto do `:root`, então medir só o bloco do claro mediria um
 * arquivo pela metade — é a cascata do navegador reproduzida aqui.
 */
const claro = { ...dark, ...claroBruto };

/** Os dois temas, na ordem em que importam. */
const TEMAS = [
  ['escuro (primário)', dark],
  ['claro', claro],
] as const;

/** Os pares que a interface realmente usa, escritos um a um. */
const PARES: { texto: string; fundo: string; piso: number; onde: string }[] = [
  { texto: '--text-primary', fundo: '--surface-0', piso: AA_TEXTO_NORMAL, onde: 'corpo sobre o fundo da página' },
  { texto: '--text-primary', fundo: '--surface-1', piso: AA_TEXTO_NORMAL, onde: 'corpo dentro de card' },
  { texto: '--text-primary', fundo: '--surface-2', piso: AA_TEXTO_NORMAL, onde: 'corpo em cabeçalho de tabela' },
  { texto: '--text-secondary', fundo: '--surface-0', piso: AA_TEXTO_NORMAL, onde: 'texto de apoio na página' },
  { texto: '--text-secondary', fundo: '--surface-1', piso: AA_TEXTO_NORMAL, onde: 'texto de apoio em card' },
  { texto: '--accent', fundo: '--surface-0', piso: AA_NAO_TEXTO, onde: 'link e realce' },
  { texto: '--danger', fundo: '--surface-0', piso: AA_NAO_TEXTO, onde: 'erro sobre o fundo' },
  // `--violet` entrou na FASE 16 (agentes/IA). Vai medido nos três fundos em
  // que a UI o usa como ELEMENTO — dot de status, badge, avatar de agente —
  // mais o `--code-bg`, onde ele é TEXTO de verdade (número e decorator no
  // realce de sintaxe) e por isso responde pelo piso de texto normal.
  { texto: '--violet', fundo: '--surface-0', piso: AA_NAO_TEXTO, onde: 'acento de agente na página' },
  { texto: '--violet', fundo: '--surface-1', piso: AA_NAO_TEXTO, onde: 'acento de agente em card' },
  { texto: '--violet', fundo: '--surface-2', piso: AA_NAO_TEXTO, onde: 'acento de agente em cabeçalho' },
  { texto: '--violet', fundo: '--code-bg', piso: AA_TEXTO_NORMAL, onde: 'número/decorator no código' },
  // As três cores de agente sem contraparte semântica viraram token por tema
  // no ADR 0181 (eram hex soltos em `lib/agents.ts`, calibrados só contra o
  // escuro). O papel delas é o do `--violet`: dot, badge, avatar — ELEMENTO.
  ...['--agent-leve', '--agent-frontend', '--agent-secops'].flatMap((texto) =>
    ['--surface-0', '--surface-1', '--surface-2'].map((fundo) => ({
      texto,
      fundo,
      piso: AA_NAO_TEXTO,
      onde: 'cor de agente (dot, badge, avatar)',
    })),
  ),
];

describe.each(TEMAS)('contraste dos tokens — tema %s', (_nome, tokens) => {
  it('o arquivo de tokens foi lido — o parser não passa vazio', () => {
    expect(Object.keys(tokens).length).toBeGreaterThan(10);
    expect(resolverToken('--text-primary', tokens)).not.toBeNull();
  });

  for (const par of PARES) {
    it(`${par.texto} sobre ${par.fundo} (${par.onde}) atinge ${par.piso}:1`, () => {
      const texto = resolverToken(par.texto, tokens);
      const fundo = resolverToken(par.fundo, tokens);
      expect(texto, `${par.texto} não resolve`).not.toBeNull();
      expect(fundo, `${par.fundo} não resolve`).not.toBeNull();

      const razao = razaoDeContraste(texto!, fundo!);
      expect(
        Number(razao.toFixed(2)),
        `${par.texto} sobre ${par.fundo} está em ${razao.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(par.piso);
    });
  }
});

/**
 * A paleta de sintaxe (aba Code e Markdown do chat), testada contra
 * `--code-bg` — onde ela SEMPRE aparece. RN-185.
 *
 * Os OITO papéis do handoff, cada um com token próprio desde o ADR 0074. Eram
 * três (`function`, `comment`, `operator`) e os outros cinco reusavam
 * `--accent`/`--warning`/`--violet`/`--success`/`--text-primary` — é esse
 * reuso que fazia o bloco ser medido só no escuro, porque no claro os
 * semânticos reprovavam contra o `--code-bg` de papel. Agora os oito são
 * medidos nos DOIS temas.
 *
 * Os cinco semânticos AINDA são quem pinta (`SyntaxTokens.module.css` não
 * mudou), então vão medidos ao lado: enquanto forem o pixel de verdade, é
 * deles que o piso é cobrado.
 */
const PAPEIS_DE_SINTAXE = [
  '--syntax-keyword',
  '--syntax-function',
  '--syntax-string',
  '--syntax-number',
  '--syntax-comment',
  '--syntax-type',
  '--syntax-operator',
  '--syntax-text',
];

/** Os tokens que `SyntaxTokens.module.css` referencia hoje, por papel. */
const SINTAXE_EM_USO = [
  '--accent', // keyword
  '--syntax-function', // função
  '--warning', // string
  '--violet', // número/decorator
  '--syntax-comment', // comentário
  '--success', // tipo/classe
  '--syntax-operator', // operador
  '--text-primary', // texto plano do código
];

describe.each(TEMAS)(
  'contraste — paleta de sintaxe sobre --code-bg (tema %s)',
  (_nome, tokens) => {
    for (const nome of [...new Set([...PAPEIS_DE_SINTAXE, ...SINTAXE_EM_USO])]) {
      it(`${nome} sobre --code-bg atinge 4,5:1`, () => {
        const cor = resolverToken(nome, tokens);
        expect(cor, `${nome} não resolve`).not.toBeNull();
        const razao = razaoDeContraste(cor!, resolverToken('--code-bg', tokens)!);
        expect(
          Number(razao.toFixed(2)),
          `${nome} sobre --code-bg está em ${razao.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(AA_TEXTO_NORMAL);
      });
    }
  },
);

/**
 * A dívida de contraste do tema escuro ACABOU, e isso vira piso.
 *
 * Do ADR 0074 ao ADR 0181 estes cinco pares estavam em uso abaixo de 4,5:1 no
 * escuro (azul-petróleo), e o teste travava o valor ATUAL de cada um — dívida
 * conhecida, não defeito novo. A paleta neutra do ADR 0181 foi calibrada até
 * eles PASSAREM (a medição decidiu o `--text-muted` #86868f em vez do #71717a
 * do rascunho, que repetia a dívida com outra cor). Travar o número antigo
 * deixou de fazer sentido: o que se cobra agora é o PISO, nos DOIS temas, e a
 * próxima mudança de paleta que devolver a dívida reprova aqui em vez de ser
 * "registrada".
 *
 * No claro eles já passavam desde o ADR 0074; o bloco que afirmava isso
 * separado virou este.
 */
describe.each(TEMAS)('a antiga dívida de contraste agora é piso (tema %s)', (_nome, tokens) => {
  for (const d of [
    { texto: '--text-muted', fundo: '--surface-1', onde: 'legenda dentro de card' },
    { texto: '--text-muted', fundo: '--surface-2', onde: 'cabeçalho de tabela' },
    { texto: '--accent', fundo: '--surface-1', onde: 'link dentro de card' },
    { texto: '--danger', fundo: '--surface-1', onde: 'erro dentro de card' },
    { texto: '--success', fundo: '--surface-2', onde: 'selo em cabeçalho' },
  ]) {
    it(`${d.texto} sobre ${d.fundo} (${d.onde}) atinge 4,5:1`, () => {
      const razao = razaoDeContraste(
        resolverToken(d.texto, tokens)!,
        resolverToken(d.fundo, tokens)!,
      );
      expect(
        Number(razao.toFixed(2)),
        `${d.texto} sobre ${d.fundo} está em ${razao.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(AA_TEXTO_NORMAL);
    });
  }

  it('o --text-muted continua um degrau ABAIXO do --text-secondary — a hierarquia não virou um cinza só', () => {
    // Fechar a dívida clareando o muted até o secondary resolveria o número e
    // apagaria a diferença entre os dois papéis. A régua: o muted passa o piso
    // e o secondary continua mais legível que ele nas três superfícies.
    for (const fundo of ['--surface-0', '--surface-1', '--surface-2']) {
      const muted = razaoDeContraste(resolverToken('--text-muted', tokens)!, resolverToken(fundo, tokens)!);
      const secundario = razaoDeContraste(
        resolverToken('--text-secondary', tokens)!,
        resolverToken(fundo, tokens)!,
      );
      expect(secundario, `--text-secondary sobre ${fundo}`).toBeGreaterThan(muted);
    }
  });
});

/**
 * O tema claro não pode perder um token semântico de cor.
 *
 * `[data-theme='light']` sobrescreve TODOS os tokens de cor do `:root` — se um
 * token novo entra só no escuro, ele não some: ele VAZA o valor calibrado pro
 * escuro para dentro do tema claro, e o defeito aparece como "essa cor está
 * ilegível no claro", longe do commit que a causou. É a falha que este bloco
 * pega, e foi ela que a entrada de `--violet` na FASE 16 poderia ter
 * introduzido.
 *
 * A lista é DERIVADA, não escrita à mão: token novo entra sozinho na
 * verificação. Fora ficam a paleta bruta (que é fonte, não semântica, e o
 * claro referencia por `var()`) e tudo que não resolve para cor literal —
 * sombra, fonte, espaçamento e radius não têm contraparte clara.
 */
describe('paridade de tokens entre os dois temas', () => {
  const RAMPA = /^--(terracota|teal|petroleo|areia|neutro)-\d+$/;
  const semanticosDeCor = Object.keys(dark).filter(
    (nome) => !RAMPA.test(nome) && resolverToken(nome, dark) !== null,
  );

  it('o bloco do tema claro foi lido — o parser não passa vazio', () => {
    expect(Object.keys(claroBruto).length).toBeGreaterThan(10);
    expect(semanticosDeCor.length).toBeGreaterThan(10);
    expect(semanticosDeCor).toContain('--violet');
    // Os oito papéis de sintaxe entram na derivação sozinhos (ADR 0074) — se
    // um deles nascer só no escuro, o bloco abaixo é quem pega.
    expect(semanticosDeCor).toContain('--syntax-keyword');
    expect(semanticosDeCor).toContain('--syntax-text');
    // As cores de agente do ADR 0181 também — nasceram token para mudar com o
    // tema, e é aqui que a promessa é cobrada.
    expect(semanticosDeCor).toContain('--agent-leve');
    // A escala neutra é paleta BRUTA (fonte, não semântica): fica fora.
    expect(semanticosDeCor).not.toContain('--neutro-900');
  });

  for (const nome of semanticosDeCor) {
    it(`${nome} tem valor próprio no tema claro`, () => {
      expect(
        resolverToken(nome, claro),
        `${nome} existe no :root e não em [data-theme='light']`,
      ).not.toBeNull();
      expect(claroBruto[nome], `${nome} não é redeclarado no tema claro`).toBeDefined();
    });
  }

  it('--violet do tema claro serve como elemento de interface', () => {
    const violeta = resolverToken('--violet', claro)!;
    const fundo = resolverToken('--surface-0', claro)!;
    expect(razaoDeContraste(violeta, fundo)).toBeGreaterThanOrEqual(AA_NAO_TEXTO);
  });
});

describe('a aritmética', () => {
  it('preto no branco é 21:1 e branco no branco é 1:1', () => {
    const preto = lerCor('#000000')!;
    const branco = lerCor('#ffffff')!;
    expect(Math.round(razaoDeContraste(preto, branco))).toBe(21);
    expect(razaoDeContraste(branco, branco)).toBe(1);
  });

  it('lê hex curto e longo, e recusa o que não é cor', () => {
    expect(lerCor('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(lerCor('#d6633a')).toEqual({ r: 214, g: 99, b: 58 });
    expect(lerCor('var(--x)')).toBeNull();
  });

  /** Alias quebrado é erro de escrita, não contraste ruim — não pode virar 0. */
  it('token inexistente devolve null em vez de fingir uma cor', () => {
    expect(resolverToken('--nao-existe', dark)).toBeNull();
  });
});
