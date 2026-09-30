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
 * 3. Plural por "(s)"/"(ões)" vira plural do i18next (`_one`/`_other`), em
 *    TODOS os namespaces e nos dois idiomas (AT-326 começou por quatro; a
 *    AT-331 estendeu a régua ao resto). Frase com MAIS DE UM número vira uma
 *    chave por número, compostas na tela — o i18next pluraliza só `count`.
 * 4. No pt-BR toda chave com `_one` tem `_zero` (AT-331). A regra de plural
 *    do CLDR para `pt` põe o 0 na categoria `one` — sem `_zero`, a tela diz
 *    "0 referência". O `en` põe o 0 em `other` e não precisa.
 * 5. No pt-BR, frase com `{{count}}` é chave de plural — salvo as
 *    INVARIANTES declaradas abaixo, cujo texto não flexiona com o número
 *    ("3 aguardando", "2 online"). É a régua que teria pego "1 eventos".
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

/** Frases com `{{count}}` que NÃO flexionam no pt-BR — a exceção da régua 5. */
const INVARIANTES_NO_PT = new Set([
  'approvals.approvalsTab.devPrs.eyebrow',
  'approvals.approvalsTab.infraPrs.eyebrow',
  'dashboard.projectCard.online',
  'models.catalog.syncReport.deVolta',
  'sessions.sessionsTab.contagem.aguardando',
  'sessions.sessionsTab.contagem.auto',
]);

/** Chaves com `{{count}}` que não são plural do i18next nem invariante declarada. */
function contagemSemPlural(pares: Array<[string, string]>, invariantes: ReadonlySet<string>): string[] {
  return pares
    .filter(([, valor]) => valor.includes('{{count}}'))
    .filter(([chave]) => !/_(zero|one|two|few|many|other)$/.test(chave) && !invariantes.has(chave))
    .map(([chave]) => chave);
}

/** Raízes com `_one` sem o irmão `_zero` — a régua 4. */
function semZero(pares: Array<[string, string]>): string[] {
  const chaves = new Set(pares.map(([chave]) => chave));
  return pares
    .map(([chave]) => chave)
    .filter((chave) => chave.endsWith('_one') && !chaves.has(chave.replace(/_one$/, '_zero')))
    .map((chave) => chave.replace(/_one$/, ''));
}

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

  it('nenhum namespace pluraliza por "(s)", nos dois idiomas (AT-331)', () => {
    expect(achados(todos(modulosEn), PLURAL_POR_PARENTESE)).toEqual([]);
    expect(achados(todos(modulosPtBR), PLURAL_POR_PARENTESE)).toEqual([]);
  });

  it('no pt-BR toda frase com {{count}} é plural do i18next, salvo invariante declarada', () => {
    expect(contagemSemPlural(todos(modulosPtBR), INVARIANTES_NO_PT)).toEqual([]);
  });

  it('no pt-BR toda chave com `_one` tem `_zero` (o CLDR do pt põe o 0 em `one`)', () => {
    expect(semZero(todos(modulosPtBR))).toEqual([]);
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
    expect(
      semZero([
        ['s.origemRefs_one', '{{count}} referência'],
        ['s.origemRefs_other', '{{count}} referências'],
        ['s.passos_zero', '{{count}} passos'],
        ['s.passos_one', '{{count}} passo'],
        ['s.passos_other', '{{count}} passos'],
      ]),
    ).toEqual(['s.origemRefs']);
    expect(
      contagemSemPlural(
        [
          ['overview.activity.count', '{{count}} eventos'],
          ['overview.x_one', '{{count}} evento'],
          ['dashboard.online', '{{count}} online'],
        ],
        new Set(['dashboard.online']),
      ),
    ).toEqual(['overview.activity.count']);
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
    // AT-331: o 0 do pt cai em `one` sem `_zero`, e a forma única dizia "1 eventos".
    expect(i18n.t('aside.origemRefs', { ns: 'sessionPage', count: 0 })).toBe('origem: 0 referências');
    expect(i18n.t('aside.origemRefs', { ns: 'sessionPage', count: 1 })).toBe('origem: 1 referência');
    expect(i18n.t('activity.count', { ns: 'overview', count: 1 })).toBe('1 evento');
    expect(i18n.t('activity.count', { ns: 'overview', count: 0 })).toBe('0 eventos');
    expect(i18n.t('workspace.callsDetail', { ns: 'spend', count: 1, n: '1' })).toBe('1 chamada');
    expect(i18n.t('workspace.callsDetail', { ns: 'spend', count: 1234, n: '1.234' })).toBe(
      '1.234 chamadas',
    );

    await i18n.changeLanguage('en');
    expect(i18n.t('epicNode.storyCount', { ns: 'backlog', count: 1 })).toBe('1 story');
    expect(i18n.t('epicNode.storyCount', { ns: 'backlog', count: 3 })).toBe('3 stories');
    expect(i18n.t('epicNode.storyCount', { ns: 'backlog', count: 0 })).toBe('0 stories');
    expect(i18n.t('activity.count', { ns: 'overview', count: 1 })).toBe('1 event');
  });
});
