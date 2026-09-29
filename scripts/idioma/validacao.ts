/**
 * A validação PAGA de idioma e custo (AT-167), pelo protocolo da AT-082 e com
 * as decisões da AT-169. Esta é a parte PURA — matriz de casos, montagem das
 * mensagens, julgamento e relatório —, sem rede nem disco além de LER o código
 * do produto; quem chama o OpenRouter é `validar.ts`.
 *
 * O ponto que torna a medição honesta: o texto que o produto manda ao modelo
 * NÃO é reescrito aqui. Ele é LIDO dos arquivos do produto a cada execução —
 *   - a orientação de idioma (RN-622/623): `@textos`, a frase genérica,
 *     `@clausulas_do_artefato`, `@clausula_do_artefato_generica`, `@forma_curta`
 *     e `@ferramentas_de_artefato` de `Engine.Harness.IdiomaDaResposta`;
 *   - a frase de idioma do resumo (RN-621) e o molde do resumo, de
 *     `Engine.Harness.ContextManager`;
 *   - a persona do Criativo (`CRIATIVO_INSTRUCTIONS`), o seed que o engine lê;
 *   - as descrições das duas ferramentas do Criativo (`emit_artifact`,
 *     `ask_structured_questions`) e os tipos do `ArtifactSchemas`.
 * Se um desses arquivos mudar de forma, a leitura LANÇA nomeando o que não
 * achou — nunca cai num texto de reserva, que mediria outra coisa.
 *
 * O que NÃO é o produto, e fica declarado na nota de resultado: o system prompt
 * é só a persona (sem as camadas de AGENTS.md/contexto de projeto do
 * `ContextBuilder`); a compactação é FORÇADA depois de quatro turnos (o produto
 * compacta a 70% da janela); a retomada é o histórico reconstruído em texto; e
 * `max_tokens` tem teto (o produto não manda nenhum) por causa do orçamento.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AMPLIADA, PARAMETROS_AT080, classificar, type Idioma, type Veredito } from './heuristica.ts';

// --- Leitura do código do produto -------------------------------------------

export const FONTES = {
  orientacao: 'apps/engine/lib/engine/harness/idioma_da_resposta.ex',
  resumo: 'apps/engine/lib/engine/harness/context_manager.ex',
  persona: 'apps/api/src/db/seeds/criativo-instructions.ts',
  emitArtifact: 'apps/engine/lib/engine/harness/tools/emit_artifact.ex',
  perguntas: 'apps/engine/lib/engine/harness/tools/ask_structured_questions.ex',
  schemas: 'apps/engine/lib/engine/harness/artifact_schemas.ex',
} as const;

export interface TextosDaOrientacao {
  textos: Record<string, string>;
  /** A frase genérica, partida em volta do `#{idioma}`. */
  generica: [string, string];
  clausulas: Record<string, string>;
  clausulaGenerica: string;
  formaCurta: RegExp;
  ferramentasDeArtefato: string[];
}

function achar(fonte: string, re: RegExp, oQue: string, arquivo: string): RegExpMatchArray {
  const m = fonte.match(re);
  if (!m) throw new Error(`validação de idioma: não achei ${oQue} em ${arquivo} — o texto do produto mudou de forma`);
  return m;
}

export function lerOrientacao(fonte: string, arquivo: string = FONTES.orientacao): TextosDaOrientacao {
  const bloco = achar(fonte, /@textos %\{([\s\S]*?)\n  \}/, '@textos', arquivo)[1] ?? '';
  const textos: Record<string, string> = {};
  for (const m of bloco.matchAll(/"([^"]+)" =>\s*"([^"]+)"/g)) textos[m[1] as string] = m[2] as string;
  if (Object.keys(textos).length === 0) throw new Error(`validação de idioma: @textos vazio em ${arquivo}`);
  const gen = achar(fonte, /"(Respond in the language with BCP-47 code )#\{idioma\}(, unless[^"]*)"/, 'a frase genérica', arquivo);
  const clausulas: Record<string, string> = {};
  const blocoCl = achar(fonte, /@clausulas_do_artefato %\{([^}]*)\}/, '@clausulas_do_artefato', arquivo)[1] ?? '';
  for (const m of blocoCl.matchAll(/"([^"]+)" => "([^"]+)"/g)) clausulas[m[1] as string] = m[2] as string;
  const generica = achar(fonte, /@clausula_do_artefato_generica "([^"]+)"/, '@clausula_do_artefato_generica', arquivo)[1] as string;
  const forma = achar(fonte, /@forma_curta ~r\/(.+)\/\n/, '@forma_curta', arquivo)[1] as string;
  const ferramentas = achar(fonte, /@ferramentas_de_artefato ~w\(([\s\S]*?)\)/, '@ferramentas_de_artefato', arquivo)[1] ?? '';
  return {
    textos,
    generica: [gen[1] as string, gen[2] as string],
    clausulas,
    clausulaGenerica: generica,
    // O `\A`/`\z` do Elixir viram `^`/`$` (o valor nunca tem quebra de linha).
    formaCurta: new RegExp(forma.replace(/^\\A/, '^').replace(/\\z$/, '$')),
    ferramentasDeArtefato: ferramentas.split(/\s+/).filter(Boolean),
  };
}

