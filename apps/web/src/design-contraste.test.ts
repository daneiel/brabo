import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { lerTokens, razaoDeContraste, resolverToken, type Rgb } from './lib/contraste';

/**
 * Contraste WCAG AA calculado direto dos valores de `design/tokens.css` —
 * NÃO pelo axe (o `jsdom` não resolve `var()` nem aplica layout de verdade,
 * então a regra `color-contrast` do axe fica desligada de propósito em
 * `routes/auth-a11y.test.tsx`, ver `REGRAS_DESLIGADAS` lá). Este arquivo é o
 * mecanismo que substitui isso, já citado (mas até agora inexistente) nos
 * comentários de `components/ui/Input.module.css` e
 * `routes/AuthLayout.module.css`.
 *
 * Enquanto os pares deste arquivo são de COMPONENTE ("o rodapé da sidebar",
 * "o campo do login"), os de `lib/contraste.test.ts` são do design system.
 * Os dois medem a mesma aritmética e existem por razões diferentes.
 *
 * As cores eram uma CÓPIA à mão dos valores resolvidos, com o aviso de que
 * "precisa acompanhar manualmente qualquer mudança de token" escrito aqui em
 * cima — e o ADR 0074, que mexeu em seis tokens do tema claro, é exatamente o
 * commit em que essa cópia teria mentido. Agora as duas paletas são LIDAS do
 * arquivo, pelas mesmas funções de `lib/contraste.ts` que o outro teste usa.
 */

const css = readFileSync(resolve(process.cwd(), '../../design/tokens.css'), 'utf8');
const RAIZ = lerTokens(css, ':root');
const LIGHT = { ...RAIZ, ...lerTokens(css, `\\[data-theme='light'\\]`) };

interface Tema {
  surface0: Rgb;
  surface1: Rgb;
  surface2: Rgb;
  textPrimary: Rgb;
  textSecondary: Rgb;
  textMuted: Rgb;
  accent: Rgb;
  accentHover: Rgb;
  onAccent: Rgb;
  success: Rgb;
  warning: Rgb;
  danger: Rgb;
  codeBg: Rgb;
}

function lerTema(tokens: Record<string, string>): Tema {
  const cor = (nome: string): Rgb => {
    const rgb = resolverToken(nome, tokens);
    // Token que sumiu ou virou alias quebrado tem de PARAR o teste, não virar
    // preto e passar medindo outra coisa.
    if (!rgb) throw new Error(`design/tokens.css não resolve ${nome}`);
    return rgb;
  };
  return {
    surface0: cor('--surface-0'),
    surface1: cor('--surface-1'),
    surface2: cor('--surface-2'),
    textPrimary: cor('--text-primary'),
    textSecondary: cor('--text-secondary'),
    textMuted: cor('--text-muted'),
    accent: cor('--accent'),
    accentHover: cor('--accent-hover'),
    onAccent: cor('--on-accent'),
    success: cor('--success'),
    warning: cor('--warning'),
    danger: cor('--danger'),
    codeBg: cor('--code-bg'),
  };
}

const ESCURO = lerTema(RAIZ);
const CLARO = lerTema(LIGHT);

const contraste = razaoDeContraste;

// AA: 4.5:1 pra texto normal, 3:1 pra texto grande (≥18.66px bold/24px
// regular) e pra componentes gráficos de UI (WCAG 1.4.11).
const AA_TEXTO = 4.5;
const AA_GRANDE_OU_UI = 3;

