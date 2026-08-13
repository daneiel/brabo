import type { BadgeTone } from '../components/ui/Badge';
import type { SessionKind } from './api-types';

/**
 * Como o tipo da sessão se apresenta (FASE 20, RN-097).
 *
 * O pedido que originou a fase foi de CLAREZA: "o processo de ter que
 * selecionar o botão acima para iniciar o criativo não ficou claro o
 * suficiente". Clareza é texto, e texto duplicado diverge — a lista de sessões
 * e a barra da sessão dizem a MESMA coisa sobre um tipo porque leem daqui.
 *
 * Uma entrada por tipo, sem `default`: tipo novo passa a exigir uma decisão de
 * copy aqui em vez de aparecer na tela como o slug cru do banco.
 */
export const TIPOS_DE_SESSAO: Record<
  SessionKind,
  {
    /** Como o tipo se chama na tela. */
    rotulo: string;
    /** Uma linha dizendo o que a escolha implica. Aparece na criação. */
    explicacao: string;
    tom: BadgeTone;
  }
> = {
  consultiva: {
    rotulo: 'Consultiva',
    explicacao:
      'Só conversa: perguntas, contexto, tirar dúvidas. Nenhum agente é ' +
      'ativado sozinho e ela não entra em execução.',
    tom: 'muted',
  },
  criativa: {
    rotulo: 'Criativa',
    explicacao:
      'Para produzir: abre a ideação com o Criativo, que registra as regras ' +
      'de negócio e passa a bola ao PO. É a única que entra em execução.',
    tom: 'accent',
  },
};

export const KINDS_DE_SESSAO = Object.keys(TIPOS_DE_SESSAO) as SessionKind[];

/**
 * O tipo pré-selecionado no formulário de criação.
 *
 * `criativa` — e a diferença entre isto e o DEFAULT DA COLUNA na api
 * (`consultiva`) é deliberada, não um descuido. Aqui há uma pessoa olhando a
 * escolha, com as duas explicações à vista, e o caminho que ela quase sempre
 * quer é produzir; lá não há ninguém, e o que chega sem tipo declarado não
 * pode ganhar o direito de executar de graça.
 */
export const KIND_PRE_SELECIONADO: SessionKind = 'criativa';
