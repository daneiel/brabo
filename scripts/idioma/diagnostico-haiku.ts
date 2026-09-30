/**
 * `pnpm --filter @brabo/scripts idioma:diagnosticar` — o diagnóstico do Haiku
 * (AT-279). A validação paga (AT-167) mostrou o Haiku respondendo em português
 * 10 de 10 vezes no C12 (preferência `en`, conversa em pt-BR) MESMO com a
 * orientação de idioma. A hipótese, não medida até aqui: para modelos da
 * Anthropic o OpenRouter iça a mensagem `system` do FIM da lista para o topo, e
 * ela perde ali a recência que tem no fim.
 *
 * Este script mede a POSIÇÃO da orientação, e só ela, no C12:
 *   1. `ultima-system`               como o produto faz hoje (RN-622);
 *   2. `system-fundido`              fundida no primeiro `system` (persona + orientação);
 *   3. `sufixo-user`                 sufixo da última mensagem do usuário, sem `system` novo;
 *   4. `ultima-system-e-sufixo-user` a última `system` MAIS o mesmo texto como sufixo.
 * O texto da orientação é LIDO do produto (`lerOrientacao`/`orientacao`), como na
 * validação: nada é reescrito aqui. NÃO altera o produto — só mede e propõe.
 *
 *   --arquivo-de-chave <arq>   `OPENROUTER_TEST_KEY=` (senão, do ambiente); a chave nunca é impressa
 *   --modelo <id>              padrão anthropic/claude-haiku-4.5
 *   --casos C12                padrão C12
 *   --rodadas 5
 *   --posicoes a,b,…           padrão: as quatro
 *   --turnos N                 para depois de N turnos por conversa (padrão: todos)
 *   --sem-clausula             controle: a orientação SEM a cláusula "Write project artifacts in pt-BR." (RN-623);
 *                              use outra `--saida`, porque as respostas ficam com a mesma `posicao`
 *   --teto-usd 0.19            pára ANTES da chamada que passaria disto (soma do `usage.cost`)
 *   --concorrencia 2
 *   --saida <pasta>            padrão $XDG_CACHE_HOME/brabo/validacao-idioma/<data>-diagnostico-haiku/
 *   --pular-existentes         não repete (posição, caso, rodada) já gravado
 *   --relatorio                só imprime o relatório do que está na saída
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { RAIZ_DO_REPOSITORIO, dentroDoRepositorio } from './corpus.ts';
import { Cliente, TetoAtingido, chaveDe, conversa, type Contexto } from './validar.ts';
import {
  CASOS,
  FONTES,
  POSICOES,
  lerFerramentas,
  lerOrientacao,
  lerPersona,
  lerResumo,
  type Chamada,
  type PosicaoDaOrientacao,
  type Resposta,
} from './validacao.ts';

export interface ResumoDaPosicao {
  posicao: PosicaoDaOrientacao;
  n: number;
  acerto: number;
  /** Veredito do classificador local por idioma. */
  porVeredito: Record<string, number>;
}

/** O acerto de idioma por posição, pelo classificador local (a leitura das respostas é à parte). */
export function resumoPorPosicao(respostas: readonly Resposta[]): ResumoDaPosicao[] {
  return POSICOES.flatMap((posicao) => {
    const rs = respostas.filter((r) => r.posicao === posicao);
    if (rs.length === 0) return [];
    const porVeredito: Record<string, number> = {};
    for (const r of rs) porVeredito[r.veredito] = (porVeredito[r.veredito] ?? 0) + 1;
    return [{ posicao, n: rs.length, acerto: rs.filter((r) => r.veredito === r.esperado).length, porVeredito }];
  });
}

export function gastoDasChamadas(chamadas: readonly Chamada[]): number {
  return chamadas.reduce((a, c) => a + (c.custoUsd ?? 0), 0);
}

export function relatorioDoDiagnostico(chamadas: readonly Chamada[], respostas: readonly Resposta[]): string {
  const L = ['| posição | n | acerto (classificador) | veredito do classificador |', '|---|---|---|---|'];
  for (const r of resumoPorPosicao(respostas)) {
    L.push(`| ${r.posicao} | ${r.n} | ${r.acerto}/${r.n} | ${Object.entries(r.porVeredito).map(([k, v]) => `${k} ${v}`).join(', ')} |`);
  }
  L.push('', `Gasto (soma do \`usage.cost\`): US$ ${gastoDasChamadas(chamadas).toFixed(4)} em ${chamadas.length} chamadas, ${chamadas.filter((c) => c.erro).length} com erro.`);
  return L.join('\n');
}

interface Opcoes {
  arquivoDeChave: string | null;
  modelo: string;
  casos: string[];
  rodadas: number;
  posicoes: PosicaoDaOrientacao[];
  turnosMax: number | undefined;
  semClausula: boolean;
  tetoUsd: number;
  concorrencia: number;
  saida: string;
  pularExistentes: boolean;
  relatorio: boolean;
}

