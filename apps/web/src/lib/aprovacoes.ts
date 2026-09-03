import type { ActionType, PsychologistHypothesis } from './api-types';
import { AGENTS } from './agents';

/**
 * A LINGUAGEM das decisões que o produto pede ao usuário — verbo e frase, num
 * módulo só (FASE 19, RN-096).
 *
 * O que existia antes era um verbo por tipo dentro do `ApprovalCard` e, para
 * todo tipo sem corpo visual próprio, um despejo de `chave: JSON.stringify(
 * valor)` do payload cru. Quem lia a fila de aprovações via `{"worktree":
 * "/w/dev-api","branch":"feature/x","author":"dev-api[bot]"}` e tinha de
 * adivinhar o que ia acontecer se clicasse em Aprovar. A frase existe para
 * responder essa pergunta — o que ACONTECE — antes de qualquer detalhe.
 *
 * Três decisões que valem registro:
 *
 * - **A frase é derivada do payload, e degrada.** Nenhuma delas assume que a
 *   chave existe: payload vazio ainda produz uma frase verdadeira, só menos
 *   específica. É o que permite o teste exigir frase para TODO tipo do backend
 *   sem precisar de uma fixture realista por tipo.
 * - **O tipo desconhecido não quebra e não despeja.** `verboDaAcao` e
 *   `fraseDaAcao` aceitam `string`, não `ActionType`: um tipo que o backend
 *   ganhou e o web ainda não conhece cai no verbo neutro e em `frase: null`, e
 *   quem renderiza mostra "ver detalhes" com o payload COLAPSADO. A união do
 *   web já ficou defasada duas vezes (ver `api-types.ts`), então o caminho do
 *   tipo desconhecido é um caminho real, não teórico.
 * - **A hipótese do Psicólogo fala a mesma língua.** Aceitar uma hipótese não
 *   é uma `proposed_action`, mas é a MESMA pergunta ("o que acontece se eu
 *   disser sim?"), e o efeito dela chega depois como `instruction_patch`. Por
 *   isso o verbo da hipótese é literalmente o verbo do `instruction_patch`, e
 *   não um vocabulário paralelo que um dia diverge.
 */

/** O que a UI mostra no lugar da frase quando o tipo não tem uma. */
export const SEM_FRASE = 'ver detalhes';

export interface AcaoLegivel {
  /** Complemento do nome do ator: "Dev API **quer executar comando**". */
  verbo: string;
  /** A frase inteira do que vai acontecer. `null` quando o tipo não tem uma. */
  frase: string | null;
}

const VERBO_DESCONHECIDO = 'propõe uma ação';

export const VERBO_DA_ACAO: Record<ActionType, string> = {
  terminal: 'quer executar comando',
  git_commit: 'propõe alteração',
  git_push: 'quer enviar alterações',
  pr_open: 'abriu pull request',
  spend: 'solicita gasto extra',
  git_repo_create: 'quer criar o repositório',
  git_branch_create: 'quer criar uma branch',
  git_branch_protect: 'quer proteger uma branch',
  write_file: 'propõe escrever um arquivo',
  open_adr_pr: 'abriu pull request de ADR',
  open_infra_pr: 'abriu pull request de infra',
  git_merge: 'quer fazer merge',
  instruction_patch: 'propõe ajustar a instrução de um agente',
  parallelize: 'quer mais um agente em paralelo',
  raise_max_parallel: 'propõe subir o teto de paralelismo',
  propose_execution_plan: 'propõe o plano de execução',
  assess_implementability: 'avalia a implementabilidade de uma story',
  container_start: 'quer subir o container do projeto',
};

type Payload = Record<string, unknown>;

function texto(payload: Payload, chave: string): string | undefined {
  const valor = payload[chave];
  return typeof valor === 'string' && valor.trim() !== '' ? valor : undefined;
}

function numero(payload: Payload, chave: string): number | undefined {
  const valor = payload[chave];
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : undefined;
}

