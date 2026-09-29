import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  getSessionResponseLanguage,
  mensagemDaApi,
  setSessionResponseLanguage,
} from '../lib/api-client';
import type { SessionResponseLanguage } from '../lib/api-types';
import { useCurrentWorkspaceWithRole } from '../lib/hooks';
import { roleAtLeast } from '../lib/roles';
import {
  IDIOMA_AUTOMATICO,
  OPCAO_OUTRO_CODIGO,
  nomeDoIdioma,
  opcoesDeIdioma,
} from '../lib/idioma-da-resposta';
import { useToast } from '../components/ui/ToastProvider';
import styles from './SessionLanguageIndicator.module.css';

/** Valor do `<option>` de "seguir a Conta" — soltar o override. */
const SEGUIR_A_CONTA = '';

/**
 * O que a pessoa receberia SEM o override desta sessão: a mesma cadeia da
 * api (RN-618) sem o primeiro degrau — conta > detectado confirmado >
 * interface. Derivada no cliente a partir da cadeia que a rota já devolve,
 * sem endpoint novo, para o rótulo "Seguir a Conta" dizer em QUE idioma isso
 * dá; a api continua sendo a fonte do efetivo.
 */
export function idiomaSemOverride(r: SessionResponseLanguage): string {
  if (r.account !== IDIOMA_AUTOMATICO) return r.account;
  return r.detected ?? r.interfaceLocale;
}

/**
 * O idioma das respostas na barra da sessão
 * ([RN-620](../../../../docs/business-rules.md#rn-620)), ao lado do seletor
 * de modelo.
 *
 * ## É de QUEM VÊ, não da sessão
 *
 * O seletor de modelo ao lado grava no escopo `session` e vale para todos. O
 * idioma não: a rota resolve para quem chama, e trocar aqui é o override POR
 * SESSÃO da RN-618 — só desta pessoa, só nesta sessão (decisão do
 * mantenedor, AT-169 resposta 2). Por isso o controle SEMPRE diz a origem e
 * tem um "Seguir a Conta" que solta o override, e o link leva à Conta, onde
 * mora a escolha que vale em todas as sessões.
 *
 * ## O que ele NÃO afirma
 *
 * Desde a RN-622 o efetivo chega ao modelo nas mensagens de QUEM VÊ, e o
 * aviso de "ainda não chega" saiu. Carregando, falhou e cada origem têm
 * textos próprios (RN-470): "interface" e "detectado" não viram "escolhido".
 * E nunca "você é brasileiro": o detectado se diz "detectado pelas suas
 * mensagens" (AT-080).
 *
 * ## Quem pode trocar
 *
 * O mínimo é o do ENDPOINT (`developer` no `PUT`), por `roleAtLeast` sobre o
 * papel de WORKSPACE — a lacuna declarada das telas que não buscam
 * `project_members`. Abaixo dele o valor e a origem continuam na barra, o
 * seletor fica inerte e o motivo vem em texto.
 */
export function SessionLanguageIndicator({
  projectId,
  sessionId,
}: {
  projectId: string;
  sessionId: string;
}) {
  const { t, i18n } = useTranslation('responseLanguage');
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { data: comPapel } = useCurrentWorkspaceWithRole();
  const podeTrocar = roleAtLeast(comPapel?.role, 'developer');
  const [digitando, setDigitando] = useState(false);
  const [codigo, setCodigo] = useState('');
  const chave = ['session-response-language', projectId, sessionId];

  const { data, isPending, isError } = useQuery({
    queryKey: chave,
    queryFn: () => getSessionResponseLanguage(projectId, sessionId),
  });

  const fixar = useMutation({
    mutationFn: (language: string | null) =>
      setSessionResponseLanguage(projectId, sessionId, language),
    onSuccess: (r) => {
      queryClient.setQueryData(chave, r);
      setDigitando(false);
      setCodigo('');
    },
    onError: (erro) => {
      showToast({
        title: t('session.error'),
        message: mensagemDaApi(erro),
        tone: 'danger',
      });
    },
  });

  const idiomaDaInterface = i18n.language || 'en';

  if (isPending) {
    return <div className={styles.indicador}>{t('session.loading')}</div>;
  }
  if (isError || !data) {
    return <div className={styles.indicador}>{t('session.loadError')}</div>;
  }

  function escolher(valor: string) {
    if (valor === OPCAO_OUTRO_CODIGO) {
      setDigitando(true);
      return;
    }
    setDigitando(false);
    const novo = valor === SEGUIR_A_CONTA ? null : valor;
    if (novo === data?.sessionOverride) return;
    fixar.mutate(novo);
  }

  const nome = (c: string) => nomeDoIdioma(c, idiomaDaInterface);
  // A linha de origem trunca com reticências nos 60px da barra; o `title`
  // carrega o texto inteiro, porque texto cortado sem forma de ler o resto é
  // informação perdida (a mesma régua do título da sessão, ao lado).
  const origemPorExtenso = [
    t('session.effective', {
      idioma: nome(data.language),
      origem: t(`origin.${data.origin}`),
    }),
    ...(podeTrocar ? [] : [t('session.readOnly')]),
  ].join(' · ');

  return (
    <div className={styles.indicador} data-testid="idioma-da-sessao">
      <div className={styles.linha}>
        <span className={styles.rotulo}>{t('session.label')}</span>
        {digitando ? (
          <form
            className={styles.linha}
            onSubmit={(e) => {
              e.preventDefault();
              if (codigo.trim()) fixar.mutate(codigo.trim());
            }}
          >
            <input
              className={styles.campo}
              value={codigo}
              autoFocus
              aria-label={t('session.otherLabel')}
              placeholder="es-MX"
              onChange={(e) => setCodigo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setDigitando(false);
              }}
            />
            <button
              type="submit"
              className={styles.botao}
              disabled={!codigo.trim() || fixar.isPending}
            >
              {t('session.pin')}
            </button>
          </form>
        ) : (
          <select
            className={styles.seletor}
            value={data.sessionOverride ?? SEGUIR_A_CONTA}
            disabled={!podeTrocar || fixar.isPending}
            aria-label={t('session.selectAria')}
            onChange={(e) => escolher(e.target.value)}
          >
            <option value={SEGUIR_A_CONTA}>
              {t('session.followAccount', { idioma: nome(idiomaSemOverride(data)) })}
            </option>
            {opcoesDeIdioma(data.sessionOverride).map((c) => (
              <option key={c} value={c}>
                {nome(c)}
              </option>
            ))}
            <option value={OPCAO_OUTRO_CODIGO}>{t('account.otherCode')}</option>
          </select>
        )}
      </div>
      <div
        className={styles.origem}
        data-testid="origem-do-idioma"
        title={origemPorExtenso}
      >
        {origemPorExtenso} ·{' '}
        <Link to="/account" className={styles.link}>
          {t('session.accountLink')}
        </Link>
      </div>
    </div>
  );
}
