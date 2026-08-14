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
    // contraste pra 2.10:1 (reprova até o 3:1 de UI). --on-accent sobre
    // --accent puro dá ~3.2-3.9:1: não fecha o 4.5:1 de texto de leitura,
    // mas é o MESMO par (e a mesma faixa) que o botão primary já usa em
    // todo o app hoje — tratado aqui como rótulo compacto de UI (2
    // letras, não texto de leitura), não uma regressão nova desta tarefa.
    expect(contraste(tema.onAccent, tema.accent)).toBeGreaterThanOrEqual(AA_GRANDE_OU_UI);
  });

  it('sidebar: dots de status (verde/âmbar/vermelho/cinza) sobre --surface-1 — 3:1 (gráfico de UI)', () => {
    for (const cor of [tema.success, tema.warning, tema.danger, tema.textMuted]) {
      expect(contraste(cor, tema.surface1)).toBeGreaterThanOrEqual(AA_GRANDE_OU_UI);
    }
  });
});

describe('contraste — regressão dos pares já documentados (não deste task, mas o mecanismo cobre)', () => {
  it('--text-muted sobre --surface-1 (escuro) reprova — é por isso que .hint usa --text-secondary', () => {
    expect(contraste(ESCURO.textMuted, ESCURO.surface1)).toBeLessThan(AA_TEXTO);
  });

  it('--accent sobre --surface-1 (escuro) reprova pra link de texto — por isso .link usa --accent-hover', () => {
    expect(contraste(ESCURO.accent, ESCURO.surface1)).toBeLessThan(AA_TEXTO);
    expect(contraste(ESCURO.accentHover, ESCURO.surface1)).toBeGreaterThanOrEqual(AA_TEXTO);
  });
});
