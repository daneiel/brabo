/**
 * `pnpm --filter @brabo/scripts jev:menu` — o relatório do teste do menu
 * restrito (AT-236/AT-238). OFFLINE: lê as respostas que `jev:analise` já
 * gravou (variante `escopo`, a vencedora) e aplica as políticas de `menu.ts`;
 * não chama o Jev, não gasta nada. Para passos novos sem resposta, rode antes
 * `jev:analise --variante escopo --metade ambas` com o snapshot atual.
 *
 *   --dados-cache <arq>   fotografia ATUAL do banco (define os passos)
 *   --dados-base <arq>    a fotografia da 2ª rodada (define a divisão): o que não está nela é "novo"
 *   --saida-dir <dir>     onde estão as `<variante>.jsonl` (padrão ~/.cache/brabo/replay-jev/v2)
 *   --variante <nome>     padrão `escopo`
 *   --sensibilidade       acrescenta as demais variantes (P1/P2/P3 na validação; NÃO escolhe nada)
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { linhasDaVariante, montarUniverso, type Universo } from './analise.ts';
import type { Dados } from './dados.ts';
import { ESTRITA, type Linha } from './medicao2.ts';
import { TODAS_AS_CAMADAS } from './equivalencia.ts';
import { chegaA90, DESCRICAO_DA_POLITICA, fmtTaxa, medir, POLITICAS, RESTRICAO_MINIMA, tabelaDePoliticas, type Politica, type ResultadoDaPolitica } from './menu.ts';
import type { Catalogo } from './passos.ts';
import { VARIANTES } from './variantes.ts';

const AQUI = dirname(fileURLToPath(import.meta.url));

export type Conjunto = 'validacao' | 'tuning' | 'novos';

/** Os passos de cada conjunto: a divisão vem da fotografia BASE; o que ela não conhecia é "novo" (nunca usado para escolher variante). */
export function conjuntos(atual: Universo, base: Universo, linhas: readonly Linha[]): Record<Conjunto, Linha[]> {
  const conhecidos = new Set(base.elegiveis.map((p) => p.id));
  const out: Record<Conjunto, Linha[]> = { validacao: [], tuning: [], novos: [] };
  for (const l of linhas) {
    if (!conhecidos.has(l.id)) out.novos.push(l);
    else out[base.metade.get(l.id)!].push(l);
  }
  return out;
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

export function relatorio(cj: Record<Conjunto, Linha[]>, catalogo: Catalogo): string {
  const out: string[] = [];
  const rodar = (ls: Linha[]) => POLITICAS.map((p) => medir(p, ls, catalogo, TODAS_AS_CAMADAS));
  const titulo: Record<Conjunto, string> = {
    validacao: 'Validação',
    tuning: 'Tuning (a metade em que as variantes foram escolhidas)',
    novos: 'Passos novos desde o snapshot da 2ª rodada (nunca vistos por nenhuma escolha)',
  };
  for (const c of ['validacao', 'tuning', 'novos'] as const) {
    const rs = rodar(cj[c]);
    out.push(`## ${titulo[c]}`, '', `Passos: ${cj[c].length} (${rs[0]!.n} com ferramenta, ${rs[0]!.semFerramenta} sem).`, '', tabelaDePoliticas(rs), '');
    out.push('| política | cobertura NOS restringidos, estrita | menus de uma só ferramenta (cobrem) | piso ponta a ponta (qualquer escolha acerta) | disputados (só o Jev / só a anterior) |', '|---|---|---|---|---|');
    for (const r of rs) {
      if (r.politica === 'P0') continue;
      out.push(`| ${r.politica} | ${fmtTaxa(r.coberturaNosRestringidosEstrita)} | ${r.menusDeUma} (${r.menusDeUmaCobrem}) | ${fmtTaxa(r.garantido)} | ${r.disputados} (${r.disputadosSoJev} / ${r.disputadosSoAnterior}) |`);
    }
    out.push('');
    const sem = rs.find((r) => r.politica === 'P3')!;
    out.push(`Sem ferramenta: ${sem.semFerramenta} passos; em P3 ${sem.semFerramentaSemRestricao} ficam com o catálogo inteiro.`, '');
    if (c === 'validacao') {
      for (const p of ['P1', 'P3'] as const) {
        const r = rs.find((x) => x.politica === p)!;
        out.push(`### ${p} por agente (${titulo[c]}, equivalência)`, '', '| agente | n | cobertura | restringe |', '|---|---|---|---|');
        for (const a of r.porAgente) out.push(`| ${a.ator} | ${a.n} | ${fmtTaxa(a.cobertura)} | ${fmtTaxa(a.restricao)} |`);
        out.push('', `### ${p}: onde a cobertura falha (${titulo[c]})`, '', '| ferramenta usada ∉ menu | n |', '|---|---|');
        for (const f of r.falhas.slice(0, 10)) out.push(`| ${f.rotulo} ∉ ${f.menu} | ${f.n} |`);
        out.push('');
      }
    }
  }
  const tudo = [...cj.validacao, ...cj.tuning, ...cj.novos];
  const est = POLITICAS.map((p) => medir(p, tudo, catalogo, ESTRITA));
  out.push('## Tudo junto, régua ESTRITA', '', tabelaDePoliticas(est).replaceAll('cobertura equiv.', 'cobertura estrita'), '');
  const juntos = rodar(tudo);
  out.push('## Tudo junto (validação + tuning + novos), equivalência', '', tabelaDePoliticas(juntos), '');
  return out.join('\n');
}

/** A política que serve: restringe de verdade (pelo menos metade dos passos) e o LIMITE INFERIOR do IC chega a 90%. */
export function veredito(rs: readonly ResultadoDaPolitica[]): { politica: Politica; restringe: boolean; sim: boolean }[] {
  return rs
    .filter((r) => r.politica !== 'P0')
    .map((r) => ({ politica: r.politica, restringe: r.restricao.acertos / Math.max(1, r.restricao.n) >= RESTRICAO_MINIMA, sim: chegaA90(r.cobertura) }));
}

function sensibilidade(u: Universo, base: Universo, dir: string, catalogo: Catalogo): string {
  const out = ['| variante | P1 cobertura | P2 cobertura | P3 cobertura | P3 restringe |', '|---|---|---|---|---|'];
  for (const nome of Object.keys(VARIANTES)) {
    const ls = conjuntos(u, base, linhasDaVariante(u, dir, nome, new Set())).validacao;
    if (ls.length === 0) continue;
    const r = (p: Politica) => medir(p, ls, catalogo, TODAS_AS_CAMADAS);
    out.push(`| ${nome} | ${fmtTaxa(r('P1').cobertura)} | ${fmtTaxa(r('P2').cobertura)} | ${fmtTaxa(r('P3').cobertura)} | ${pct(r('P3').restricao.acertos / Math.max(1, r('P3').n))} |`);
  }
  return out.join('\n');
}

function principal(): void {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const v = (nome: string): string | undefined => (args.includes(nome) ? args[args.indexOf(nome) + 1] : undefined);
  const cache = v('--dados-cache');
  const baseArq = v('--dados-base') ?? cache;
  const dir = v('--saida-dir') ?? join(process.env.XDG_CACHE_HOME && isAbsolute(process.env.XDG_CACHE_HOME) ? process.env.XDG_CACHE_HOME : join(homedir(), '.cache'), 'brabo', 'replay-jev', 'v2');
  const variante = v('--variante') ?? 'escopo';
  if (!cache || !baseArq) {
    console.error('diga --dados-cache <arq> (e --dados-base <arq> da 2ª rodada, se houver passos novos)');
    process.exit(2);
  }
  if (!VARIANTES[variante]) {
    console.error(`variante desconhecida: ${variante}`);
    process.exit(2);
  }
  const catalogo = JSON.parse(readFileSync(join(AQUI, 'catalogo.json'), 'utf8')) as Catalogo;
  const atual = montarUniverso(JSON.parse(readFileSync(resolve(cache), 'utf8')) as Dados, catalogo);
  const base = montarUniverso(JSON.parse(readFileSync(resolve(baseArq), 'utf8')) as Dados, catalogo);
  const trocados = base.elegiveis.filter((p) => atual.metade.get(p.id) !== base.metade.get(p.id)).length;
  console.error(`passos ${atual.elegiveis.length} (base ${base.elegiveis.length}); divisão trocada em ${trocados} passos da base (a divisão usada é a da base).`);
  const cj = conjuntos(atual, base, linhasDaVariante(atual, dir, variante, new Set()));
  console.log(relatorio(cj, catalogo));
  const rs = POLITICAS.map((p) => medir(p, cj.validacao, catalogo, TODAS_AS_CAMADAS));
  const linhas = ['## Veredito (validação)', ''];
  for (const x of veredito(rs)) {
    const r = rs.find((y) => y.politica === x.politica)!;
    linhas.push(
      `- ${x.politica} (${DESCRICAO_DA_POLITICA[x.politica]}): restringe em pelo menos metade dos passos: ${x.restringe ? 'sim' : 'NÃO'}; ` +
        `cobertura ${(r.cobertura.acertos / r.cobertura.n * 100).toFixed(1)}%, limite inferior do IC ${(r.cobertura.ic[0] * 100).toFixed(1)}% (${x.sim ? 'chega' : 'NÃO chega'} a 90%)`,
    );
  }
  // Tudo junto sem a Anamnese (pausada no produto): mais passos, mas o tuning já escolheu a variante — NÃO é validação limpa.
  const semAnamnese = [...cj.validacao, ...cj.tuning, ...cj.novos].filter((l) => l.ator !== 'anamnese');
  const rj = POLITICAS.map((p) => medir(p, semAnamnese, catalogo, TODAS_AS_CAMADAS));
  linhas.push('', `## Tudo junto sem a Anamnese (n = ${rj[0]!.n} com ferramenta; o tuning escolheu a variante, então NÃO é validação limpa)`, '', tabelaDePoliticas(rj), '');
  for (const x of veredito(rj)) {
    const r = rj.find((y) => y.politica === x.politica)!;
    linhas.push(`- ${x.politica}: cobertura ${(r.cobertura.acertos / r.cobertura.n * 100).toFixed(1)}%, limite inferior ${(r.cobertura.ic[0] * 100).toFixed(1)}% (${x.sim ? 'chega' : 'NÃO chega'} a 90%)`);
  }
  console.log(linhas.join('\n'));
  if (args.includes('--sensibilidade')) console.log(`\n## Sensibilidade à variante de state (validação; não escolhe nada)\n\n${sensibilidade(atual, base, dir, catalogo)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) principal();
