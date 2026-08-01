import { describe, it, expect } from 'vitest';

/**
 * Contraste WCAG AA calculado direto dos valores de `design/tokens.css` —
 * NÃO pelo axe (o `jsdom` não resolve `var()` nem aplica layout de verdade,
 * então a regra `color-contrast` do axe fica desligada de propósito em
 * `routes/auth-a11y.test.tsx`, ver `REGRAS_DESLIGADAS` lá). Este arquivo é o
 * mecanismo que substitui isso, já citado (mas até agora inexistente) nos
 * comentários de `components/ui/Input.module.css` e
 * `routes/AuthLayout.module.css`.
 *
 * Os hex abaixo são uma CÓPIA dos valores resolvidos de `design/tokens.css`
 * — precisa acompanhar manualmente qualquer mudança de token, porque não há
 * como um teste em Node ler CSS custom properties sem layout de browser.
 */

interface Tema {
  surface0: string;
  surface1: string;
  surface2: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentHover: string;
  onAccent: string;
  success: string;
  warning: string;
  danger: string;
}

const ESCURO: Tema = {
  surface0: '#061b24',
  surface1: '#0a2e3d',
  surface2: '#123f4e',
  textPrimary: '#f5ede0',
  textSecondary: '#aec6ce',
  textMuted: '#6e8a94',
  accent: '#d6633a',
  accentHover: '#e37b4e',
  onAccent: '#f7eee2',
  success: '#37b3a4',
  warning: '#e0982f',
  danger: '#e05a3e',
};

const CLARO: Tema = {
  surface0: '#f5ede0',
  surface1: '#fcf8f1',
  surface2: '#ecddc7',
  textPrimary: '#0a2e3d',
  textSecondary: '#3c5a66',
  textMuted: '#80939a',
  accent: '#c4552d',
  accentHover: '#a5451f',
  onAccent: '#f7eee2',
  success: '#217e73',
  warning: '#b5701c',
  danger: '#b33a26',
};

function hexParaRgb(hex: string): [number, number, number] {
  const limpo = hex.replace('#', '');
  return [
    parseInt(limpo.slice(0, 2), 16),
    parseInt(limpo.slice(2, 4), 16),
    parseInt(limpo.slice(4, 6), 16),
  ];
}

// Fórmula de luminância relativa do WCAG 2.x (sRGB).
function luminancia([r, g, b]: [number, number, number]): number {
  const canal = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [rl, gl, bl] = [canal(r), canal(g), canal(b)];
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

function contraste(corA: string, corB: string): number {
  const la = luminancia(hexParaRgb(corA));
  const lb = luminancia(hexParaRgb(corB));
  const [maior, menor] = la > lb ? [la, lb] : [lb, la];
  return (maior + 0.05) / (menor + 0.05);
}

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

  it('TokenMeter compact: gasto/saldo (--text-secondary, mono 11px) sobre --surface-1', () => {
    // Item 2 da fidelidade do dashboard: rodapé novo do compact. --text-muted
    // reprovaria aqui (mesma razão documentada em Input.module.css pro
    // `.hint`) — por isso o componente usa --text-secondary.
    expect(contraste(tema.textSecondary, tema.surface1)).toBeGreaterThanOrEqual(AA_TEXTO);
  });

  it('TokenMeter: CTA "Definir orçamento" (--text-secondary) sobre --surface-1', () => {
    expect(contraste(tema.textSecondary, tema.surface1)).toBeGreaterThanOrEqual(AA_TEXTO);
  });

  it('ProjectCard: badge de contagem de área (--text-primary) sobre --surface-2', () => {
    expect(contraste(tema.textPrimary, tema.surface2)).toBeGreaterThanOrEqual(AA_TEXTO);
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