function lerOpcoes(argv: string[]): Opcoes {
  const data = new Date().toISOString().slice(0, 10);
  const cache = process.env.XDG_CACHE_HOME || join(homedir(), '.cache');
  const o: Opcoes = {
    arquivoDeChave: null,
    modelo: 'anthropic/claude-haiku-4.5',
    casos: ['C12'],
    rodadas: 5,
    posicoes: [...POSICOES],
    turnosMax: undefined,
    semClausula: false,
    tetoUsd: 0.19,
    concorrencia: 2,
    saida: join(cache, 'brabo', 'validacao-idioma', `${data}-diagnostico-haiku`),
    pularExistentes: false,
    relatorio: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => {
      const x = argv[++i];
      if (x === undefined) throw new Error(`${a} exige um valor`);
      return x;
    };
    if (a === '--arquivo-de-chave') o.arquivoDeChave = v();
    else if (a === '--modelo') o.modelo = v();
    else if (a === '--casos') o.casos = v().split(',');
    else if (a === '--rodadas') o.rodadas = Number(v());
    else if (a === '--posicoes') {
      o.posicoes = v().split(',') as PosicaoDaOrientacao[];
      const ruins = o.posicoes.filter((p) => !POSICOES.includes(p));
      if (ruins.length) throw new Error(`posição desconhecida: ${ruins.join(', ')} (válidas: ${POSICOES.join(', ')})`);
    } else if (a === '--turnos') o.turnosMax = Number(v());
    else if (a === '--teto-usd') o.tetoUsd = Number(v());
    else if (a === '--concorrencia') o.concorrencia = Number(v());
    else if (a === '--saida') o.saida = resolve(v());
    else if (a === '--sem-clausula') o.semClausula = true;
    else if (a === '--pular-existentes') o.pularExistentes = true;
    else if (a === '--relatorio') o.relatorio = true;
    else throw new Error(`opção desconhecida: ${a}`);
  }
  if (dentroDoRepositorio(o.saida)) throw new Error('a saída mora FORA do checkout (as respostas não entram no git)');
  return o;
}

function lerJsonl<T>(arq: string): T[] {
  if (!existsSync(arq)) return [];
  return readFileSync(arq, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as T);
}

async function main(): Promise<void> {
  const o = lerOpcoes(process.argv.slice(2));
  mkdirSync(o.saida, { recursive: true, mode: 0o700 });
  const arqChamadas = join(o.saida, 'chamadas.jsonl');
  const arqRespostas = join(o.saida, 'respostas.jsonl');
  if (!o.relatorio) {
    const ler = (p: string) => readFileSync(join(RAIZ_DO_REPOSITORIO, p), 'utf8');
    const ferramentas = lerFerramentas(RAIZ_DO_REPOSITORIO);
    const cliente = new Cliente(chaveDe(o.arquivoDeChave), o.tetoUsd, 4000);
    const ctx: Contexto = {
      cliente,
      sha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: RAIZ_DO_REPOSITORIO, encoding: 'utf8' }).trim(),
      data: new Date().toISOString(),
      persona: lerPersona(ler(FONTES.persona)),
      ferramentas,
      nomes: ferramentas.map((f) => f.function.name),
      orient: lerOrientacao(ler(FONTES.orientacao)),
      resumo: lerResumo(ler(FONTES.resumo)),
      modelos: [o.modelo],
      gravarChamada: (c) => appendFileSync(arqChamadas, `${JSON.stringify(c)}\n`, { mode: 0o600 }),
      gravarResposta: (r) => appendFileSync(arqRespostas, `${JSON.stringify(r)}\n`, { mode: 0o600 }),
      ...(o.turnosMax !== undefined ? { turnosMax: o.turnosMax } : {}),
      ...(o.semClausula ? { semClausula: true } : {}),
    };
    const feitas = new Set(o.pularExistentes ? lerJsonl<Resposta>(arqRespostas).map((r) => `${r.posicao}|${r.caso}|${r.rodada}`) : []);
    // Rodada-major: se o teto cortar, todas as posições perdem a MESMA fatia final.
    const tarefas = CASOS.filter((c) => o.casos.includes(c.id)).flatMap((c) =>
      Array.from({ length: o.rodadas }, (_, r) => r).flatMap((r) =>
        o.posicoes.filter((p) => !feitas.has(`${p}|${c.id}|${r}`)).map((p) => ({ c, r, p })),
      ),
    );
    let i = 0;
    let parar: unknown = null;
    await Promise.all(
      Array.from({ length: Math.min(o.concorrencia, tarefas.length) }, async () => {
        while (i < tarefas.length && !parar) {
          const t = tarefas[i++] as (typeof tarefas)[number];
          try {
            await conversa(ctx, o.modelo, 'tratamento', t.c, t.r, t.p);
          } catch (e) {
            parar = e;
          }
        }
      }),
    );
    console.error(`${tarefas.length} conversas planejadas · usage.cost acumulado US$ ${cliente.gasto.toFixed(4)}${parar instanceof TetoAtingido ? ` · PAROU: ${parar.message}` : ''}`);
    if (parar && !(parar instanceof TetoAtingido)) throw parar;
  }
  console.log(relatorioDoDiagnostico(lerJsonl<Chamada>(arqChamadas), lerJsonl<Resposta>(arqRespostas)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e: unknown) => {
    console.error((e as Error).message);
    process.exit(1);
  });
}