function quantidade(payload: Payload, chave: string): number | undefined {
  const valor = payload[chave];
  return Array.isArray(valor) ? valor.length : undefined;
}

/** Primeiro valor de texto entre várias chaves — payloads da mesma família
 *  nomeiam a mesma coisa de formas diferentes (`message`/`motivo`/`rationale`). */
function primeiro(payload: Payload, ...chaves: string[]): string | undefined {
  for (const chave of chaves) {
    const valor = texto(payload, chave);
    if (valor) return valor;
  }
  return undefined;
}

/** Corta o que é longo demais para uma frase — o valor inteiro continua no
 *  corpo do card, que é onde se lê um comando de 300 caracteres. */
function curto(valor: string, limite = 120): string {
  const linha = valor.replace(/\s+/g, ' ').trim();
  return linha.length > limite ? `${linha.slice(0, limite - 1)}…` : linha;
}

function nomeDoAgente(id: string | undefined): string {
  if (!id) return 'um agente';
  return AGENTS[id as keyof typeof AGENTS]?.name ?? id;
}

function plural(n: number, singular: string, pluralForma: string): string {
  return `${n} ${n === 1 ? singular : pluralForma}`;
}

/**
 * A frase de cada tipo. Escritas no PRESENTE e na voz do efeito ("Executa…",
 * "Abre…"), não na voz da intenção ("gostaria de…"): o que o usuário decide é
 * se isso acontece.
 */