describe.each([
  ['escuro (tema primário)', ESCURO],
  ['claro', CLARO],
] as const)('contraste — tema %s', (_nome, tema) => {
  it('rodapé da sidebar: papel RBAC (--text-secondary) sobre --surface-1', () => {
    expect(contraste(tema.textSecondary, tema.surface1)).toBeGreaterThanOrEqual(AA_TEXTO);
  });

  it('TokenMeter compact: gasto/saldo (--text-secondary, mono 11px) sobre --surface-0', () => {
    // Item 2 da fidelidade do dashboard: rodapé novo do compact. --text-muted
    // reprovaria aqui (mesma razão documentada em Input.module.css pro
    // `.hint`) — por isso o componente usa --text-secondary. O fundo passou de
    // --surface-1 a --surface-0 na FASE 17a, quando a caixa afundou.
    expect(contraste(tema.textSecondary, tema.surface0)).toBeGreaterThanOrEqual(AA_TEXTO);
  });

  it('TokenMeter: CTA "Definir orçamento" (--text-secondary) sobre --surface-0', () => {
    expect(contraste(tema.textSecondary, tema.surface0)).toBeGreaterThanOrEqual(AA_TEXTO);
  });

  it('login: campo preenchido (--text-primary) sobre --code-bg', () => {
    // FASE 17a: o campo de auth afundou em --code-bg, como no handoff. O par
    // é o mais alto do tema, e o teste existe para que uma mudança futura de
    // --code-bg não o derrube em silêncio.
    expect(contraste(tema.textPrimary, tema.codeBg)).toBeGreaterThanOrEqual(AA_TEXTO);
  });

  it('login: placeholder do campo preenchido (--text-secondary) sobre --code-bg', () => {
    expect(contraste(tema.textSecondary, tema.codeBg)).toBeGreaterThanOrEqual(AA_TEXTO);
  });

  it('ProjectCard: badge de contagem de área (--text-primary) sobre --surface-2', () => {
    expect(contraste(tema.textPrimary, tema.surface2)).toBeGreaterThanOrEqual(AA_TEXTO);
  });

  it('fio da sessão: chip do modelo (--text-secondary) sobre --surface-2', () => {
    // RN-175 — o modelo ao lado do nome do agente deixou de ser
    // `--text-muted` em 10px (que reprova este mesmo limiar, ver o caso do
    // `--text-muted` mais abaixo) e virou chip legível. O teste existe para
    // que uma mudança futura de `--surface-2` não devolva o problema.
    expect(contraste(tema.textSecondary, tema.surface2)).toBeGreaterThanOrEqual(AA_TEXTO);
  });

  it('sidebar: iniciais do avatar (--on-accent) sobre --accent sólido', () => {
    // Era gradiente accent→warning — a mistura com --warning derrubava o
    // contraste pra 2.10:1 (reprova até o 3:1 de UI). O par sólido ficou, e
    // desde o ADR 0181 ele passa o piso de TEXTO nos dois temas: o
    // `--on-accent` do escuro virou o preto neutro (5,61:1 sobre o terracota
    // suave), e o do claro é branco sobre o terracota escurecido (5,58:1).
    // Era a "exceção conhecida" do botão primário — que deixou de existir.
    expect(contraste(tema.onAccent, tema.accent)).toBeGreaterThanOrEqual(AA_TEXTO);
    expect(contraste(tema.onAccent, tema.accentHover)).toBeGreaterThanOrEqual(AA_TEXTO);
  });

  it('botão de sucesso e marcadores sólidos: --on-accent sobre --success e --danger', () => {
    // `Button.module.css` (`.success`), `PrGateTimeline` e `BootstrapSteps`
    // usam o MESMO token de texto sobre fundo de estado. Com o creme de antes
    // o par ficava em 2,07:1 no escuro; com o preto neutro passa de 5.
    expect(contraste(tema.onAccent, tema.success)).toBeGreaterThanOrEqual(AA_TEXTO);
    expect(contraste(tema.onAccent, tema.danger)).toBeGreaterThanOrEqual(AA_TEXTO);
  });

  it('botão desabilitado: --text-muted sobre --surface-2, sem opacidade (AT-327)', () => {
    // `Button.module.css`: o desabilitado de `primary`/`secondary`/`success`.
    // Era `--text-muted` com `opacity: 0.6` — "Converter" inerte bege sobre
    // bege no claro. Sem a opacidade o par é medível, e o piso é o de TEXTO:
    // inerte ainda tem de dizer o que seria.
    expect(contraste(tema.textMuted, tema.surface2)).toBeGreaterThanOrEqual(AA_TEXTO);
  });

  it('sidebar: dots de status (verde/âmbar/vermelho/cinza) sobre --surface-1 — 3:1 (gráfico de UI)', () => {
    for (const cor of [tema.success, tema.warning, tema.danger, tema.textMuted]) {
      expect(contraste(cor, tema.surface1)).toBeGreaterThanOrEqual(AA_GRANDE_OU_UI);
    }
  });
});

/**
 * As duas asserções INVERTIDAS que moravam aqui ("muted sobre surface-1
 * reprova", "accent sobre surface-1 reprova") eram a justificativa medida de
 * `.hint` usar `--text-secondary` e de `.link` usar `--accent-hover`. O ADR
 * 0181 fechou os dois pares no escuro, e a asserção invertida deixou de valer —
 * então ela foi REESCRITA como piso, e os dois consumidores revistos:
 * `.link` (AuthLayout) voltou ao `--accent` que o mock sempre pediu, e `.hint`
 * (Input) ficou no `--text-secondary`, agora por hierarquia e não por
 * contraste (é texto de apoio de leitura, não metadado).
 */
/**
 * O brilho do login (AT-332): `.brilho` pinta `--accent-soft` — o acento a
 * `--tint-soft` sobre transparente — em cima de `--surface-0`, e o cabeçalho
 * mora no PICO dele (o centro do gradiente radial). O texto que fica fora do
 * card tem de passar AA contra esse pico, nos dois temas; e a regra CSS tem de
 * continuar apontando para o acento, não para uma cor de ESTADO.
 */
function misturar(cor: Rgb, fundo: Rgb, fracao: number): Rgb {
  const canal = (a: number, b: number) => Math.round(a * fracao + b * (1 - fracao));
  return { r: canal(cor.r, fundo.r), g: canal(cor.g, fundo.g), b: canal(cor.b, fundo.b) };
}

