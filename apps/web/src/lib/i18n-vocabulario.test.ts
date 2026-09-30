import { describe, expect, it } from 'vitest';
import i18next from 'i18next';

/**
 * Vocabulário da interface (AT-326). Três réguas sobre o TEXTO dos locales,
 * não sobre a tela — é aqui que o defeito nasce, e é barato de medir:
 *
 * 1. Número de RN/ADR é endereço da documentação do Brabo, não informação
 *    para quem usa o produto — ele não sai em frase de tela, em idioma
 *    nenhum. (ADR como ARTEFATO do projeto do usuário, o que o Arquiteto
 *    abre, é outra coisa e não casa com o padrão numerado.)
 * 2. Jargão em inglês que tem palavra em português não aparece no pt-BR.
 *    "handoff", "gate", "binding", "LLM", "dev agent", "lead" e "runner"
 *    FICAM: são linguagem ubíqua do produto, com verbete no glossário
 *    (`docs/glossary.md`, "o nome que aparece na tela é o mesmo do código").
 * 3. Plural por "(s)"/"(ões)" nos namespaces da AT-326 vira plural do
 *    i18next (`_one`/`_other`). Os demais namespaces ainda têm, e ficam de
 *    fora desta régua por escopo, não por decisão.
 */
type Arvore = { [chave: string]: unknown };
type ModuloJson = { default: Arvore };

const modulosEn = import.meta.glob<ModuloJson>('../locales/en/*.json', { eager: true });
const modulosPtBR = import.meta.glob<ModuloJson>('../locales/pt-BR/*.json', { eager: true });

function nomeDoNamespace(caminho: string): string {
  return (caminho.split('/').pop() ?? '').replace(/\.json$/, '');
}

function valores(arvore: Arvore, prefixo = ''): Array<[string, string]> {
  const saida: Array<[string, string]> = [];
  for (const [chave, valor] of Object.entries(arvore)) {
    const caminho = prefixo ? `${prefixo}.${chave}` : chave;
    if (typeof valor === 'string') saida.push([caminho, valor]);
    else if (valor !== null && typeof valor === 'object') saida.push(...valores(valor as Arvore, caminho));
  }
  return saida;
}

function todos(modulos: Record<string, ModuloJson>): Array<[string, string]> {
  return Object.entries(modulos).flatMap(([caminho, modulo]) =>
    valores(modulo.default, nomeDoNamespace(caminho)),
  );
}

const REFERENCIA_INTERNA = /\bRN-\d{3}\b|\bADR \d{4}\b/;
const JARGAO_NO_PT = /circuit breaker|\btasks? blocked\b|\btasks?\b|\bdefault\b/i;
const PLURAL_POR_PARENTESE = /\((s|es|ões)\)/;
const NAMESPACES_DO_PLURAL = new Set(['backlog', 'insights', 'approvals', 'sessionPage']);

function achados(
  pares: Array<[string, string]>,
  regra: RegExp,
  filtro: (chave: string) => boolean = () => true,
): string[] {
  // O nome da variável interpolada (`{{task}}`, `{{default}}`) é código,
  // não texto de tela — sai antes da régua.
  const semVariaveis = (valor: string) => valor.replace(/\{\{[^}]*\}\}/g, '');
  return pares
    .filter(([chave, valor]) => filtro(chave) && regra.test(semVariaveis(valor)))
    .map(([chave]) => chave);
}

describe('vocabulário dos locales (AT-326)', () => {
  it('nenhuma frase de tela cita número de RN ou ADR, nos dois idiomas', () => {
    expect(achados(todos(modulosEn), REFERENCIA_INTERNA)).toEqual([]);
    expect(achados(todos(modulosPtBR), REFERENCIA_INTERNA)).toEqual([]);
  });

  it('o pt-BR não usa "circuit breaker", "task(s)" nem "default" onde há palavra em português', () => {
    expect(achados(todos(modulosPtBR), JARGAO_NO_PT)).toEqual([]);
  });

  it('backlog, insights, approvals e sessionPage não pluralizam por "(s)", nos dois idiomas', () => {
    const doEscopo = (chave: string) => NAMESPACES_DO_PLURAL.has(chave.split('.')[0]);
    expect(achados(todos(modulosEn), PLURAL_POR_PARENTESE, doEscopo)).toEqual([]);
    expect(achados(todos(modulosPtBR), PLURAL_POR_PARENTESE, doEscopo)).toEqual([]);
  });

  it('as réguas acusam o que dizem acusar (o instrumento mede)', () => {
    const amostra: Array<[string, string]> = [
      ['a.eyebrow', 'Runner local · ADR 0105'],
      ['a.help', 'Só os que um agente usa (RN-040).'],
      ['b.title', 'Tasks blocked seguidas'],
      ['backlog.x', '{{count}} história(s)'],
      ['c.ok', 'Aceitar handoff e abrir o ADR do projeto'],
    ];
    expect(achados(amostra, REFERENCIA_INTERNA)).toEqual(['a.eyebrow', 'a.help']);
    expect(achados(amostra, JARGAO_NO_PT)).toEqual(['b.title']);
    expect(achados(amostra, PLURAL_POR_PARENTESE, (c) => c.startsWith('backlog'))).toEqual(['backlog.x']);
  });

  it('o plural do i18next escolhe a forma pela contagem nos dois idiomas', async () => {
    const recursos = (modulos: Record<string, ModuloJson>) =>
      Object.fromEntries(Object.entries(modulos).map(([c, m]) => [nomeDoNamespace(c), m.default]));
    const i18n = i18next.createInstance();
    await i18n.init({
      resources: { en: recursos(modulosEn), 'pt-BR': recursos(modulosPtBR) },
      lng: 'pt-BR',
      fallbackLng: 'en',
      interpolation: { escapeValue: false },
    });

    expect(i18n.t('epicNode.storyCount', { ns: 'backlog', count: 1 })).toBe('1 história');
    expect(i18n.t('epicNode.storyCount', { ns: 'backlog', count: 3 })).toBe('3 histórias');
    expect(
      i18n.t('agentStatus.circuitBreaker.withCount', { ns: 'executors', count: 2 }),
    ).toBe('parada automática: 2 tarefas bloqueadas seguidas');

    await i18n.changeLanguage('en');
    expect(i18n.t('epicNode.storyCount', { ns: 'backlog', count: 1 })).toBe('1 story');
    expect(i18n.t('epicNode.storyCount', { ns: 'backlog', count: 3 })).toBe('3 stories');
  });
});
