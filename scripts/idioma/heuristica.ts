/**
 * A heurística de idioma da AT-080 ("A — heurística própria, sem dependência"),
 * implementada AQUI, só no instrumento de medição (AT-160). Ela não é código do
 * produto: a AT-163 a leva para a api depois, com os números que este
 * instrumento produzir. Enquanto isso, nada no produto importa este arquivo.
 *
 * O desenho é o da especificação, sem invenção:
 *   - três línguas (`pt`, `es`, `en`) mais `indeterminado`;
 *   - pontuação por MARCADORES CONTRASTIVOS — palavras e grafias que uma língua
 *     tem e a outra não; as compartilhadas por pt e es (`está`, `para`, `como`,
 *     `que`) NÃO pontuam, porque são justamente as que produzem a confusão;
 *   - LIMPEZA antes de contar (código, log, citação, URL, identificador);
 *   - parâmetros candidatos: amostra de 10 mensagens / 2.000 caracteres,
 *     evidência mínima de 20 palavras, limiar 0,8, margem 0,3, histerese 2.
 *
 * Há DUAS listas de marcadores. `AT080` é a da especificação, literal. `AMPLIADA`
 * é uma proposta DESTE instrumento, escrita antes de rodar contra o corpus (a
 * partir de palavras funcionais frequentes, não do corpus) — existe porque a
 * lista da AT-080 tem sete palavras de inglês e sete de português, e medir só
 * ela diria apenas "sete palavras não bastam". Nenhuma das duas é decisão: o
 * número de cada uma é o que o instrumento imprime.
 */

export type Idioma = 'pt' | 'es' | 'en';
export type Veredito = Idioma | 'indeterminado';

export const IDIOMAS: readonly Idioma[] = ['pt', 'es', 'en'];

export interface Marcadores {
  nome: string;
  /** Palavras inteiras (minúsculas) que pontuam para a língua. */
  palavras: Record<Idioma, readonly string[]>;
  /** Terminações que pontuam (o token inteiro, minúsculo, termina assim). */
  sufixos: Record<Idioma, readonly string[]>;
  /** Sequências de letras que, contidas no token, pontuam. */
  grafias: Record<Idioma, readonly string[]>;
  /** Sinais de pontuação que pontuam a cada ocorrência (`¿`, `¡`). */
  sinais: Record<Idioma, readonly string[]>;
}

/** A lista da AT-080, literal ("Mecanismo candidato"). */
export const AT080: Marcadores = {
  nome: 'at080',
  palavras: {
    pt: ['você', 'não', 'também', 'então', 'isso', 'obrigado', 'pra'],
    es: ['usted', 'muy', 'pero', 'hola', 'gracias', 'qué', 'cómo', 'también', 'entonces', 'ahora'],
    en: ['the', 'and', 'is', 'you', 'what', 'this', 'with'],
  },
  sufixos: { pt: ['ção', 'ções'], es: ['ción', 'ciones'], en: [] },
  grafias: { pt: ['ã', 'õ', 'ê'], es: ['ñ'], en: [] },
  sinais: { pt: [], es: ['¿', '¡'], en: [] },
};

/**
 * Proposta deste instrumento. Critério de entrada de cada palavra: é frequente
 * na língua e NÃO existe (ou é raríssima) como palavra nas outras duas — com a
 * grafia sem acento incluída quando é assim que as pessoas digitam (`nao`,
 * `voce`). Ficaram de fora de propósito, por existirem nas duas ibéricas:
 * `está`, `para`, `como`, `que`, `por`, `no`, `tu`, `me`, `desde`, `todo`,
 * `nada`, `porque`, `mas`/`más`, `vamos`, `esta`; e `do`, que é
 * português e também inglês.
 */
