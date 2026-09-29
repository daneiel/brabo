/**
 * O teste do MENU RESTRITO do Jev (AT-236/AT-238, EP-029): a política que
 * transforma a resposta do Jev num menu menor que o catálogo do agente, e as
 * contas de cobertura, restrição e economia de definições de ferramenta.
 *
 * AS POLÍTICAS FORAM ESCRITAS ANTES DE RODAR e não mudam depois de ver um
 * número (o spec fixa o que cada uma devolve). Decisões do dono que valem aqui:
 * o Jev só RESTRINGE o menu; se ele responde `responder_sem_ferramenta`, o
 * catálogo INTEIRO segue (P3, a regra da AT-236); teto de latência 2 000 ms.
 *
 *   P0  catálogo inteiro (a âncora: 100% trivial, 0% de restrição)
 *   P1  as 2 ferramentas mais prováveis do Jev
 *   P2  {a escolha do Jev, a ferramenta anterior da mesma execução}
 *   P3  = P2, mas com `responder_sem_ferramenta` (ou sem ferramenta anterior)
 *       o menu é o catálogo inteiro
 *   P4  {a escolha, a anterior, a 2ª do Jev} — até 3, só como referência
 *
 * Regras comuns, iguais para todas: resposta do Jev que falhou (timeout, erro,
 * escolha fora das opções) = catálogo inteiro (o Jev nunca tira ferramenta que
 * ele não soube julgar); ferramenta anterior que o agente não tem no catálogo
 * é ignorada; menu que sairia VAZIO vira o catálogo inteiro.
 *
 * COBERTURA é o TETO da acurácia ponta a ponta: o menu contém a ferramenta
 * certa, mas o modelo do agente ainda precisa escolhê-la entre as opções.
 */
import { serve, type Camada, type ChamadaClassificada } from './equivalencia.ts';
import { wilson, type Taxa } from './medicao.ts';
import { ranking, type Linha } from './medicao2.ts';
import { catalogoDoAtor, RESPONDER_SEM_FERRAMENTA, type Catalogo } from './passos.ts';

export type Politica = 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
export const POLITICAS: readonly Politica[] = ['P0', 'P1', 'P2', 'P3', 'P4'];

export const DESCRICAO_DA_POLITICA: Record<Politica, string> = {
  P0: 'catálogo inteiro (âncora)',
  P1: 'top-2 do Jev por probabilidade',
  P2: '{escolha do Jev, ferramenta anterior}',
  P3: 'P2, mas `responder_sem_ferramenta` ou sem anterior = catálogo inteiro',
  P4: '{escolha, anterior, 2ª do Jev} (referência)',
};

const unicas = (xs: readonly (string | null | undefined)[]): string[] => [...new Set(xs.filter((x): x is string => !!x))];

/** O menu que a política dá a este passo, sempre subconjunto do catálogo do agente e nunca vazio. */
export function menuDe(politica: Politica, l: Linha, catalogo: readonly string[]): string[] {
  if (politica === 'P0') return [...catalogo];
  // O Jev não soube julgar este passo: ele não tira nada do agente.
  if (l.status !== 'ok' || l.escolha === null) return [...catalogo];
  const dentro = new Set(catalogo);
  const escolha = l.escolha === RESPONDER_SEM_FERRAMENTA ? null : l.escolha;
  const anterior = l.anterior !== null && dentro.has(l.anterior) ? l.anterior : null;
  const top = ranking(l);
  let menu: string[];
  if (politica === 'P1') menu = top.slice(0, 2);
  else if (politica === 'P2') menu = unicas([escolha, anterior]);
  else if (politica === 'P3') {
    if (l.escolha === RESPONDER_SEM_FERRAMENTA || anterior === null) return [...catalogo];
    menu = unicas([escolha, anterior]);
  } else menu = unicas([escolha, anterior, ...top.slice(0, 2)]);
  menu = menu.filter((t) => dentro.has(t));
  return menu.length === 0 ? [...catalogo] : menu;
}

const serveAlgum = (menu: readonly string[], chamadas: readonly ChamadaClassificada[], camadas: readonly Camada[]): boolean =>
  menu.some((t) => chamadas.some((c) => serve(t, c, camadas)));
