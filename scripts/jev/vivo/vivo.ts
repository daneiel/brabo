/**
 * `pnpm --filter @brabo/scripts jev:vivo` — o teste AO VIVO da AT-239: as
 * mesmas tasks de dev agent, no mesmo modelo do OpenRouter, com o roteamento
 * do Jev LIGADO e DESLIGADO, medindo passos, passos que passaram pela
 * recuperação de chamada em texto, latência da execução inteira, custo (chat +
 * Jev, do `usage.cost` de cada resposta) e quedas do roteador para o catálogo
 * inteiro. Fora do produto: nada é gravado no banco; ver `laco.ts` para o que é
 * do produto e o que é porta.
 *
 *   --modelos a,b            (padrão: deepseek/deepseek-v4.1-flash,anthropic/claude-haiku-4.5)
 *   --tarefas T1-media,…     (padrão: as cinco de `tarefas.ts`)
 *   --rodadas 2              execuções por (modelo, tarefa, braço)
 *   --max-iteracoes 30       o produto usa 60 para dev; aqui é teto de GASTO
 *   --teto-usd 4.5           soma do `usage.cost` da pasta de saída; nenhuma
 *                            chamada sai com o gasto acumulado no teto
 *   --reserva-usd 0.1        não COMEÇA execução com menos que isto até o teto
 *   --saida <pasta>          (padrão: $XDG_CACHE_HOME/brabo/jev-vivo/, fora do git)
 *   --arquivo-de-chave <arq> lê `OPENROUTER_TEST_KEY=` dele (senão, do ambiente)
 *   --estimar                sem rede: o custo previsto (exige --preco por modelo)
 *   --preco m=0.3/1.2        USD por milhão, entrada/saída (repetível; só no --estimar)
 *   --passos 12              passos por execução assumidos no --estimar
 *   --relatorio              só a tabela e a regra de decisão do que está na saída
 *
 * Retoma: (modelo, tarefa, rodada, braço) que já está na saída não roda de novo
 * (exceto a interrompida pelo teto). A ordem dos braços alterna por tarefa e
 * rodada, para nenhum braço pegar sempre a hora mais lenta do provider. A chave
 * NUNCA é impressa nem gravada, e o processo do `terminal` não a herda.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { dentroDoRepositorio, lerChave } from '../analise.ts';
import { kickoffDoDev } from '../kickoff.ts';
import { executar, materializar, verificar } from './executor.ts';
import { executarLaco, type Braco, type Definicao } from './laco.ts';
import { chamarChat, chamarJev } from './rede.ts';
import {
  comparar,
  contaNaTabela,
  custoTotal,
  estimar,
  gastoDe,
  linhas,
  MINIMO_DE_EXECUCOES,
  tabela,
  type PrecoPorMilhao,
  type RegistroDeExecucao,
} from './resumo.ts';
import { TAREFAS, tarefaPorId, type Tarefa } from './tarefas.ts';

const AQUI = import.meta.dirname;
const RAIZ = resolve(AQUI, '..', '..', '..');
export const MODELOS_PADRAO = ['deepseek/deepseek-v4.1-flash', 'anthropic/claude-haiku-4.5'];

export interface Opcoes {
  modelos: string[];
  tarefas: string[];
  rodadas: number;
  maxIteracoes: number;
  tetoUsd: number;
  reservaUsd: number;
  saida: string;
  arquivoDeChave?: string;
  estimar: boolean;
  precos: Record<string, PrecoPorMilhao>;
  passos: number;
  relatorio: boolean;
}

export function lerOpcoes(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): Opcoes {
  const cache = env.XDG_CACHE_HOME || join(homedir(), '.cache');
  const o: Opcoes = {
    modelos: MODELOS_PADRAO,
    tarefas: TAREFAS.map((t) => t.id),
    rodadas: 2,
    maxIteracoes: 30,
    tetoUsd: 4.5,
    reservaUsd: 0.1,
    saida: join(cache, 'brabo', 'jev-vivo'),
    estimar: false,
    precos: {},
    passos: 12,
    relatorio: false,
  };
  const valor = (i: number, nome: string): string => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`${nome} exige um valor`);
    return v;
  };
  const numero = (v: string, nome: string): number => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new Error(`${nome}: número inválido "${v}"`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') continue;
    else if (a === '--modelos') o.modelos = valor(i++, a).split(',').filter(Boolean);
    else if (a === '--tarefas') o.tarefas = valor(i++, a).split(',').filter(Boolean).map((t) => tarefaPorId(t).id);
    else if (a === '--rodadas') o.rodadas = numero(valor(i++, a), a);
    else if (a === '--max-iteracoes') o.maxIteracoes = numero(valor(i++, a), a);
    else if (a === '--teto-usd') o.tetoUsd = numero(valor(i++, a), a);
    else if (a === '--reserva-usd') o.reservaUsd = numero(valor(i++, a), a);
    else if (a === '--saida') o.saida = resolve(valor(i++, a));
    else if (a === '--arquivo-de-chave') o.arquivoDeChave = valor(i++, a);
    else if (a === '--estimar') o.estimar = true;
    else if (a === '--relatorio') o.relatorio = true;
    else if (a === '--passos') o.passos = numero(valor(i++, a), a);
    else if (a === '--preco') {
      const m = /^(.+)=([\d.]+)\/([\d.]+)$/.exec(valor(i++, a));
      if (!m) throw new Error('--preco: use modelo=entrada/saida (USD por milhão)');
      o.precos[m[1]!] = { entrada: Number(m[2]), saida: Number(m[3]) };
    } else throw new Error(`opção desconhecida: ${a}`);
  }
  if (dentroDoRepositorio(o.saida)) throw new Error(`a saída carrega ids e respostas de modelo: fica FORA do checkout (${o.saida})`);
  return o;
}

export function lerFerramentas(): Definicao[] {
  const j = JSON.parse(readFileSync(join(AQUI, 'ferramentas-dev.json'), 'utf8')) as { ferramentas: Definicao[] };
  return j.ferramentas.map(({ name, description, parameters }) => ({ name, description, parameters }));
}

/** `Engine.Harness.Agents.identity/1` para `dev-*` (catalogo.json) + o contexto do projeto do ensaio. */
export function sistemaDoDev(t: Tarefa): string {
  const cat = JSON.parse(readFileSync(join(AQUI, '..', 'catalogo.json'), 'utf8')) as { identidades: Record<string, string> };
  const identidade = (cat.identidades['dev-*'] ?? 'Você é o agente dev-<modulo>.').replace('<modulo>', t.modulo);
  return `${identidade}\n\n## Contexto do projeto\nProjeto Node.js sem dependências externas (CommonJS). A suite roda com \`npm test\` (\`node --test\`).`;
}