export const AMPLIADA: Marcadores = {
  nome: 'ampliada',
  palavras: {
    pt: [
      ...AT080.palavras.pt,
      'vocês', 'voce', 'vc', 'vcs', 'nao', 'tbm', 'entao', 'obrigada', 'pro', 'isto', 'aquilo',
      'dos', 'das', 'ao', 'aos', 'às', 'um', 'uma', 'umas', 'uns', 'em', 'num', 'numa',
      'pelo', 'pela', 'pelos', 'pelas', 'nesse', 'nessa', 'neste', 'nesta', 'desse', 'dessa',
      'esse', 'essa', 'esses', 'essas', 'eu', 'ele', 'ela', 'eles', 'elas', 'nós', 'meu', 'minha',
      'seu', 'sua', 'dele', 'dela', 'muito', 'muita', 'muitos', 'tem', 'têm', 'tenho', 'agora',
      'depois', 'ainda', 'já', 'só', 'sim', 'oq', 'pq', 'tá', 'aqui', 'onde', 'quando', 'qual',
      'quais', 'com', 'sem', 'até', 'fazer', 'faz', 'fica', 'precisa', 'preciso', 'consegue',
      'consigo', 'pode', 'posso', 'deu', 'valeu', 'beleza', 'tudo', 'coisa', 'errado', 'certo',
      'obg', 'gente', 'rodar', 'roda', 'olha', 'vou', 'foi', 'ficou', 'deve',
    ],
    es: [
      ...AT080.palavras.es,
      'ustedes', 'el', 'los', 'las', 'y', 'del', 'al', 'es', 'un', 'una', 'yo', 'tú', 'él', 'ella',
      'ellos', 'nosotros', 'puedes', 'puede', 'puedo', 'hay', 'estoy', 'eso', 'esto',
      'aquí', 'donde', 'dónde', 'cuando', 'cuándo', 'cual', 'cuál', 'hacer', 'hace', 'tengo',
      'tiene', 'tienes', 'necesito', 'quiero', 'bien', 'sí', 'con', 'sin', 'hasta', 'ya', 'lo',
      'le', 'les', 'mucho', 'mucha', 'ahí', 'allí', 'porqué', 'también', 'mi', 'su', 'sus',
      'algo', 'nuevo', 'nueva', 'luego', 'debe', 'fue', 'voy', 'mira',
      'gracias', 'oye', 'vale',
    ],
    en: [
      ...AT080.palavras.en,
      'are', 'was', 'were', 'be', 'been', 'it', 'its', "it's", 'of', 'to', 'in', 'for', 'that',
      'not', 'have', 'has', 'can', 'does', 'why', 'how', 'please', 'i', 'my', 'we', 'they',
      'there', 'from', 'but', 'if', 'on', 'should', 'would', 'could', 'will', 'just', 'your',
      'which', 'when', 'where', 'about', 'into', 'than', 'then', "don't", "doesn't", "can't",
      'thanks', 'an', 'our', 'these', 'those', 'still', 'after', 'before', 'now', 'here', 'fix',
    ],
  },
  sufixos: {
    pt: [...AT080.sufixos.pt, 'ão', 'agem'],
    es: [...AT080.sufixos.es, 'dad', 'aje'],
    en: [],
  },
  // Nenhuma grafia nem sufixo de inglês (`th`, `w`, `-ing`, `-tion`): os
  // empréstimos técnicos que o pt-BR usa todo dia (`workflow`, `method`,
  // `logging`, `function`) pontuariam inglês numa frase portuguesa — o caso
  // difícil que a AT-080 nomeia. Inglês pontua só por palavra funcional.
  grafias: { pt: [...AT080.grafias.pt, 'nh', 'lh', 'ç'], es: [...AT080.grafias.es], en: [] },
  sinais: { pt: [], es: ['¿', '¡'], en: [] },
};

export const VARIANTES: Record<string, Marcadores> = { at080: AT080, ampliada: AMPLIADA };

export interface Parametros {
  /** Evidência mínima: palavras úteis na amostra depois da limpeza. */
  minPalavras: number;
  /** Fração mínima da pontuação total para a vencedora. */
  limiar: number;
  /** Diferença mínima de fração entre a vencedora e a segunda. */
  margem: number;
  /** Tamanho da amostra: as N últimas mensagens do usuário. */
  janelaMensagens: number;
  /** Teto da amostra em caracteres, depois da limpeza (mantém as mais recentes). */
  janelaCaracteres: number;
  /** Avaliações seguidas concordando com o idioma novo antes de trocar. */
  histerese: number;
  /** Trecho entre aspas com mais que isto de palavras é tratado como citação. */
  palavrasDeCitacao: number;
}

/** Os candidatos da AT-080, literais. */
export const PARAMETROS_AT080: Parametros = {
  minPalavras: 20,
  limiar: 0.8,
  margem: 0.3,
  janelaMensagens: 10,
  janelaCaracteres: 2000,
  histerese: 2,
  palavrasDeCitacao: 4,
};

// ------------------------------------------------------------------ limpeza

