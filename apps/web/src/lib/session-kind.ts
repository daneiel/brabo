import type { BadgeTone } from '../components/ui/Badge';
import type { SessionKind } from './api-types';
import i18n from './i18n';

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
 *
 * `rotulo`/`explicacao` são GETTERS, não valores fixados na criação do
 * objeto: módulo não-React só é reavaliado uma vez, no import — um valor
 * fixo congelaria a tradução no idioma vigente no boot. O getter resolve via
 * `i18n.t()` a cada ACESSO, então componentes que leem `tipo.explicacao` a
 * cada render (inclusive fora do escopo desta extração, como
 * `SessionPage.tsx`) acompanham a troca de idioma sem precisar de `useTranslation`.
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
    get rotulo() {
      return i18n.t('sessionKind.consultiva.label', { ns: 'sessions' });
    },
    get explicacao() {
      return i18n.t('sessionKind.consultiva.description', { ns: 'sessions' });
    },
    tom: 'muted',
  },
  criativa: {
    get rotulo() {
      return i18n.t('sessionKind.criativa.label', { ns: 'sessions' });
    },
    get explicacao() {
      return i18n.t('sessionKind.criativa.description', { ns: 'sessions' });
    },
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