const TINT_SOFT = Number.parseFloat(RAIZ['--tint-soft'] ?? '') / 100;

describe('contraste — o brilho do login é acento, não estado (AT-332)', () => {
  const authCss = readFileSync(resolve(process.cwd(), 'src/routes/AuthLayout.module.css'), 'utf8');
  const regraDoBrilho = /\.brilho\s*\{([^}]*)\}/.exec(authCss)?.[1] ?? '';

  it('o `.brilho` pinta --accent-soft, e nenhuma cor de estado', () => {
    expect(regraDoBrilho).toContain('var(--accent-soft)');
    expect(regraDoBrilho).not.toMatch(/--(success|warning|danger|violet)-soft/);
  });

  it('--tint-soft é lido do arquivo (a medição não roda sobre um palpite)', () => {
    expect(TINT_SOFT).toBeGreaterThan(0);
    expect(TINT_SOFT).toBeLessThan(1);
  });

  it.each([
    ['escuro', ESCURO],
    ['claro', CLARO],
  ] as const)('tema %s: primário, secundário e muted passam AA sobre o pico do brilho', (_n, tema) => {
    const pico = misturar(tema.accent, tema.surface0, TINT_SOFT);
    expect(contraste(tema.textPrimary, pico)).toBeGreaterThanOrEqual(AA_TEXTO);
    expect(contraste(tema.textSecondary, pico)).toBeGreaterThanOrEqual(AA_TEXTO);
    expect(contraste(tema.textMuted, pico)).toBeGreaterThanOrEqual(AA_TEXTO);
  });
});

describe('contraste — os pares que justificavam .hint e .link', () => {
  it('--text-muted sobre --surface-1 passa AA nos dois temas — .hint fica no secondary por hierarquia', () => {
    for (const tema of [ESCURO, CLARO]) {
      expect(contraste(tema.textMuted, tema.surface1)).toBeGreaterThanOrEqual(AA_TEXTO);
      expect(contraste(tema.textSecondary, tema.surface1)).toBeGreaterThan(
        contraste(tema.textMuted, tema.surface1),
      );
    }
  });

  it('--accent sobre --surface-1 e --surface-0 passa AA nos dois temas — por isso .link voltou ao --accent', () => {
    for (const tema of [ESCURO, CLARO]) {
      expect(contraste(tema.accent, tema.surface1)).toBeGreaterThanOrEqual(AA_TEXTO);
      expect(contraste(tema.accent, tema.surface0)).toBeGreaterThanOrEqual(AA_TEXTO);
    }
  });
});

/**
 * O bloco de estado de ambiente (`components/SinaisDoAmbiente.module.css`) é o
 * primeiro componente do repositório que serve os DOIS fundos: `--surface-0`
 * no login e `--surface-1` na coluna lateral da Visão geral. Como ele não sabe
 * onde caiu, ele não pode escolher a cor do texto por fundo — e o par que
 * reprovava até o ADR 0181 (`--text-muted` sobre `--surface-1` no escuro) é o
 * mesmo que o `describe` acima documenta como piso agora.
 *
 * Os dois casos abaixo travam a escolha que saiu daí: TEXTO em
 * `--text-secondary`, cor de estado só na bolinha.
 */
describe('contraste — estado de ambiente, que serve --surface-0 E --surface-1', () => {
  it('o texto do bloco passa AA nos dois fundos e nos dois temas', () => {
    for (const tema of [ESCURO, CLARO]) {
      for (const fundo of [tema.surface0, tema.surface1]) {
        expect(contraste(tema.textSecondary, fundo)).toBeGreaterThanOrEqual(AA_TEXTO);
        expect(contraste(tema.textPrimary, fundo)).toBeGreaterThanOrEqual(AA_TEXTO);
      }
    }
  });

  it('as bolinhas passam o piso de componente gráfico nos dois fundos e nos dois temas', () => {
    // O piso aqui é o de componente gráfico (WCAG 1.4.11, 3:1). Até o ADR 0181
    // `--danger` sobre `--surface-1` no escuro dava 3,88:1 e só servia para o
    // ponto; hoje dá 4,96 e passaria como texto também — mas a escolha de o
    // texto do estado ficar em `--text-secondary` não era só contraste: a cor
    // na bolinha e a palavra neutra é o desenho do bloco, e continua.
    for (const tema of [ESCURO, CLARO]) {
      for (const fundo of [tema.surface0, tema.surface1]) {
        expect(contraste(tema.success, fundo)).toBeGreaterThanOrEqual(AA_GRANDE_OU_UI);
        expect(contraste(tema.danger, fundo)).toBeGreaterThanOrEqual(AA_GRANDE_OU_UI);
        expect(contraste(tema.textMuted, fundo)).toBeGreaterThanOrEqual(AA_GRANDE_OU_UI);
      }
    }
  });
});
