import { useId, useState, type Dispatch, type KeyboardEvent, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { approveAction, getAgentCatalog, getProjectPendingActions, mensagemDaApi, searchRag, sendMessageToMany } from './api-client';
import { FRESCOR_DA_CONFIGURACAO_MS } from './query-policy';
import { subirAnexosPendentes } from './anexos';
import type { ProposedAction } from './api-types';
import {
  comandosDoComposer,
  destinoDoAprovar,
  filtrar,
  gatilhoNoCursor,
  itensDeAgentes,
  type AcaoDeUi,
  type Gatilho,
  type ItemDoMenu,
} from './comandos-do-composer';

/**
 * AT-717: o estado dos menus `@` e `/` do composer. O campo segue NÃO
 * controlado (RN-882): o gatilho é lido do DOM nos eventos do campo, e escolher
 * um item escreve no nó (`setRangeText` + evento `input`, para o `aoMudar`
 * emitir) — nunca por `value`.
 */
export function useMenuDoComposer(p: {
  projectId: string | undefined;
  sessionId: string | undefined;
  agentesDaSessao: string[];
  /** O agente a quem a mensagem vai: `/skills` lista o catálogo dele. */
  destinatario?: string | null;
  acoes: AcaoDeUi[];
  streaming: boolean;
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
  escolherDestinatario: (agente: string, manual?: boolean) => void;
  handleCancel: () => void | Promise<void>;
  handleSend: () => Promise<void>;
  /** O handler de teclado de hoje (Enter envia). */
  teclado: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  const { t } = useTranslation('sessionPage');
  const queryClient = useQueryClient();
  const idDaLista = useId();
  const [campo, setCampo] = useState<HTMLTextAreaElement | null>(null);
  const [gatilho, setGatilho] = useState<Gatilho | null>(null);
  const [ativo, setAtivo] = useState(0);
  const [destinatarios, setDestinatarios] = useState<string[]>([]);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ajuda, setAjuda] = useState(false);
  const [resultado, setResultado] = useState<{ titulo: string; linhas: { rotulo: string; texto: string }[] } | null>(null);
  const [aprovando, setAprovando] = useState<ProposedAction | null>(null);

  function substituir(texto: string) {
    const el = campo;
    if (!el || !gatilho) return;
    el.setRangeText(texto, gatilho.inicio, el.selectionStart, 'end');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.focus();
  }

  function inserirTexto(texto: string) {
    substituir(texto);
    setGatilho(null);
  }

  async function aprovar() {
    if (!p.projectId) return;
    setAviso(null);
    try {
      const pendentes = await getProjectPendingActions(p.projectId);
      if (pendentes.length === 0) return setAviso(t('composer.comandos.aprovar.nenhuma'));
      if (destinoDoAprovar(pendentes) === 'confirmar') return setAprovando(pendentes[0]);
      const card = document.getElementById(`acao-${pendentes[0].id}`);
      card?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      card?.focus();
      setAviso(t('composer.comandos.aprovar.soNoCard'));
    } catch {
      setAviso(t('composer.comandos.aprovar.erro'));
    }
  }

  async function confirmarAprovacao() {
    const acao = aprovando;
    setAprovando(null);
    if (!acao || !p.projectId) return;
    try {
      await approveAction(p.projectId, acao.sessionId, acao.id);
    } catch {
      setAviso(t('composer.comandos.aprovar.erro'));
    } finally {
      void queryClient.invalidateQueries({ queryKey: ['project-pending-actions', p.projectId] });
      void queryClient.invalidateQueries({ queryKey: ['session-actions', p.projectId, acao.sessionId] });
    }
  }

  // AT-724: a MESMA queryKey da aba de agentes (RN-645); engine fora = "não sei" (RN-995).
  async function listarSkills() {
    if (!p.projectId) return;
    setAviso(null);
    try {
      const cat = await queryClient.fetchQuery({
        queryKey: ['agent-catalog', p.projectId],
        queryFn: () => getAgentCatalog(p.projectId as string),
        staleTime: FRESCOR_DA_CONFIGURACAO_MS,
      });
      const alvo = p.destinatario ?? '';
      const ag = cat.agentes.find((a) => a.agente === alvo || (alvo.startsWith('dev-') && a.agente === 'dev-*'));
      if (!ag) return setAviso(t('composer.comandos.skills.semAgente', { agente: alvo }));
      const linhas = (ag.ferramentas ?? []).map((f) => ({ rotulo: f.nome, texto: f.descricao }));
      if (ag.instrucoesDoProjeto) {
        linhas.unshift({ rotulo: t('composer.comandos.skills.instrucao', { versao: ag.instrucoesDoProjeto.versao }), texto: ag.instrucoesDoProjeto.conteudo });
      }
      setResultado({
        titulo:
          ag.ferramentas === null
            ? t('composer.comandos.skills.naoSei', { agente: alvo })
            : t('composer.comandos.skills.titulo', { agente: alvo, count: ag.ferramentas.length }),
        linhas,
      });
    } catch (e) {
      setAviso(t('composer.comandos.skills.erro', { motivo: mensagemDaApi(e) }));
    }
  }

  async function buscar() {
    const el = campo;
    const consulta = el?.value.trim() ?? '';
    if (!el || !p.projectId) return;
    setAviso(null);
    if (!consulta) return setAviso(t('composer.comandos.buscar.semConsulta'));
    el.setRangeText('', 0, el.value.length, 'end');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    try {
      const r = await searchRag(p.projectId, { query: consulta, limit: 5 });
      setResultado({
        titulo: t('composer.comandos.buscar.titulo', { consulta, count: r.hits.length }),
        linhas: r.hits.map((h) => ({ rotulo: h.scope, texto: h.content })),
      });
    } catch (e) {
      setAviso(t('composer.comandos.buscar.erro', { motivo: mensagemDaApi(e) }));
    }
  }

  const comandos = comandosDoComposer({
    t,
    acoes: p.acoes,
    streaming: p.streaming,
    handleCancel: p.handleCancel,
    inserirTexto,
    aprovar: () => void aprovar(),
    mostrarAjuda: () => setAjuda(true),
    listarSkills: () => void listarSkills(),
    buscar: () => void buscar(),
  });

  function escolherAgente(agente: string) {
    const novos = [...destinatarios, agente];
    setDestinatarios(novos);
    if (novos.length === 1) p.escolherDestinatario(agente, true);
  }

  const itens = !gatilho
    ? []
    : filtrar(
        gatilho.tipo === '@'
          ? itensDeAgentes(
              p.agentesDaSessao.filter((a) => !destinatarios.includes(a)),
              escolherAgente,
            )
          : comandos,
        gatilho.consulta,
      );
  const aberto = gatilho !== null;
  const indice = Math.min(ativo, Math.max(itens.length - 1, 0));

  function ler(el: HTMLTextAreaElement) {
    setCampo(el);
    setGatilho(gatilhoNoCursor(el.value, el.selectionStart));
    setAviso(null);
  }

  function escolher(item: ItemDoMenu) {
    if (item.inerte) return;
    substituir('');
    setGatilho(null);
    item.executar();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing) return; // RN-830
    if (aberto) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = itens.length || 1;
        setAtivo((indice + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault(); // com o menu aberto, Enter NUNCA envia
        if (itens[indice]) escolher(itens[indice]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setGatilho(null);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && destinatarios.length > 1) {
      e.preventDefault();
      void enviar();
      return;
    }
    p.teclado(e);
  }

  async function enviar() {
    if (destinatarios.length < 2) return p.handleSend();
    const text = p.draft.trim();
    if (!text || p.streaming || !p.projectId || !p.sessionId) return;
    p.setDraft('');
    try {
      const anexos = await subirAnexosPendentes(p.projectId, p.sessionId);
      await sendMessageToMany(p.projectId, p.sessionId, text, destinatarios, anexos);
      setDestinatarios([]);
    } catch {
      p.setDraft((atual) => atual || text);
      setAviso(t('composer.menu.erroEnviarVarios'));
    } finally {
      void queryClient.invalidateQueries({ queryKey: ['session-events', p.projectId, p.sessionId] });
    }
  }

  function removerChip(agente: string) {
    const restantes = destinatarios.filter((a) => a !== agente);
    setDestinatarios(restantes);
    if (restantes.length === 1) p.escolherDestinatario(restantes[0], true);
  }

  return {
    idDaLista,
    aberto,
    itens,
    ativo: indice,
    titulo: gatilho?.tipo === '@' ? t('composer.menu.agentes') : t('composer.menu.comandos'),
    destinatarios,
    limparChips: () => setDestinatarios([]),
    removerChip,
    aviso,
    ajuda: ajuda ? comandos : null,
    fecharAjuda: () => setAjuda(false),
    resultado,
    fecharResultado: () => setResultado(null),
    aprovando,
    cancelarAprovacao: () => setAprovando(null),
    confirmarAprovacao,
    ler,
    escolher,
    onKeyDown,
    enviar,
  };
}