/**
 * `IdiomaDaResposta.orientacao/1` e `/2` transcritas: a do autor e, numa chamada
 * que leva ferramenta de artefato com o idioma do projeto DIFERENTE e os dois
 * códigos na forma curta, a cláusula do artefato (RN-623).
 */
export function orientacao(
  t: TextosDaOrientacao,
  autor: string,
  projeto: string | null,
  ferramentas: readonly string[],
): string {
  const base = t.textos[autor] ?? `${t.generica[0]}${autor}${t.generica[1]}`;
  const gravaArtefato = ferramentas.some((f) => t.ferramentasDeArtefato.includes(f));
  if (!gravaArtefato || projeto === null || autor.toLowerCase() === projeto.toLowerCase()) return base;
  if (!t.formaCurta.test(autor) || !t.formaCurta.test(projeto)) return base;
  const clausula = t.clausulas[autor] ?? t.clausulaGenerica;
  return `${base} ${clausula}${projeto}.`;
}

export interface TextosDoResumo {
  /** O molde de hoje, com a frase de idioma (RN-621). */
  prefixo: string;
  /** O molde de antes da RN-621 — o mesmo, sem a frase. */
  prefixoAntigo: string;
  cabecalho: string;
}

export function lerResumo(fonte: string, arquivo: string = FONTES.resumo): TextosDoResumo {
  const frase = achar(fonte, /@instrucao_de_idioma "([^"]+)"/, '@instrucao_de_idioma', arquivo)[1] as string;
  const inicio = achar(fonte, /"(Resuma concisamente[^"]*)" <>/, 'o molde do resumo', arquivo)[1] as string;
  const cab = achar(fonte, /"content" => "(Resumo da conversa anterior \(compactado\):)\\n#\{summary\}"/, 'o cabeçalho do resumo', arquivo)[1] as string;
  return { prefixo: `${inicio}${frase}\n\n`, prefixoAntigo: `${inicio.trimEnd()}\n\n`, cabecalho: `${cab}\n` };
}

export function lerPersona(fonte: string, arquivo: string = FONTES.persona): string {
  return achar(fonte, /export const CRIATIVO_INSTRUCTIONS = `([\s\S]*?)`;/, 'CRIATIVO_INSTRUCTIONS', arquivo)[1] as string;
}

/** O heredoc de `defp descricao`, sem a indentação de 4 espaços do Elixir. */
export function lerHeredoc(fonte: string, arquivo: string): string {
  const corpo = achar(fonte, /defp descricao do\n(?:[\s\S]*?)"""\n([\s\S]*?)\n\s*"""/, 'o heredoc de descricao/0', arquivo)[1] as string;
  return corpo
    .split('\n')
    .map((l) => l.replace(/^ {4}/, ''))
    .join('\n');
}