const FRASE_DA_ACAO: Record<ActionType, (payload: Payload) => string> = {
  terminal: (p) => {
    const comando = texto(p, 'command');
    return comando
      ? `Executa o comando "${curto(comando)}" no terminal do projeto.`
      : 'Executa um comando no terminal do projeto.';
  },

  git_commit: (p) => {
    const arquivos = quantidade(p, 'files');
    const caminho = texto(p, 'path');
    const branch = texto(p, 'branch');
    const mensagem = texto(p, 'message');

    const alvo = arquivos
      ? ` de ${plural(arquivos, 'arquivo', 'arquivos')}`
      : caminho
        ? ` do arquivo ${caminho}`
        : '';
    const onde = branch ? ` na branch ${branch}` : ' no repositório do projeto';
    const porque = mensagem ? `: "${curto(mensagem)}"` : '';
    return `Registra um commit${alvo}${onde}${porque}.`;
  },

  git_push: (p) => {
    const branch = texto(p, 'branch');
    return branch
      ? `Envia a branch ${branch} para o repositório remoto do projeto.`
      : 'Envia a branch de trabalho para o repositório remoto do projeto.';
  },

  pr_open: (p) => {
    const origem = texto(p, 'sourceBranch');
    const destino = texto(p, 'targetBranch');
    const titulo = texto(p, 'title');
    const rota = origem && destino ? ` de ${origem} para ${destino}` : origem ? ` a partir de ${origem}` : '';
    const nome = titulo ? `: "${curto(titulo)}"` : '';
    return `Abre uma pull request${rota}${nome}.`;
  },

  spend: (p) => {
    const motivo = primeiro(p, 'motivo', 'rationale', 'reason');
    const base = 'Autoriza gasto de tokens acima do orçamento já definido';
    return motivo ? `${base} — ${curto(motivo)}.` : `${base}.`;
  },

  git_repo_create: (p) => {
    const nome = texto(p, 'name');
    const provider = texto(p, 'provider');
    const visibilidade = texto(p, 'visibility');
    const qual = nome ? ` ${nome}` : ' do projeto';
    const onde = provider ? ` no ${provider}` : ' no provider de git configurado';
    const como = visibilidade ? `, com visibilidade ${visibilidade}` : '';
    return `Cria o repositório${qual}${onde}${como}.`;
  },

  git_branch_create: (p) => {
    const branch = texto(p, 'branchName');
    const origem = texto(p, 'fromRef');
    const qual = branch ? ` ${branch}` : '';
    const partindo = origem ? ` a partir de ${origem}` : '';
    return `Cria a branch${qual}${partindo} no repositório do projeto.`;
  },

  git_branch_protect: (p) => {
    const branch = texto(p, 'branchName');
    const qual = branch ? ` ${branch}` : '';
    return `Liga a proteção da branch${qual} — depois disso, nada entra nela sem pull request.`;
  },

  write_file: (p) => {
    const caminho = texto(p, 'path');
    const qual = caminho ? ` ${caminho}` : '';
    return `Escreve o arquivo${qual} no workspace — fora da área que este agente altera sozinho.`;
  },

  open_adr_pr: (p) => {
    const titulo = texto(p, 'title');
    const slug = texto(p, 'slug');
    const nome = titulo ? ` "${curto(titulo)}"` : '';
    const arquivo = slug ? ` em docs/adr/${slug}.md` : '';
    return `Abre uma pull request com a ADR${nome}${arquivo}.`;
  },

  open_infra_pr: (p) => {
    const titulo = texto(p, 'title');
    const arquivos = quantidade(p, 'files');
    const nome = titulo ? ` "${curto(titulo)}"` : '';
    const quantos = arquivos ? ` com ${plural(arquivos, 'arquivo', 'arquivos')}` : '';
    return `Abre uma pull request de infraestrutura${nome}${quantos}.`;
  },

  git_merge: (p) => {
    const pr = primeiro(p, 'pullRequestId');
    const destino = texto(p, 'targetBranch');
    const qual = pr ? ` #${pr}` : '';
    const onde = destino ? ` em ${destino}` : '';
    return `Faz o merge da pull request${qual}${onde} no repositório do projeto.`;
  },

  instruction_patch: (p) => {
    const agente = nomeDoAgente(texto(p, 'agent'));
    const versao = numero(p, 'fromVersion');
    const transicao = versao !== undefined ? `, da v${versao} para a v${versao + 1}` : '';
    return `Altera o arquivo de instrução de ${agente}${transicao} — vale para os próximos turnos dele.`;
  },

  parallelize: (p) => {
    const modulo = texto(p, 'module');
    const ativos = numero(p, 'ativosNaSessao');
    const teto = numero(p, 'maxParallel');
    const onde = modulo ? ` no módulo ${modulo}` : '';
    const conta =
      ativos !== undefined && teto !== undefined
        ? ` — a sessão já tem ${plural(ativos, 'agente ativo', 'agentes ativos')} para um teto de ${teto}`
        : '';
    return `Põe mais um agente para trabalhar em paralelo${onde}${conta}.`;
  },

  raise_max_parallel: (p) => {
    const area = texto(p, 'area');
    const atual = numero(p, 'atual');
    const proposto = numero(p, 'proposto');
    const qual = area ? ` da área ${area}` : '';
    const salto = atual !== undefined && proposto !== undefined ? ` de ${atual} para ${proposto}` : '';
    return `Sobe o teto de agentes em paralelo${qual}${salto} — muda quanto o produto gasta sem perguntar.`;
  },

  propose_execution_plan: (p) => {
    const total = numero(p, 'totalAgentes');
    const modulos = quantidade(p, 'modulos');
    const resumo = texto(p, 'resumo');
    const quantos =
      total !== undefined && modulos !== undefined
        ? ` — ${plural(total, 'agente', 'agentes')} em ${plural(modulos, 'módulo', 'módulos')}`
        : '';
    const porque = resumo ? `: "${curto(resumo)}"` : '';
    // Aprovar aqui NÃO sobe agente nenhum — só aceita o plano. Quem sobe é
    // uma ação separada (ativar execução), depois. Ver o comentário de
    // `DevLeadTools.classificar/4`.
    return `Aprova o plano de execução do Dev Lead${quantos}${porque}. Você ainda decide quando ativar a execução.`;
  },

  assess_implementability: (p) => {
    const parecer = texto(p, 'parecer');
    const justificativa = texto(p, 'justificativa');
    const rotulo = parecer === 'inviavel' ? 'INVIÁVEL' : 'implementável';
    const porque = justificativa ? `: "${curto(justificativa)}"` : '';
    // Gate `implementavel` (docs/gates.yml, ADR 0090) — o parecer do Dev
    // Lead, a partir do plano de teste da QA-estratégia. Aprovar registra o
    // parecer; não sobe agente nenhum.
    return `Registra a story como ${rotulo}${porque}.`;
  },

  container_start: (p) => {
    const imagem = texto(p, 'imagem');
    const network = texto(p, 'network');
    const resources = p.resources as
      | { cpus?: unknown; memoryMb?: unknown }
      | undefined;
    const cpus = typeof resources?.cpus === 'number' ? resources.cpus : undefined;
    const memoriaMb =
      typeof resources?.memoryMb === 'number' ? resources.memoryMb : undefined;

    const qual = imagem ? ` de ${imagem}` : '';
    const specs =
      cpus !== undefined && memoriaMb !== undefined
        ? ` com ${cpus} CPU e ${memoriaMb} MB de memória`
        : '';
    const rede = network ? `, rede ${network}` : '';
    // A Infra elege entre as candidatas do roteamento do Arquiteto (ADR
    // 0130/0133) — o container sobe com esta imagem/rede/recursos, montando
    // a pasta do projeto. NÃO diz que os dev agents passam a trabalhar
    // dentro dele: essa etapa ainda não existe (CLAUDE.md, "Estado atual e
    // aberto") — prometer isso aqui seria a tela afirmando o que o código
    // não faz.
    return `Sobe o container${qual}${specs}${rede}, montando a pasta do projeto.`;
  },
};

