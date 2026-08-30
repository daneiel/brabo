import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { API_URL, ENGINE_URL, fetchHealth } from '../lib/health';
import styles from './SinaisDoAmbiente.module.css';

/**
 * O que a bolinha da linha diz. `aguardando` é um estado de verdade, não um
 * "vazio bonito": enquanto a sonda não voltou, a tela não sabe — e dizer isso
 * é diferente de dizer que está no ar ou que caiu (a régua de três estados da
 * RN-088, aplicada a um sinal de ambiente).
 */
export type TomDeSinal = 'ok' | 'erro' | 'neutro' | 'aguardando';

interface LinhaDeSinalProps {
  /** O que está sendo medido ("api", "engine", "modelos locais"). */
  rotulo: string;
  /** O estado, já em prosa e já traduzido. */
  valor: string;
  tom: TomDeSinal;
  /**
   * Uma linha menor abaixo do valor, para o que o valor NÃO afirma. Existe
   * porque os sinais desta família são quase todos PROXY de alguma outra
   * coisa, e um proxy sem ressalva vira promessa.
   */
  ressalva?: string;
}

/**
 * Uma linha de estado de ambiente: bolinha, rótulo e valor.
 *
 * Compartilhada entre o bloco pré-login (`SinaisDoAmbiente`, aqui embaixo) e o
 * do projeto (`AmbienteDoProjeto`) porque as duas telas respondem à MESMA
 * pergunta em escopos diferentes — "o que está de pé em volta de mim?" — e
 * duas gramáticas visuais para a mesma pergunta é como elas divergem.
 *
 * Nada aqui é focável, de propósito: no login este bloco vem ANTES do
 * formulário no DOM, e qualquer botão aqui roubaria a primeira parada de `Tab`
 * do campo de e-mail (`auth-teclado.test.tsx` fixa essa ordem).
 */
export function LinhaDeSinal({ rotulo, valor, tom, ressalva }: LinhaDeSinalProps) {
  return (
    <li className={styles.linha}>
      <span className={`${styles.ponto} ${styles[tom]}`} aria-hidden="true" />
      <span className={styles.rotulo}>{rotulo}</span>
      <span className={styles.valorEnvolto}>
        <span className={styles.valor}>{valor}</span>
        {ressalva && <span className={styles.ressalva}>{ressalva}</span>}
      </span>
    </li>
  );
}

/** Quanto a tela espera por um `/health` antes de chamar de "sem resposta". */
const TETO_DA_SONDA_MS = 6000;

type EstadoDeSaude = 'aguardando' | 'ok' | 'erro';

/**
 * Sonda um `/health` UMA vez, com teto de tempo.
 *
 * `fetch` cru e não `useQuery`: este hook roda na tela de login, que é montada
 * fora de qualquer `QueryClientProvider` nos testes das quatro telas de auth —
 * e, mais importante, o formulário não pode depender de nenhuma infraestrutura
 * de dados para aparecer. O estado é local, a falha é um valor, e nada aqui
 * lança para o render.
 *
 * O teto existe porque uma api que aceita a conexão e nunca responde deixaria
 * a linha em "verificando…" para sempre — o que é um estado honesto por meio
 * segundo e uma mentira por omissão depois de dez. Passado o teto, a resposta
 * é "sem resposta", que é exatamente o que se sabe.
 */
function useSaude(baseUrl: string): EstadoDeSaude {
  const [estado, setEstado] = useState<EstadoDeSaude>('aguardando');

  useEffect(() => {
    let vivo = true;
    const relogio = setTimeout(() => {
      if (vivo) setEstado('erro');
    }, TETO_DA_SONDA_MS);

    fetchHealth(baseUrl)
      .then((saude) => {
        if (!vivo) return;
        // `fetchHealth` já sintetiza `status: 'error'` para resposta não-OK;
        // o `.catch` abaixo cobre o que ele não cobre, que é a rejeição da
        // própria conexão (api fora do ar, DNS, CORS).
        setEstado(saude.status === 'ok' ? 'ok' : 'erro');
      })
      .catch(() => {
        if (vivo) setEstado('erro');
      })
      .finally(() => clearTimeout(relogio));

    return () => {
      vivo = false;
      clearTimeout(relogio);
    };
  }, [baseUrl]);

  return estado;
}

/**
 * Os sinais de ambiente da tela de login.
 *
 * ## Só o que é verdade sem identidade
 *
 * A tela de login é PRÉ-identidade: não há usuário, não há workspace e não há
 * projeto. Os dois sinais que sobrevivem a isso são os `/health` da api e do
 * engine, públicos nos dois serviços de propósito
 * (`health.controller.ts` com `@Public()`; `router.ex`, "Sem auth de
 * propósito") — e é por isso que `StatusPage` já os consome sem sessão.
 *
 * Presença de runner e contagem de modelos locais NÃO entram aqui, e não é
 * economia: `runner_device_keys` é chaveada por `user_id` + `project_id`, e a
 * lista de modelos é `projects/:projectId/models` com papel `viewer`. Antes do
 * login não existe nenhum dos dois escopos, então a tela não teria como dizer
 * "o SEU runner está de pé" sem inventar. Esses dois moram onde a identidade
 * existe (`AmbienteDoProjeto`, na Visão geral do projeto).
 *
 * A versão também não se repete aqui: ela já é renderizada uma vez pelo rodapé
 * de `AuthLayout`, a partir de `runtimeConfig.version`. Duas cópias da mesma
 * fonte na mesma tela é como uma delas envelhece.
 *
 * ## O formulário nunca espera por isto
 *
 * O estado das sondas é local a este componente, que é IRMÃO do card no
 * layout. Uma api fora do ar, ou lenta a ponto de não responder nunca, muda o
 * texto de uma linha aqui e não atrasa nem esconde um pixel do formulário —
 * que continua submetível, porque quem sabe se o login funcionou é o próprio
 * `POST /auth/login`, não esta sonda.
 */
export function SinaisDoAmbiente() {
  const { t } = useTranslation('auth');
  const api = useSaude(API_URL);
  const engine = useSaude(ENGINE_URL);

  const tom: Record<EstadoDeSaude, TomDeSinal> = {
    ok: 'ok',
    erro: 'erro',
    aguardando: 'aguardando',
  };

  return (
    <div className={styles.bloco}>
      {/*
        `<p>` e não `<h2>`: "Brabo" e o título do card já ocupam a hierarquia
        de cabeçalhos desta tela, e o card tem de continuar sendo o ÚNICO
        `<h1>` (ver `AuthLayout.test.tsx`). Um cabeçalho a mais aqui faria a
        lista do leitor de tela começar por "Ambiente" em vez de "Entrar".
      */}
      <p className={styles.titulo}>{t('ambiente.title')}</p>
      <ul className={styles.lista} aria-live="polite">
        <LinhaDeSinal
          rotulo={t('ambiente.api')}
          valor={t(`ambiente.estados.${api}`)}
          tom={tom[api]}
        />
        <LinhaDeSinal
          rotulo={t('ambiente.engine')}
          valor={t(`ambiente.estados.${engine}`)}
          tom={tom[engine]}
        />
      </ul>
      <p className={styles.nota}>{t('ambiente.nota')}</p>
    </div>
  );
}