const servemTodas = (menu: readonly string[], chamadas: readonly ChamadaClassificada[], camadas: readonly Camada[]): boolean =>
  menu.every((t) => chamadas.some((c) => serve(t, c, camadas)));

/** Tamanho, em bytes, das definições completas das ferramentas do menu (0 quando o catálogo não traz `definicoes`). */
export const bytesDoMenu = (menu: readonly string[], c: Catalogo): number => menu.reduce((s, t) => s + (c.definicoes?.[t] ?? 0), 0);
/** Aproximação usada em todo o replay: 4 bytes por token. */
export const tokensDeBytes = (bytes: number): number => bytes / 4;

const taxa = (acertos: number, n: number): Taxa => ({ n, acertos, ic: wilson(acertos, n) });

export interface ResultadoDaPolitica {
  politica: Politica;
  /** Passos COM ferramenta (o denominador de tudo; os sem ferramenta ficam à parte). */
  n: number;
  coberturaEstrita: Taxa;
  cobertura: Taxa;
  /** Passos em que o menu ficou MENOR que o catálogo. */
  restricao: Taxa;
  /** A cobertura só nos passos restringidos (por equivalência) e (estrita). */
  coberturaNosRestringidos: Taxa;
  coberturaNosRestringidosEstrita: Taxa;
  /** Média de ferramentas expostas: antes (catálogo) e depois (menu). */
  ferramentasAntes: number;
  ferramentasDepois: number;
  /** Definições de ferramenta por chamada, em tokens (bytes/4): antes, depois e economia. */
  tokensAntes: number;
  tokensDepois: number;
  /** Menu em que QUALQUER escolha do modelo do agente acerta (piso da acurácia ponta a ponta). */
  garantido: Taxa;
  /** Cobertos, mas só por parte do menu: o modelo do agente decide sozinho aqui. */
  disputados: number;
  /** Nos disputados: quantos têm a escolha do Jev certa / a anterior certa (a outra errada). */
  disputadosSoJev: number;
  disputadosSoAnterior: number;
  /** Menus de UMA só ferramenta (o Jev e a anterior coincidem): o agente não escolhe nada. E quantos destes cobrem o passo. */
  menusDeUma: number;
  menusDeUmaCobrem: number;
  /** Passos sem ferramenta (o agente responde em texto): fora dos denominadores. */
  semFerramenta: number;
  semFerramentaSemRestricao: number;
  falhas: { rotulo: string; menu: string; n: number }[];
  porAgente: { ator: string; n: number; cobertura: Taxa; restricao: Taxa }[];
}

