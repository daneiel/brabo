import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { listProviderCapabilities } from '../../lib/api-client';
import type {
  Model,
  ModelBindingScope,
  ResolvedBinding,
  RoutingPreference,
} from '../../lib/api-types';
import { Select } from '../../components/ui/Select';
import styles from '../ProjectSettingsTab.module.css';

/** A ordem de oferta — a mesma de `PREFERENCIAS_DE_ROTEAMENTO` na api. */
const OPCOES: readonly RoutingPreference[] = ['price', 'throughput', 'latency'];

/** Valor do `<option>` que representa "sem critério" — nunca vai ao fio. */
const HUB_DECIDE = '';

/**
 * As capabilities de PROVIDER (ADR 0166). Chave global: é fato do código da
 * instalação, igual para todo projeto, e as duas seções de modelo a dividem.
 */
export function useCapacidadesDosProviders() {
  return useQuery({
    queryKey: ['provider-capabilities'],
    queryFn: listProviderCapabilities,
    staleTime: Infinity,
  });
}

/**
 * O critério de roteamento de UMA linha de binding (ADR 0166, RN-583).
 *
 * Quatro estados, e nenhum colapsa no outro:
 *
 * - **não sei** (capabilities carregando ou que falharam, ou linha sem
 *   modelo): nada — "não sei" não vira "não tem";
 * - **o provider não declara a capability**: sem controle, com a FRASE do
 *   porquê — tira-se o controle, nunca a informação (RN-102);
 * - **a linha HERDA o modelo** de outro nível: o critério vigente é dito em
 *   texto com o nível de onde veio, porque ele VIAJA COM O MODELO e não
 *   cascateia à parte — editar aqui seria gravar uma cópia do modelo alheio;
 * - **a linha tem binding PRÓPRIO**: o seletor, inerte sem o papel do
 *   endpoint (o motivo é dito uma vez na legenda da seção).
 */
export function PreferenciaDeRoteamento({
  resolvido,
  modelo,
  proprio,
  podeEditar,
  alvo,
  onChange,
}: {
  resolvido: ResolvedBinding | null | undefined;
  modelo: Model | undefined;
  /** A linha tem binding NESTE nível (não herdado, nem do Criativo). */
  proprio: boolean;
  podeEditar: boolean;
  /** Nome legível da linha, para o rótulo acessível. */
  alvo: string;
  onChange: (preferencia: RoutingPreference | null) => void;
}) {
  const { t } = useTranslation('settings');
  const { data: capacidades } = useCapacidadesDosProviders();

  if (!resolvido || !modelo || !capacidades) return null;

  const doProvider = capacidades.find((c) => c.provider === modelo.provider);
  if (!doProvider) return null;

  if (!doProvider.capabilities.routingPreference) {
    return (
      <span className={styles.vazioComTexto} data-roteamento="sem-capability">
        {t('roteamento.notSupported', { provider: modelo.provider })}
      </span>
    );
  }

  const valor = resolvido.routingPreference;
  const rotuloDoValor = valor
    ? t(`roteamento.options.${valor}`)
    : t('roteamento.options.hub');

  if (!proprio) {
    const nivel = t(`cascata.niveis.${resolvido.origin as ModelBindingScope}`);
    return (
      <span className={styles.vazioComTexto} data-roteamento="herdado">
        {t('roteamento.inherited', { valor: rotuloDoValor, nivel })}{' '}
        {t('roteamento.inheritedHint')}
      </span>
    );
  }

  return (
    <Select
      aria-label={t('roteamento.ariaLabel', { alvo })}
      value={valor ?? HUB_DECIDE}
      disabled={!podeEditar}
      onChange={(evento) => {
        const escolhido = evento.target.value;
        onChange(
          escolhido === HUB_DECIDE ? null : (escolhido as RoutingPreference),
        );
      }}
    >
      <option value={HUB_DECIDE}>{t('roteamento.options.hub')}</option>
      {OPCOES.map((opcao) => (
        <option key={opcao} value={opcao}>
          {t(`roteamento.options.${opcao}`)}
        </option>
      ))}
    </Select>
  );
}