export interface Ferramenta {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export function lerFerramentas(raiz: string): Ferramenta[] {
  const ler = (p: string) => readFileSync(join(raiz, p), 'utf8');
  const schemas = ler(FONTES.schemas);
  const emitiveis = achar(schemas, /@tool_emittable \[([^\]]*)\]/, '@tool_emittable', FONTES.schemas)[1] ?? '';
  const tipos = [...emitiveis.matchAll(/"([^"]+)"/g)].map((m) => {
    const tipo = m[1] as string;
    const campos = achar(schemas, new RegExp(`"${tipo}" => \\[([^\\]]*)\\]`), `os campos de ${tipo}`, FONTES.schemas)[1] ?? '';
    return `- \`${tipo}\` — payload EXIGE: ${[...campos.matchAll(/"([^"]+)"/g)].map((c) => `\`${c[1]}\``).join(', ')}`;
  });
  const emit = lerHeredoc(ler(FONTES.emitArtifact), FONTES.emitArtifact).replace('#{tipos}', tipos.join('\n'));
  const perguntas = lerHeredoc(ler(FONTES.perguntas), FONTES.perguntas);
  return [
    {
      type: 'function',
      function: {
        name: 'emit_artifact',
        description: emit,
        parameters: {
          type: 'object',
          properties: { type: { type: 'string' }, payload: { type: 'object' } },
          required: ['type', 'payload'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'ask_structured_questions',
        description: perguntas,
        parameters: {
          type: 'object',
          properties: {
            questions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  label: { type: 'string' },
                  type: { type: 'string', enum: ['text', 'textarea', 'select'] },
                  options: { type: 'array', items: { type: 'string' } },
                  allowOther: { type: 'boolean' },
                },
                required: ['id', 'label'],
              },
            },
          },
          required: ['questions'],
        },
      },
    },
  ];
}

/** Os resultados de ferramenta do produto, literais (`{:ok, …}` de cada `run/2`). */
export function resultadoDaFerramenta(nome: string, args: unknown): string {
  if (nome === 'emit_artifact') {
    const tipo = (args as { type?: unknown } | null)?.type;
    return `artefato ${typeof tipo === 'string' ? tipo : 'desconhecido'} emitido`;
  }
  if (nome === 'ask_structured_questions') {
    const qs = (args as { questions?: unknown } | null)?.questions;
    return `${Array.isArray(qs) ? qs.length : 0} pergunta(s) estruturada(s) enviada(s) ao usuário`;
  }
  return `ferramenta desconhecida: ${nome}`;
}

// --- A matriz C01–C17 (AT-082) ------------------------------------------------

/** O idioma do PROJETO nos casos: o do mantenedor. */
export const IDIOMA_DO_PROJETO = 'pt-BR';

export interface Turno {
  /** O idioma que a api resolve para o AUTOR desta mensagem (RN-618). */
  autor: string;
  texto: string;
  /** Idioma esperado da resposta, na granularidade do classificador; ausente = não se julga. */
  esperado?: Idioma;
  /** C14: este turno roda no OUTRO modelo da comparação. */
  noOutroModelo?: boolean;
  /** C04: compactar ANTES deste turno. */
  compactarAntes?: boolean;
  /** C15: reiniciar (reidratar) ANTES deste turno. */
  retomarAntes?: boolean;
  /** Resposta que a revisão humana sempre olha (a tradução do C11). */
  revisarSempre?: boolean;
}

export interface Caso {
  id: string;
  cenario: string;
  /** Uma lista de turnos por sessão; só o C17 tem duas. */
  sessoes: Turno[][];
  /** Entra no limiar de aceite da AT-169 (C01–C04 e C06–C15). */
  noLimiar: boolean;
}

const ANA = 'pt-BR';
const BOB = 'en';

const ABERTURA =
  'Quero criar um aplicativo para pequenas clínicas veterinárias organizarem a agenda de consultas e os lembretes de vacina dos animais. Hoje elas usam planilhas e o WhatsApp, e os tutores esquecem as datas. O que você acha que precisamos definir primeiro?';
const ABERTURA_EN =
  'I want to build an app that helps small veterinary clinics manage their appointments and send vaccine reminders to pet owners. Today they use spreadsheets and WhatsApp, and owners forget the dates. What do you think we need to define first?';

export const CASOS: readonly Caso[] = [
  { id: 'C01', cenario: 'pt-BR longo, automático', noLimiar: true, sessoes: [[{ autor: ANA, texto: ABERTURA, esperado: 'pt' }]] },
  {
    id: 'C02',
    cenario: 'pt-BR com erros de digitação',
    noLimiar: true,
    sessoes: [[{ autor: ANA, texto: 'vc pode ver oq ta errado nessa ideia? quero um app q avisa o tutor qdo a vacina do cachorro vence mas nao sei se clinica pagaria por isso', esperado: 'pt' }]],
  },
  {
    id: 'C03',
    cenario: 'pt-BR curto depois de C01',
    noLimiar: true,
    sessoes: [
      [
        { autor: ANA, texto: ABERTURA },
        { autor: ANA, texto: 'ok', esperado: 'pt' },
        { autor: ANA, texto: 'sim', esperado: 'pt' },
        { autor: ANA, texto: 'manda', esperado: 'pt' },
      ],
    ],
  },
  {
    id: 'C04',
    cenario: 'pt-BR em conversa longa até compactar',
    noLimiar: true,
    sessoes: [
      [
        { autor: ANA, texto: ABERTURA },
        { autor: ANA, texto: 'O público principal são clínicas com um a três veterinários, no interior, sem equipe de TI.' },
        { autor: ANA, texto: 'Uma regra importante: o lembrete de vacina nunca pode ser enviado fora do horário comercial da clínica.' },
        { autor: ANA, texto: 'Quanto à cobrança, pensei numa mensalidade fixa por clínica, sem limite de animais cadastrados.', esperado: 'pt' },
        { autor: ANA, texto: 'Resumindo o que conversamos até aqui, o que ainda falta para começar?', esperado: 'pt', compactarAntes: true },
      ],
    ],
  },
  {
    id: 'C05',
    cenario: 'espanhol legítimo (preferência pt-BR; fora do limiar)',
    noLimiar: false,
    sessoes: [
      [
        {
          autor: ANA,
          texto:
            'Quiero crear una aplicación para que las clínicas veterinarias pequeñas organicen su agenda y envíen recordatorios de vacunas a los dueños de mascotas. ¿Qué debería definir primero?',
          esperado: 'pt',
        },
      ],
    ],
  },
  { id: 'C06', cenario: 'inglês, automático (detectado en)', noLimiar: true, sessoes: [[{ autor: BOB, texto: ABERTURA_EN, esperado: 'en' }]] },
  {
    id: 'C07',
    cenario: 'misto pt/en',
    noLimiar: true,
    sessoes: [
      [
        { autor: ANA, texto: ABERTURA },
        { autor: ANA, texto: 'o deploy da versão de teste falhou, the pipeline says timeout after 10 minutes, o que eu faço?', esperado: 'pt' },
      ],
    ],
  },
  {
    id: 'C08',
    cenario: 'só código',
    noLimiar: true,
    sessoes: [
      [
        { autor: ANA, texto: ABERTURA },
        {
          autor: ANA,
          texto: '```ts\nexport function proximaVacina(ultima: Date, intervaloDias: number): Date {\n  return new Date(ultima.getTime() + intervaloDias * 86400000);\n}\n```',
          esperado: 'pt',
        },
      ],
    ],
  },
  {
    id: 'C09',
    cenario: 'log colado',
    noLimiar: true,
    sessoes: [
      [
        { autor: ANA, texto: ABERTURA },
        {
          autor: ANA,
          texto:
            "Error: connect ECONNREFUSED 127.0.0.1:5432\n    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1611:16)\n    at Client._connectionCallback (/app/node_modules/pg/lib/client.js:131:24)\nerrno: -111, code: 'ECONNREFUSED', syscall: 'connect'",
          esperado: 'pt',
        },
      ],
    ],
  },
  {
    id: 'C10',
    cenario: 'citação em espanhol',
    noLimiar: true,
    sessoes: [
      [
        {
          autor: ANA,
          texto:
            'Uma clínica da Argentina escreveu isto sobre a ideia: "Me encantaría que la aplicación enviara los recordatorios por WhatsApp y no por correo, porque nadie lee el correo." Você acha que devemos priorizar o WhatsApp no primeiro lançamento?',
          esperado: 'pt',
        },
      ],
    ],
  },
  {
    id: 'C11',
    cenario: 'tradução pontual',
    noLimiar: true,
    sessoes: [
      [
        { autor: ANA, texto: 'Traduza para o inglês: "O lembrete de vacina nunca pode ser enviado fora do horário comercial da clínica, e o tutor pode cancelar os lembretes quando quiser."', esperado: 'en', revisarSempre: true },
        { autor: ANA, texto: 'Obrigado. Agora me diga: essa regra deveria valer também para os lembretes de retorno de consulta?', esperado: 'pt' },
      ],
    ],
  },
  {
    id: 'C12',
    cenario: 'escolha explícita en, mensagens em pt',
    noLimiar: true,
    sessoes: [
      [
        { autor: BOB, texto: ABERTURA, esperado: 'en' },
        { autor: BOB, texto: 'O público principal são clínicas com um a três veterinários, sem equipe de TI.', esperado: 'en' },
      ],
    ],
  },
  {
    id: 'C13',
    cenario: 'turno com ferramenta',
    noLimiar: true,
    sessoes: [
      [
        {
          autor: ANA,
          texto:
            'Registre esta regra de negócio: o lembrete de vacina nunca pode ser enviado fora do horário comercial da clínica. Depois me diga qual seria a próxima regra que devemos discutir.',
          esperado: 'pt',
        },
      ],
    ],
  },
  {
    id: 'C14',
    cenario: 'troca de modelo',
    noLimiar: true,
    sessoes: [
      [
        { autor: ANA, texto: ABERTURA, noOutroModelo: true },
        { autor: ANA, texto: 'Faz sentido. E como a clínica cadastraria os animais no começo?', esperado: 'pt' },
      ],
    ],
  },
  {
    id: 'C15',
    cenario: 'retomada',
    noLimiar: true,
    sessoes: [
      [
        { autor: ANA, texto: ABERTURA },
        { autor: ANA, texto: 'Voltei. Onde a gente tinha parado mesmo?', esperado: 'pt', retomarAntes: true },
      ],
    ],
  },
  {
    id: 'C16',
    cenario: 'dois usuários, mesma sessão',
    noLimiar: false,
    sessoes: [
      [
        { autor: ANA, texto: ABERTURA, esperado: 'pt' },
        { autor: BOB, texto: "I'm Bob, I'll handle the business side of this project. How would we price this for small clinics?", esperado: 'en' },
        { autor: ANA, texto: 'Bob, acho que a mensalidade fixa é mais simples para a clínica entender. O que você acha disso, Criativo?', esperado: 'pt' },
        { autor: BOB, texto: 'Agreed. What is the riskiest assumption we are making here?', esperado: 'en' },
      ],
    ],
  },
  {
    id: 'C17',
    cenario: 'dois usuários, sessões diferentes',
    noLimiar: false,
    sessoes: [
      [
        { autor: ANA, texto: ABERTURA, esperado: 'pt' },
        { autor: ANA, texto: 'E qual seria o menor escopo para lançar?', esperado: 'pt' },
      ],
      [
        { autor: BOB, texto: ABERTURA_EN, esperado: 'en' },
        { autor: BOB, texto: 'And what would be the smallest scope to launch?', esperado: 'en' },
      ],
    ],
  },
];

// --- Julgamento ---------------------------------------------------------------

/**
 * Primeiro juiz (AT-082): o classificador local da AT-080, com a lista
 * `ampliada` e os parâmetros candidatos. A limpeza dele tira código, log e
 * citação — julga-se a PROSA.
 */
export function julgar(texto: string): Veredito {
  return classificar(texto, AMPLIADA, PARAMETROS_AT080).veredito;
}

/** Amostra determinística das concordantes para a revisão humana (1 em 10). */
export function naAmostra(chave: string): boolean {
  let h = 0;
  for (const c of chave) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 10 === 0;
}

export type Braco = 'baseline' | 'tratamento';

export interface Resposta {
  braco: Braco;
  modelo: string;
  caso: string;
  rodada: number;
  sessao: number;
  turno: number;
  esperado: Idioma;
  veredito: Veredito | 'falha';
  revisar: boolean;
  noLimiar: boolean;
  texto: string;
  usouFerramenta: string[];
  upstream: string[];
}

export interface Chamada {
  data: string;
  sha: string;
  braco: Braco;
  /** O modelo CHAMADO (no C14, o primeiro turno é o outro). */
  modelo: string;
  /** O modelo sob teste da conversa. */
  sobTeste: string;
  modeloRespondido: string | null;
  upstream: string | null;
  caso: string;
  rodada: number;
  sessao: number;
  turno: number;
  iteracao: number;
  papel: 'agente' | 'context-manager';
  compactouAntes: boolean;
  orientacao: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  cachedTokens: number | null;
  reasoningTokens: number | null;
  custoUsd: number | null;
  latenciaMs: number;
  erro: string | null;
}

export interface Celula {
  n: number;
  acerto: number;
  erro: number;
  espanhol: number;
  indeterminado: number;
  falha: number;
  revisar: number;
}

function celulaVazia(): Celula {
  return { n: 0, acerto: 0, erro: 0, espanhol: 0, indeterminado: 0, falha: 0, revisar: 0 };
}

export function somar(c: Celula, r: Resposta): void {
  c.n++;
  if (r.revisar) c.revisar++;
  if (r.veredito === 'falha') c.falha++;
  else if (r.veredito === 'indeterminado') c.indeterminado++;
  else if (r.veredito === r.esperado) c.acerto++;
  else {
    c.erro++;
    if (r.veredito === 'es') c.espanhol++;
  }
}

export function tabela(respostas: readonly Resposta[]): Map<string, Celula> {
  const m = new Map<string, Celula>();
  for (const r of respostas) {
    const k = `${r.caso}|${r.modelo}|${r.braco}`;
    const c = m.get(k) ?? celulaVazia();
    somar(c, r);
    m.set(k, c);
  }
  return m;
}

export interface Veredicto {
  modelo: string;
  espanholQuandoPt: number;
  acertoNoLimiar: number;
  nNoLimiar: number;
  indeterminadoNoLimiar: number;
  /** Acerto estrito: indeterminado e falha contam como NÃO acerto. */
  taxa: number;
  aprovado: boolean;
}

/** O limiar da AT-169 (resposta 6), só no braço TRATADO. */
export function veredicto(respostas: readonly Resposta[], modelo: string): Veredicto {
  const tratadas = respostas.filter((r) => r.modelo === modelo && r.braco === 'tratamento');
  const espanholQuandoPt = tratadas.filter((r) => r.esperado === 'pt' && r.veredito === 'es').length;
  const limiar = tratadas.filter((r) => r.noLimiar);
  const acerto = limiar.filter((r) => r.veredito === r.esperado).length;
  const indet = limiar.filter((r) => r.veredito === 'indeterminado').length;
  const taxa = limiar.length === 0 ? 0 : acerto / limiar.length;
  return {
    modelo,
    espanholQuandoPt,
    acertoNoLimiar: acerto,
    nNoLimiar: limiar.length,
    indeterminadoNoLimiar: indet,
    taxa,
    aprovado: limiar.length > 0 && espanholQuandoPt === 0 && taxa >= 0.95,
  };
}

/**
 * Custo incremental da orientação: a PRIMEIRA chamada de cada conversa tem a
 * mesma entrada nos dois braços, salvo a orientação — a diferença de
 * `prompt_tokens` (o `usage` que o OpenRouter devolve, nunca estimativa) é o
 * que ela custa. Pareado por modelo, caso, rodada e sessão.
 */
export function deltasDaOrientacao(chamadas: readonly Chamada[]): Map<string, { deltas: number[]; orientacao: string }> {
  const primeira = (c: Chamada) => c.turno === 0 && c.iteracao === 0 && c.papel === 'agente' && c.erro === null && c.promptTokens !== null;
  const base = new Map<string, Chamada>();
  for (const c of chamadas) if (c.braco === 'baseline' && primeira(c)) base.set(`${c.modelo}|${c.caso}|${c.rodada}|${c.sessao}`, c);
  const out = new Map<string, { deltas: number[]; orientacao: string }>();
  for (const c of chamadas) {
    if (c.braco !== 'tratamento' || !primeira(c) || c.orientacao === null) continue;
    const b = base.get(`${c.modelo}|${c.caso}|${c.rodada}|${c.sessao}`);
    if (!b || b.modelo !== c.modelo) continue;
    const k = `${c.modelo}|${c.orientacao}`;
    const e = out.get(k) ?? { deltas: [], orientacao: c.orientacao };
    e.deltas.push((c.promptTokens as number) - (b.promptTokens as number));
    out.set(k, e);
  }
  return out;
}

export function mediana(xs: readonly number[]): number {
  if (xs.length === 0) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  const meio = Math.floor(s.length / 2);
  return s.length % 2 ? (s[meio] as number) : ((s[meio - 1] as number) + (s[meio] as number)) / 2;
}