/** As contas de UMA política sobre UM conjunto de passos. Régua de cobertura: `camadas` (equivalência) e a estrita ao lado. */
export function medir(politica: Politica, ls: readonly Linha[], catalogo: Catalogo, camadas: readonly Camada[]): ResultadoDaPolitica {
  const com = ls.filter((l) => l.chamadas.length > 0);
  let cobEst = 0, cob = 0, restr = 0, cobR = 0, cobREst = 0, nR = 0, garant = 0, disp = 0, soJev = 0, soAnt = 0;
  let umaSo = 0, umaSoCobre = 0;
  let expostas = 0, todas = 0, tokDepois = 0, tokAntes = 0;
  const falhas = new Map<string, { rotulo: string; menu: string; n: number }>();
  const ag = new Map<string, { n: number; cob: number; restr: number }>();
  for (const l of com) {
    const cat = catalogoDoAtor(catalogo, l.ator) ?? [];
    const menu = menuDe(politica, l, cat);
    const restringido = menu.length < cat.length;
    const cobre = serveAlgum(menu, l.chamadas, camadas);
    const cobreEst = serveAlgum(menu, l.chamadas, []);
    if (menu.length === 1) {
      umaSo++;
      if (cobre) umaSoCobre++;
    }
    if (cobreEst) cobEst++;
    if (cobre) cob++;
    if (restringido) {
      restr++;
      nR++;
      if (cobre) cobR++;
      if (cobreEst) cobREst++;
    }
    if (cobre) {
      if (servemTodas(menu, l.chamadas, camadas)) garant++;
      else {
        disp++;
        if (l.escolha !== null && serveAlgum([l.escolha], l.chamadas, camadas)) soJev++;
        else soAnt++;
      }
    } else {
      const rotulo = [...new Set(l.chamadas.map((c) => c.ferramenta))].join('+');
      const menuTxt = [...menu].sort().join(' + ');
      const k = `${rotulo} ∉ ${menuTxt}`;
      const f = falhas.get(k) ?? { rotulo, menu: menuTxt, n: 0 };
      f.n++;
      falhas.set(k, f);
    }
    expostas += menu.length;
    todas += cat.length;
    tokDepois += tokensDeBytes(bytesDoMenu(menu, catalogo));
    tokAntes += tokensDeBytes(bytesDoMenu(cat, catalogo));
    const a = ag.get(l.ator) ?? { n: 0, cob: 0, restr: 0 };
    a.n++;
    if (cobre) a.cob++;
    if (restringido) a.restr++;
    ag.set(l.ator, a);
  }
  const n = com.length;
  const sem = ls.filter((l) => l.chamadas.length === 0);
  return {
    politica,
    n,
    coberturaEstrita: taxa(cobEst, n),
    cobertura: taxa(cob, n),
    restricao: taxa(restr, n),
    coberturaNosRestringidos: taxa(cobR, nR),
    coberturaNosRestringidosEstrita: taxa(cobREst, nR),
    ferramentasAntes: n ? todas / n : 0,
    ferramentasDepois: n ? expostas / n : 0,
    tokensAntes: n ? tokAntes / n : 0,
    tokensDepois: n ? tokDepois / n : 0,
    garantido: taxa(garant, n),
    disputados: disp,
    disputadosSoJev: soJev,
    disputadosSoAnterior: soAnt,
    menusDeUma: umaSo,
    menusDeUmaCobrem: umaSoCobre,
    semFerramenta: sem.length,
    semFerramentaSemRestricao: sem.filter((l) => {
      const cat = catalogoDoAtor(catalogo, l.ator) ?? [];
      return menuDe(politica, l, cat).length === cat.length;
    }).length,
    falhas: [...falhas.values()].sort((a, b) => b.n - a.n),
    porAgente: [...ag.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([ator, v]) => ({ ator, n: v.n, cobertura: taxa(v.cob, v.n), restricao: taxa(v.restr, v.n) })),
  };
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
export const fmtTaxa = (t: Taxa): string => (t.n === 0 ? '—' : `${t.acertos}/${t.n} = ${pct(t.acertos / t.n)} (${pct(t.ic[0])}–${pct(t.ic[1])})`);

/** O "sim" claro do dono: o LIMITE INFERIOR do IC 95% em pelo menos 90%. */
export const LIMITE_DO_SIM = 0.9;
export const chegaA90 = (t: Taxa): boolean => t.n > 0 && t.ic[0] >= LIMITE_DO_SIM;
/** Para ser uma política de VERDADE, restringe em pelo menos metade dos passos. */
export const RESTRICAO_MINIMA = 0.5;

/** Tabela de políticas × métricas de um conjunto de passos. */
export function tabelaDePoliticas(rs: readonly ResultadoDaPolitica[]): string {
  const out = [
    '| política | n | cobertura equiv. (IC 95%) | cobertura estrita | restringe | cobertura nos restringidos (equiv.) | ferramentas antes → depois | tokens de definição antes → depois |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const r of rs) {
    out.push(
      `| ${r.politica} | ${r.n} | ${fmtTaxa(r.cobertura)} | ${fmtTaxa(r.coberturaEstrita)} | ${fmtTaxa(r.restricao)} | ${fmtTaxa(r.coberturaNosRestringidos)} | ` +
        `${r.ferramentasAntes.toFixed(1)} → ${r.ferramentasDepois.toFixed(1)} | ${r.tokensAntes.toFixed(0)} → ${r.tokensDepois.toFixed(0)} |`,
    );
  }
  return out.join('\n');
}
