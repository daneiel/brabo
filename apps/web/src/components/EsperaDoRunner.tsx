import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getProject } from '../lib/api-client';
import { Alert } from './ui/Alert';
import { Button } from './ui/Button';
import styles from './EsperaDoRunner.module.css';

/**
 * O QUARTO passo do fluxo da RN-473: depois de a pasta estar configurada e a
 * pessoa ter o comando na mão, esperar o runner APARECER — sem obrigá-la a
 * clicar em nada para descobrir se deu certo.
 *
 * ## O mecanismo é o que já existia, não um novo (RN-474)
 *
 * O sinal é `project.workspaceVerifiedAt`, o mesmo carimbo que
 * `AmbienteDoProjeto` já usa e que o engine usa como PORTÃO
 * (`terminal_executor.ex` recusa executar em projeto `runner` com
 * `workspace_verified_at` nulo): é a definição do próprio produto de "este
 * projeto tem runner configurado". Quem o grava é
 * `ConfirmProjectWorkspaceUseCase`, quando o runner conecta e reporta o
 * caminho real.
 *
 * A alternativa considerada era sondar o canal de navegação de pasta
 * (`connectFsBrowserChannel`, cujo erro `'Nenhum runner conectado'` o
 * `FolderBrowserModal` já detecta). Ela sabe do AGORA, que é mais forte —
 * mas o canal grava `erroDeConexao` de forma permanente por instância, então
 * cada sondagem exigiria ticket + socket NOVOS: dezenas deles ao longo da
 * espera, contra um `GET` que ainda por cima cai na chave de cache
 * `['project', id]` que a página inteira já mantém. E ela não responderia a
 * segunda metade do que esta tela deve: QUAL caminho o runner reportou.
 *
 * ## O que este sinal SABE, e o que ele não sabe (RN-468)
 *
 * `workspaceVerifiedAt` não é batimento. Reconectar reportando o MESMO
 * caminho já gravado não o regrava (é decisão explícita do caso de uso), e
 * por isso a espera compara contra uma LINHA DE BASE tirada no instante em
 * que começou: confirmado é o carimbo MUDAR, nunca "existir". Num projeto que
 * já tinha sido confirmado antes com a mesma pasta, o carimbo não muda e esta
 * tela estoura o teto — o texto de "sem resposta" diz isso com todas as
 * letras em vez de afirmar que não há runner.
 *
 * ## Três estados, e teto (RN-088 / RN-468)
 *
 * `esperando` (a sonda está rodando), `confirmado` (o carimbo mudou) e
 * `semResposta` (o teto estourou) nunca colapsam, e nenhum deles é eterno: a
 * sonda para em {@link TETO_MS} e diz o que fazer, com um botão que recomeça
 * a espera sem refazer a configuração.
 */

/** Frequência da sonda. Um `GET` leve, na chave de cache que a página já tem. */
const INTERVALO_MS = 3_000;
/** Teto da espera — 3 minutos cobrem `chmod`, primeira execução e o join do canal. */
export const TETO_MS = 180_000;

type Fase = 'esperando' | 'confirmado' | 'semResposta';

export function EsperaDoRunner({ projectId }: { projectId: string }) {
  const { t, i18n } = useTranslation('terminal');
  /** Muda a cada reinício manual — reinicia o temporizador do teto. */
  const [rodada, setRodada] = useState(0);
  const [expirou, setExpirou] = useState(false);
  /**
   * `undefined` = ainda não lemos o projeto uma vez. Depois disso guarda o
   * valor de `workspaceVerifiedAt` de ANTES da espera, e nunca mais muda:
   * reiniciar a espera não pode adotar como base um carimbo que já é a
   * resposta que estamos procurando.
   */
  const base = useRef<string | null | undefined>(undefined);

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId),
    refetchInterval: () => (expirou ? false : INTERVALO_MS),
  });

  if (project && base.current === undefined) {
    base.current = project.workspaceVerifiedAt;
  }

  const confirmado =
    !!project &&
    base.current !== undefined &&
    project.workspaceVerifiedAt !== null &&
    project.workspaceVerifiedAt !== base.current;

  useEffect(() => {
    if (confirmado || expirou) return;
    const id = setTimeout(() => setExpirou(true), TETO_MS);
    return () => clearTimeout(id);
  }, [confirmado, expirou, rodada]);

  const fase: Fase = confirmado ? 'confirmado' : expirou ? 'semResposta' : 'esperando';

  if (fase === 'confirmado') {
    return (
      <div className={styles.bloco} role="status">
        <Alert tone="success">
          {t('esperaDoRunner.confirmado', {
            data: new Date(project!.workspaceVerifiedAt!).toLocaleString(i18n.language),
          })}
        </Alert>
        {project?.workspacePath && (
          <>
            <code className={styles.caminho}>{project.workspacePath}</code>
            <p className={styles.detalhe}>{t('esperaDoRunner.caminhoDoRunner')}</p>
          </>
        )}
      </div>
    );
  }

  if (fase === 'semResposta') {
    return (
      <div className={styles.bloco} role="status">
        <Alert tone="warning">
          {t('esperaDoRunner.semResposta', { minutos: Math.round(TETO_MS / 60_000) })}
        </Alert>
        <p className={styles.detalhe}>{t('esperaDoRunner.semRespostaRessalva')}</p>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setExpirou(false);
            setRodada((n) => n + 1);
          }}
        >
          {t('esperaDoRunner.procurarDeNovo')}
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.bloco} role="status">
      <p className={styles.esperando}>
        <span className={styles.pulso} aria-hidden="true" />
        {t('esperaDoRunner.esperando')}
      </p>
      <p className={styles.detalhe}>
        {t('esperaDoRunner.esperandoDetalhe', { minutos: Math.round(TETO_MS / 60_000) })}
      </p>
    </div>
  );
}