/** O verbo do tipo, ou um verbo neutro quando o web ainda não o conhece. */
export function verboDaAcao(actionType: string): string {
  return VERBO_DA_ACAO[actionType as ActionType] ?? VERBO_DESCONHECIDO;
}

/** A frase do tipo, ou `null` quando o web ainda não o conhece. */
export function fraseDaAcao(actionType: string, payload: Payload = {}): string | null {
  const escrever = FRASE_DA_ACAO[actionType as ActionType];
  return escrever ? escrever(payload) : null;
}

export function descreverAcao(actionType: string, payload: Payload = {}): AcaoLegivel {
  return { verbo: verboDaAcao(actionType), frase: fraseDaAcao(actionType, payload) };
}

/**
 * A hipótese do Psicólogo na mesma língua da aprovação.
 *
 * Aceitar NÃO cria uma `proposed_action` (o Psicólogo é só leitura): manda a
 * hipótese para a fila da Anamnese, e é ela que depois propõe o
 * `instruction_patch` — que aí sim vem para aprovação. A frase diz isso, e não
 * "a instrução será alterada": a diferença é a única coisa que o usuário
 * precisa saber para decidir sem medo.
 */
export function descreverHipotese(hypothesis: PsychologistHypothesis): AcaoLegivel {
  const agente = nomeDoAgente(hypothesis.agenteAlvo);
  const verbo = VERBO_DA_ACAO.instruction_patch;

  if (hypothesis.status === 'accepted') {
    return {
      verbo,
      frase: `Aceita — seguiu para a Anamnese, que decide se propõe um ajuste na instrução de ${agente}.`,
    };
  }
  if (hypothesis.status === 'dismissed') {
    return { verbo, frase: `Descartada — nada mudou na instrução de ${agente}.` };
  }
  return {
    verbo,
    frase:
      `Aceitar manda esta hipótese para a Anamnese, que pode propor um ajuste na instrução de ` +
      `${agente} — o ajuste ainda vem para você aprovar.`,
  };
}
