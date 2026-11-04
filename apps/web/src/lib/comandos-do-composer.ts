import type { TFunction } from 'i18next';
import type { ProposedAction } from './api-types';
import { nomeDoAgente } from './agents';

/**
 * AT-717: o catálogo dos comandos de barra do composer e a leitura do gatilho
 * (`@`/`/`) no campo. Tudo PURO: o campo segue não controlado (RN-882) e quem
 * chama passa o texto e o cursor. Nenhum comando cria `proposed_action`.
 */
export type TipoDeComando = 'acao' | 'prompt';

export interface ItemDoMenu {
  /** Id interno e estável; o nome localizado é só o que se mostra. */
  id: string;
  tipo: 'agente' | TipoDeComando;
  rotulo: string;
  descricao?: string;
  /** Motivo em TEXTO de o item estar inerte (RN-102: `title` em desabilitado não abre). */
  inerte?: string;
  executar: () => void;
}

export interface AcaoDeUi {
  chave: string;
  aoClicar: () => void | Promise<void>;
  desabilitada?: boolean;
  motivo?: string;
}

export interface ContextoDeComandos {
  t: TFunction;
  /** As ações de passo que o composer já monta (RN-976), com o mesmo predicado e handler. */
  acoes: AcaoDeUi[];
  streaming: boolean;
  handleCancel: () => void | Promise<void>;
  inserirTexto: (texto: string) => void;
  aprovar: () => void;
  mostrarAjuda: () => void;
  /** AT-724: só LEEM (catálogo e busca do RAG); o resultado vai a um painel, nunca a proposed_action. */
  listarSkills: () => void;
  buscar: () => void;
}

interface Definicao {
  id: string;
  tipo: TipoDeComando;
  /** `chave` da ação de passo que ele dispara (só ações de UI do RN-976). */
  acao?: string;
  disponivel?: (c: ContextoDeComandos) => boolean;
  executar: (c: ContextoDeComandos) => void;
}

const DO_PASSO = (id: string): Definicao => ({
  id,
  tipo: 'acao',
  acao: id,
  disponivel: (c) => c.acoes.some((a) => a.chave === id),
  executar: (c) => void c.acoes.find((a) => a.chave === id)?.aoClicar(),
});

export const CATALOGO: Definicao[] = [
  DO_PASSO('pronto'),
  DO_PASSO('arquitetura'),
  DO_PASSO('handoff'),
  DO_PASSO('perguntas'),
  { id: 'parar', tipo: 'acao', disponivel: (c) => c.streaming, executar: (c) => void c.handleCancel() },
  { id: 'aprovar', tipo: 'acao', executar: (c) => c.aprovar() },
  { id: 'ajuda', tipo: 'acao', executar: (c) => c.mostrarAjuda() },
  { id: 'skills', tipo: 'acao', executar: (c) => c.listarSkills() },
  { id: 'buscar', tipo: 'acao', executar: (c) => c.buscar() },
  { id: 'resumo', tipo: 'prompt', executar: (c) => c.inserirTexto(c.t('composer.comandos.resumo.texto')) },
  { id: 'plano', tipo: 'prompt', executar: (c) => c.inserirTexto(c.t('composer.comandos.plano.texto')) },
];

export function comandosDoComposer(c: ContextoDeComandos): ItemDoMenu[] {
  return CATALOGO.filter((d) => d.disponivel?.(c) ?? true).map((d) => {
    const acao = d.acao ? c.acoes.find((a) => a.chave === d.acao) : undefined;
    return {
      id: d.id,
      tipo: d.tipo,
      rotulo: c.t(`composer.comandos.${d.id}.nome`),
      descricao: c.t(`composer.comandos.${d.id}.descricao`),
      inerte: acao?.desabilitada ? (acao.motivo ?? c.t('composer.comandos.indisponivel')) : undefined,
      executar: () => d.executar(c),
    };
  });
}

export function itensDeAgentes(agentes: string[], escolher: (agente: string) => void): ItemDoMenu[] {
  return agentes.map((a) => ({
    id: a,
    tipo: 'agente' as const,
    rotulo: nomeDoAgente(a),
    executar: () => escolher(a),
  }));
}

const semAcento = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** O que se digita casa o nome localizado E o id interno (`/resumo` e `/summary`). */
export function filtrar(itens: ItemDoMenu[], consulta: string): ItemDoMenu[] {
  const q = semAcento(consulta);
  if (!q) return itens;
  return itens.filter((i) => semAcento(i.rotulo).includes(q) || semAcento(i.id).includes(q));
}

export interface Gatilho {
  tipo: '@' | '/';
  /** Posição do `@`/`/` no texto. */
  inicio: number;
  consulta: string;
}

/** `@`/`/` no início de uma palavra, com o cursor logo depois do que foi digitado. */
export function gatilhoNoCursor(texto: string, cursor: number): Gatilho | null {
  const m = /(?:^|\s)([@/])([^\s@/]*)$/.exec(texto.slice(0, cursor));
  if (!m) return null;
  return { tipo: m[1] as '@' | '/', inicio: cursor - m[2].length - 1, consulta: m[2] };
}

/** Os tetos absolutos (RN-154/418): nunca se aprovam por comando, só levam ao card. */
const TIPOS_DO_TETO = new Set(['git_merge', 'instruction_patch', 'parallelize', 'raise_max_parallel']);
const COMANDO_DO_TETO = /(^|[\s;&|])(sudo|doas|deploy)\b/;

export function ehTeto(a: Pick<ProposedAction, 'actionType' | 'payload'>): boolean {
  if (TIPOS_DO_TETO.has(a.actionType)) return true;
  const cmd = a.payload?.command;
  return a.actionType === 'terminal' && typeof cmd === 'string' && COMANDO_DO_TETO.test(cmd);
}

/** `confirmar`: exatamente UMA pendência e não é teto. O resto leva ao card. */
export function destinoDoAprovar(pendentes: ProposedAction[]): 'confirmar' | 'card' {
  return pendentes.length === 1 && !ehTeto(pendentes[0]) ? 'confirmar' : 'card';
}