const CERCA = /```[\s\S]*?(```|$)/g;
const CRASE_SIMPLES = /`[^`\n]*`/g;
const URL = /\b(?:https?|ftp):\/\/\S+|\bwww\.\S+/gi;
const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
const ASPAS = /"([^"\n]*)"|“([^”\n]*)”|«([^»\n]*)»/g;

/** Linha com cara de log (item 2 da limpeza da AT-080). */
export function ehLinhaDeLog(linha: string): boolean {
  const l = linha.trim();
  if (l === '') return false;
  if (/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(l)) return true;
  if (/^\[?\d{2}:\d{2}:\d{2}/.test(l)) return true;
  if (/\b(ERROR|WARN|WARNING|INFO|DEBUG|FATAL|TRACE|PANIC)\b/.test(l)) return true;
  if (/^at\s+\S+.*[(:]/.test(l)) return true; // stack trace (JS/Java)
  if (/^File ".*", line \d+/.test(l)) return true; // stack trace (Python)
  if (/^Traceback \(most recent call last\)/.test(l)) return true;
  if (/\bexit code\b|\bexited with code\b|\bexit status \d+/i.test(l)) return true;
  if (/^\*\*\s*\(\w+Error\)/.test(l)) return true; // Elixir: ** (RuntimeError)
  if (/^(\/|\.\/|~\/|[A-Za-z]:\\)\S+$/.test(l)) return true; // linha que é só um caminho
  if (/^[$#>]\s/.test(l) && !/^>\s/.test(l)) return true; // prompt de shell ($ ls, # apt)
  return false;
}

/** Identificador técnico: snake_case, camelCase, hash, caminho, arquivo, número. */
export function ehIdentificador(token: string): boolean {
  if (/[_/\\]/.test(token)) return true;
  if (/\p{Ll}\p{Lu}/u.test(token)) return true;
  if (/\d/.test(token)) return true;
  if (/^[0-9a-f]{7,}$/i.test(token)) return true;
  if (/\w\.\w/.test(token)) return true; // arquivo.ts, pacote.modulo
  if (/^--?\w/.test(token)) return true; // --flag
  if (/[{}()[\]<>=;$]/.test(token)) return true;
  return false;
}

export interface Limpeza {
  texto: string;
  /** Palavras (tokens de letras) que sobraram. */
  palavras: string[];
  /** Palavras que existiam antes da limpeza. */
  palavrasAntes: number;
}

function palavrasDe(texto: string): string[] {
  return (texto.toLowerCase().match(/[\p{L}]+(?:'[\p{L}]+)?/gu) ?? []);
}

/**
 * Tira da evidência o que não é prosa do usuário (itens 1–4 da AT-080). O item
 * 5 (rótulo do formulário) e o 6 (mensagem do agente) são da EXTRAÇÃO: esses
 * textos nem chegam aqui.
 */
export function limpar(texto: string, p: Pick<Parametros, 'palavrasDeCitacao'> = PARAMETROS_AT080): Limpeza {
  const palavrasAntes = palavrasDe(texto).length;
  let t = texto.replace(CERCA, ' ').replace(CRASE_SIMPLES, ' ');
  t = t.replace(URL, ' ').replace(EMAIL, ' ');
  t = t.replace(ASPAS, (inteiro, a?: string, b?: string, c?: string) => {
    const dentro = a ?? b ?? c ?? '';
    return palavrasDe(dentro).length > p.palavrasDeCitacao ? ' ' : inteiro;
  });
  const linhas = t
    .split(/\r?\n/)
    .filter((l) => !/^\s*>/.test(l))
    .filter((l) => !ehLinhaDeLog(l));
  const tokens = linhas
    .join('\n')
    .split(/\s+/)
    .filter((tok) => tok !== '' && !ehIdentificador(tok.replace(/^[^\p{L}\d_/\\.-]+|[^\p{L}\d_]+$/gu, '')));
  const limpo = tokens.join(' ');
  return { texto: limpo, palavras: palavrasDe(limpo), palavrasAntes };
}

// --------------------------------------------------------------- pontuação

export type Pontos = Record<Idioma, number>;

export function pontuar(limpeza: Limpeza, m: Marcadores): Pontos {
  const pontos: Pontos = { pt: 0, es: 0, en: 0 };
  const conjuntos = Object.fromEntries(IDIOMAS.map((i) => [i, new Set(m.palavras[i])])) as Record<
    Idioma,
    Set<string>
  >;
  for (const palavra of limpeza.palavras) {
    for (const i of IDIOMAS) {
      // Um token pontua NO MÁXIMO um ponto por língua: "não" está na lista E
      // tem "ã", e contar duas vezes premiaria a palavra, não a língua.
      if (
        conjuntos[i].has(palavra) ||
        m.sufixos[i].some((s) => palavra.length > s.length + 1 && palavra.endsWith(s)) ||
        m.grafias[i].some((g) => palavra.includes(g))
      ) {
        pontos[i] += 1;
      }
    }
  }
  for (const i of IDIOMAS) {
    for (const sinal of m.sinais[i]) pontos[i] += limpeza.texto.split(sinal).length - 1;
  }
  return pontos;
}

export type Motivo =
  | 'decidido'
  | 'evidencia-insuficiente'
  | 'sem-marcadores'
  | 'abaixo-do-limiar'
  | 'margem-insuficiente';

export interface Classificacao {
  veredito: Veredito;
  /** A língua de maior pontuação, antes de qualquer limiar (null sem pontos). */
  vencedora: Idioma | null;
  confianca: number;
  margem: number;
  pontos: Pontos;
  palavras: number;
  palavrasAntes: number;
  motivo: Motivo;
}

export function classificarLimpo(
  limpeza: Limpeza,
  m: Marcadores,
  p: Pick<Parametros, 'minPalavras' | 'limiar' | 'margem'>,
): Classificacao {
  const pontos = pontuar(limpeza, m);
  const total = pontos.pt + pontos.es + pontos.en;
  const ordem = [...IDIOMAS].sort((a, b) => pontos[b] - pontos[a]);
  const [primeira, segunda] = ordem as [Idioma, Idioma, Idioma];
  const confianca = total === 0 ? 0 : pontos[primeira] / total;
  const margem = total === 0 ? 0 : (pontos[primeira] - pontos[segunda]) / total;
  const base = {
    vencedora: total === 0 ? null : primeira,
    confianca,
    margem,
    pontos,
    palavras: limpeza.palavras.length,
    palavrasAntes: limpeza.palavrasAntes,
  };
  if (limpeza.palavras.length === 0 || limpeza.palavras.length < p.minPalavras) {
    return { ...base, veredito: 'indeterminado', motivo: 'evidencia-insuficiente' };
  }
  if (total === 0) return { ...base, veredito: 'indeterminado', motivo: 'sem-marcadores' };
  if (confianca < p.limiar) return { ...base, veredito: 'indeterminado', motivo: 'abaixo-do-limiar' };
  // Empate exato na liderança cai aqui: margem 0 nunca passa.
  if (margem < p.margem || margem === 0) {
    return { ...base, veredito: 'indeterminado', motivo: 'margem-insuficiente' };
  }
  return { ...base, veredito: primeira, motivo: 'decidido' };
}

export function classificar(
  texto: string,
  m: Marcadores = AT080,
  p: Parametros = PARAMETROS_AT080,
): Classificacao {
  return classificarLimpo(limpar(texto, p), m, p);
}

// --------------------------------------------------- amostra e histerese

export interface Passo {
  classificacao: Classificacao;
  /** O idioma confiável DEPOIS desta mensagem (null = nenhum ainda). */
  estado: Idioma | null;
  trocou: boolean;
}

/**
 * Reproduz o que a api faria a cada mensagem do usuário (gatilho "a cada
 * mensagem", AT-080): monta a amostra com as N últimas mensagens já LIMPAS,
 * corta nas mais recentes até o teto de caracteres, classifica, e só troca o
 * estado depois de `histerese` avaliações SEGUIDAS apontando o mesmo idioma
 * novo. `indeterminado` nunca muda nada — e quebra a sequência.
 */
export function avaliarSequencia(
  mensagens: readonly string[],
  m: Marcadores = AT080,
  p: Parametros = PARAMETROS_AT080,
  inicial: Idioma | null = null,
): Passo[] {
  const limpas: string[] = [];
  const passos: Passo[] = [];
  let estado = inicial;
  let candidato: Idioma | null = null;
  let seguidas = 0;
  for (const mensagem of mensagens) {
    limpas.push(limpar(mensagem, p).texto);
    let amostra = limpas.slice(-p.janelaMensagens).join('\n');
    if (amostra.length > p.janelaCaracteres) amostra = amostra.slice(-p.janelaCaracteres);
    const classificacao = classificarLimpo(
      { texto: amostra, palavras: palavrasDe(amostra), palavrasAntes: palavrasDe(amostra).length },
      m,
      p,
    );
    let trocou = false;
    const v = classificacao.veredito;
    if (v === 'indeterminado' || v === estado) {
      candidato = null;
      seguidas = 0;
    } else {
      seguidas = v === candidato ? seguidas + 1 : 1;
      candidato = v;
      if (seguidas >= p.histerese) {
        estado = v;
        trocou = true;
        candidato = null;
        seguidas = 0;
      }
    }
    passos.push({ classificacao, estado, trocou });
  }
  return passos;
}