/** A ordem dos braços alterna por (tarefa, rodada): metade das vezes cada um vai primeiro. */
export function ordemDosBracos(tarefa: string, rodada: number): Braco[] {
  const i = TAREFAS.findIndex((t) => t.id === tarefa);
  return (i + rodada) % 2 === 0 ? ['ligado', 'desligado'] : ['desligado', 'ligado'];
}

const chaveDe = (r: Pick<RegistroDeExecucao, 'modelo' | 'tarefa' | 'rodada' | 'braco'>): string => `${r.modelo}|${r.tarefa}|${r.rodada}|${r.braco}`;

export function lerSaida(arquivo: string): RegistroDeExecucao[] {
  return existsSync(arquivo)
    ? readFileSync(arquivo, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as RegistroDeExecucao)
    : [];
}

export function relatorio(rs: readonly RegistroDeExecucao[]): string {
  const ls = linhas(rs);
  const { comparacoes, veredito, passaram } = comparar(ls);
  const comp = comparacoes
    .map(
      (c) =>
        `- \`${c.modelo}\`: Δ "a task saiu" ${(c.deltaSucesso * 100).toFixed(0)} pts (${c.qualidade ? 'dentro' : 'fora'} da margem), ` +
        `custo por task que saiu ×${c.razaoDeCusto?.toFixed(2) ?? '—'} (${c.custo ? 'ok' : 'não'}), latência p50 ×${c.razaoDeLatencia?.toFixed(2) ?? '—'} (${c.latencia ? 'ok' : 'não'})`,
    )
    .join('\n');
  return [
    tabela(ls),
    '',
    comp || `(nenhum modelo com ${MINIMO_DE_EXECUCOES} execuções em cada braço)`,
    '',
    `Regra de decisão (escrita antes da rodada): **${veredito}**${passaram.length ? ` — passaram: ${passaram.join(', ')}` : ''}`,
    `Gasto total da saída (soma de usage.cost, inclusive interrompidas): US$ ${gastoDe(rs).toFixed(4)}`,
  ].join('\n');
}

async function main(): Promise<void> {
  const o = lerOpcoes(process.argv.slice(2));
  const arquivo = join(o.saida, 'execucoes.jsonl');
  const feitas = lerSaida(arquivo);

  if (o.relatorio) {
    console.log(relatorio(feitas));
    return;
  }

  const ferramentas = lerFerramentas();
  if (o.estimar) {
    const t = tarefaPorId(o.tarefas[0]!);
    const base = Math.ceil((sistemaDoDev(t).length + kickoffDoDev({ title: t.titulo }, { title: t.historia }).length + JSON.stringify(ferramentas).length) / 4);
    let total = 0;
    for (const m of o.modelos) {
      const preco = o.precos[m];
      if (!preco) throw new Error(`--estimar exige --preco ${m}=entrada/saida`);
      const e = estimar({ base, crescimento: 400, saida: 150, passos: o.passos, preco, execucoesPorBraco: o.tarefas.length * o.rodadas });
      total += e.totalUsd;
      console.log(`${m}: ~US$ ${e.porExecucaoUsd.toFixed(4)} por execução, ~US$ ${e.totalUsd.toFixed(3)} nos dois braços (${e.chamadas} chamadas; base ${base} tokens, ${o.passos} passos, +400 tokens/passo, 150 de saída, sem cache)`);
    }
    console.log(`total estimado: US$ ${total.toFixed(3)} (teto ${o.tetoUsd})`);
    return;
  }

  const chave = lerChave(o.arquivoDeChave);
  mkdirSync(o.saida, { recursive: true, mode: 0o700 });
  const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: RAIZ, encoding: 'utf8' }).trim();
  const data = new Date().toISOString().slice(0, 10);
  const prontas = new Set(feitas.filter(contaNaTabela).map(chaveDe));
  let gasto = gastoDe(feitas);
  console.error(`gasto acumulado na saída: US$ ${gasto.toFixed(4)} de ${o.tetoUsd}`);

  for (const modelo of o.modelos) {
    for (const id of o.tarefas) {
      const t = tarefaPorId(id);
      for (let rodada = 0; rodada < o.rodadas; rodada++) {
        for (const braco of ordemDosBracos(id, rodada)) {
          const k = { modelo, tarefa: id, rodada, braco };
          if (prontas.has(chaveDe(k))) continue;
          if (gasto + o.reservaUsd >= o.tetoUsd) {
            console.error(`teto: US$ ${gasto.toFixed(4)} + reserva ${o.reservaUsd} ≥ ${o.tetoUsd}; parando antes de ${chaveDe(k)}`);
            console.log(relatorio(lerSaida(arquivo)));
            return;
          }
          const dir = mkdtempSync(join(tmpdir(), 'jev-vivo-'));
          try {
            materializar(dir, t.arquivos);
            const exec = await executarLaco(
              {
                agente: `dev-${t.modulo}`,
                sistema: sistemaDoDev(t),
                pedido: kickoffDoDev({ title: t.titulo }, { title: t.historia }),
                catalogo: ferramentas,
                braco,
                maxIteracoes: o.maxIteracoes,
              },
              {
                chat: async (msgs, tools) => {
                  const r = await chamarChat(chave, modelo, msgs, tools);
                  gasto += r.custoUsd ?? 0;
                  return r;
                },
                jev: async (pedido, opcoes) => {
                  const r = await chamarJev(chave, pedido, opcoes);
                  gasto += r.custoUsd ?? 0;
                  return r;
                },
                executar: (nome, args, hist) => executar(dir, nome, args, hist),
                podeGastar: () => gasto < o.tetoUsd,
                agora: () => Math.round(performance.now()),
              },
            );
            const registro: RegistroDeExecucao = { ...exec, data, sha, ...k, verificacao: verificar(dir, t.verificacao, t.proibidoEmSrc) };
            appendFileSync(arquivo, JSON.stringify(registro) + '\n', { mode: 0o600 });
            console.error(
              `${chaveDe(k)}: ${exec.fim}, ${exec.passos.length} passos, ${registro.verificacao.ok ? 'saiu' : `não saiu (${registro.verificacao.motivo})`}, ` +
                `${(exec.latenciaMs / 1000).toFixed(1)} s, US$ ${custoTotal(registro).toFixed(4)} — acumulado US$ ${gasto.toFixed(4)}`,
            );
          } finally {
            rmSync(dir, { recursive: true, force: true });
          }
        }
      }
    }
  }
  console.log(relatorio(lerSaida(arquivo)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error((e as Error).message);
    process.exit(1);
  });
}
