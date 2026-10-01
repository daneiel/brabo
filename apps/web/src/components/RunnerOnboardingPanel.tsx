import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { ApiError, getProject, listRunnerDeviceKeys } from '../lib/api-client';
import { useCurrentWorkspaceWithRole } from '../lib/hooks';
import { chavesDoProjetoQueryKey } from '../lib/chaves-de-dispositivo-queries';
import {
  maquinaJaPareada,
  podeLerChavesDeDispositivo,
  projetoJaPareado,
  reconhecerAgenteDeMaquina,
  reconhecerChaveDeProjeto,
  type ReconhecimentoDeChaveDeProjeto,
  type ReconhecimentoDeAgenteDeMaquina,
} from '../lib/agente-de-maquina';
import { Button } from './ui/Button';
import { Alert } from './ui/Alert';
import { TerminalIcon } from './ui/icons';
import { EsperaDoRunner } from './EsperaDoRunner';
import styles from './RunnerOnboardingPanel.module.css';

interface RunnerOnboardingPanelProps {
  /**
   * `null` quando o projeto ainda não existe (passo `workspace` do
   * `NewProjectWizard`, ANTES da criação antecipada — RN-437/ADR 0108): sem
   * id não há chave a reconhecer nem runner a esperar, então o painel mostra
   * o instalador e o comando manual (com placeholder), e nada mais.
   */
  projectId: string | null;
  /** Mensagem específica do que falhou (ex.: `pty_error`, erro de ticket) — cai no genérico quando ausente. */
  mensagem?: string;
  /** Reconsulta a conexão. Ausente = painel só informativo (sem botão). */
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
  /**
   * Caminho já digitado pelo usuário (só o `NewProjectWizard` passa isto,
   * antes de o projeto existir) — deixa o comando manual mais fiel ao que a
   * pessoa escreveu, e o comando final capaz de dizer em que pasta rodar.
   *
   * Quando NÃO vem e há `projectId`, o painel busca o caminho do próprio
   * projeto (abaixo). É por isso que `TerminalPanel` e `FolderBrowserModal`
   * não precisam passá-lo: a busca mora num lugar só, e não em cada um dos
   * três pontos de montagem.
   */
  caminhoSugerido?: string;
  /**
   * `false` quando quem MONTOU este painel já mostra a `EsperaDoRunner`
   * (RN-533: o `FolderBrowserModal`, que a mantém no topo enquanto o agente
   * local não responde). Duas esperas na mesma tela seriam duas sondas, dois
   * tetos e — no pior caso — duas frases discordando sobre o mesmo carimbo.
   *
   * Default `true`: os outros dois pontos de montagem (`TerminalPanel` e o
   * passo `workspace` do `NewProjectWizard`) não montam espera nenhuma, e um
   * default que exigisse cada um se declarar faria a espera sumir de quem
   * esquecesse a prop.
   */
  mostrarEspera?: boolean;
}

/**
 * O comando que instala o Brabo E o agente local nesta máquina (RN-526): baixar
 * um ARQUIVO e rodá-lo com `bash` — nunca `curl … | sh`, nunca `sh -c
 * "$(curl …)"`. É a MESMA frase do cabeçalho do `install.sh`, do runbook e do
 * `bootstrap.sh`, e `scripts/dev/install-invocacao.spec.ts` reprova esta cópia
 * se ela divergir das outras.
 */
export const COMANDO_DO_INSTALADOR =
  'curl -fsSLO https://github.com/daneiel/brabo/releases/latest/download/install.sh && bash install.sh';

/**
 * Onboarding de instalação do Runner — painel compartilhado por TRÊS lugares:
 * `TerminalPanel` (estado "sem runner" da aba Terminal, RN-088),
 * `FolderBrowserModal` (sem como navegar sem runner) e `NewProjectWizard`
 * (passo `workspace`, modo `runner`). Um só texto de instalação, uma só régua
 * de "está conectado?".
 *
 * ## O caminho é o instalador (ADR 0203, RN-687)
 *
 * Até o ADR 0203 o primeiro plano deste painel era o fluxo do ADR 0118: o
 * NAVEGADOR gerava o par Ed25519, registrava a pública, baixava o binário e
 * gravava os arquivos numa pasta pela File System Access API. Aquele fluxo foi
 * APOSENTADO por decisão do mantenedor (BRB-031): era o único caminho que
 * terminava em `chmod +x` manual, e o `install.sh` já faz as três coisas do
 * lado certo — baixa o binário conferido contra o `checksums.txt` ASSINADO,
 * instala com `install -m 0755` (RN-531) e cria a chave NA MÁQUINA
 * (`brabo-runner device-key create`, RN-551/552/547). Então o painel manda
 * para ele, com o comando copiável, e o comando manual de sempre (`--token`,
 * PAT) segue no `<details>` — é o caminho de quem está numa máquina que não é
 * a da instalação, onde o `install.sh` não cabe.
 *
 * O passo continua humano, e o painel não finge o contrário: uma página web
 * não executa programa na máquina de ninguém. O que mudou é que o passo é UM
 * comando, que já termina com o runner executável e pareado.
 *
 * ## O reconhecimento de máquina já pareada (RN-548, ADR 0154)
 *
 * Desde a RN-543 a listagem de chaves marca a ESPÉCIE, e é daqui que essa
 * marca é consumida: quando a conta já tem chave ativa que serve este projeto,
 * mandar a pessoa instalar de novo é o painel respondendo à pergunta errada. A
 * derivação inteira — sete estados, nenhum virando o outro — mora em
 * `lib/agente-de-maquina.ts`, fora do componente, porque a regra é sobre o
 * DADO e o componente é sobre o desenho. Reconhecida a chave, o bloco do
 * instalador SAI (o gesto é conferir o serviço), e o `<details>` do comando
 * manual fica — é a resposta de quem está numa OUTRA máquina.
 *
 * As chaves de projeto que o navegador registrou ANTES do ADR 0203 continuam
 * valendo e continuam reconhecidas aqui (`ReconhecimentoDeProjeto`): o runner
 * configurado assim não quebra.
 *
 * **Reconhecer NÃO é dizer que o agente está de pé.** Chave registrada prova
 * pareamento, nunca processo vivo (RN-468, a régua do `workspaceVerifiedAt`),
 * e a lista é da CONTA e não deste navegador — então nem "esta máquina está
 * pareada" a tela pode afirmar. Os dois limites são ditos em texto, ao lado
 * do reconhecimento.
 *
 * **Onde isso aparece, e por que não é igual nos três montadores.** O
 * reconhecimento é por PROJETO, porque a rota é
 * `GET /projects/:projectId/runner-device-keys` — então ele existe em
 * `TerminalPanel` e `FolderBrowserModal`, que sempre têm um projeto, e no
 * `NewProjectWizard` só DEPOIS da criação antecipada (RN-437): sem
 * `projectId` não há a quem perguntar.
 */
export function RunnerOnboardingPanel({
  projectId,
  mensagem,
  onRetry,
  retrying,
  className,
  caminhoSugerido,
  mostrarEspera = true,
}: RunnerOnboardingPanelProps) {
  const { t } = useTranslation('terminal');

  /**
   * O caminho do projeto, quando quem montou o painel não o passou.
   *
   * Mesma `queryKey` que as telas de projeto já mantêm — no `TerminalPanel`
   * (aba Código) ela costuma estar quente, então isto raramente custa uma ida
   * à rede. `enabled` só quando falta: no `NewProjectWizard` o projeto pode
   * nem existir ainda, e lá o caminho chega por prop.
   */
  const projetoQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId!),
    enabled: Boolean(projectId) && caminhoSugerido === undefined,
  });
  const caminhoDoProjeto =
    caminhoSugerido ?? projetoQuery.data?.workspacePath ?? undefined;

  /**
   * O papel de quem está olhando — de WORKSPACE, com o limite declarado em
   * `EntradaDoReconhecimento.papel`: quem autoriza do outro lado é o EFETIVO
   * do projeto (RN-471). Serve para não pedir uma listagem que a api vai
   * recusar; o 403 de verdade também é tratado, logo abaixo.
   */
  const { data: workspaceComPapel } = useCurrentWorkspaceWithRole();
  const chavesQuery = useQuery({
    queryKey: chavesDoProjetoQueryKey(projectId),
    queryFn: () => listRunnerDeviceKeys(projectId!),
    enabled: Boolean(projectId) && podeLerChavesDeDispositivo(workspaceComPapel?.role),
    // Credencial registrada não muda sozinha enquanto esta tela está aberta, e
    // o que muda — o agente conectar — é a `EsperaDoRunner` quem sonda. Um
    // `refetchInterval` aqui seria uma segunda sonda respondendo a pergunta de
    // outra.
    retry: false,
  });
  const reconhecimento = reconhecerAgenteDeMaquina({
    papel: workspaceComPapel?.role,
    chaves: chavesQuery.data,
    carregando: chavesQuery.isPending,
    falhou: chavesQuery.isError,
    statusDoErro: chavesQuery.error instanceof ApiError ? chavesQuery.error.status : null,
  });
  const reconhecimentoDeProjeto = reconhecerChaveDeProjeto({
    projectId,
    chaves: chavesQuery.data,
  });
  const maquinaReconhecida = maquinaJaPareada(reconhecimento);
  const jaPareada = maquinaReconhecida || projetoJaPareado(reconhecimentoDeProjeto);

  const [copiado, setCopiado] = useState(false);

  async function copiarComandoDoInstalador() {
    try {
      await navigator.clipboard.writeText(COMANDO_DO_INSTALADOR);
      setCopiado(true);
    } catch {
      // Sem toast dedicado aqui — o bloco de código já é copiável à mão
      // (`user-select: all`), então a falha do clipboard não bloqueia nada.
    }
  }

  const comandoManual = t('runnerOnboarding.command', {
    projectId: projectId ?? t('runnerOnboarding.placeholderProjectId'),
    caminho: caminhoDoProjeto?.trim() || t('runnerOnboarding.placeholderPath'),
  });

  return (
    <div className={[styles.painel, className].filter(Boolean).join(' ')} role="status">
      <TerminalIcon size={22} />
      <p className={styles.mensagem}>
        {mensagem || (projectId ? t('runnerOnboarding.defaultMessage') : t('runnerOnboarding.noProjectMessage'))}
      </p>

      {projectId && (
        <ReconhecimentoDeMaquina
          reconhecimento={reconhecimento}
          projectId={projectId}
          mostrarEspera={mostrarEspera}
        />
      )}

      {projectId && (
        <ReconhecimentoDeProjeto
          reconhecimento={reconhecimentoDeProjeto}
          projectId={projectId}
          // A espera é UMA por tela: se a máquina já foi reconhecida, é o bloco
          // dela que a mostra.
          mostrarEspera={mostrarEspera && !maquinaReconhecida}
        />
      )}

      {/* O instalador é o caminho de quem ainda não tem chave que sirva este
          projeto (ADR 0203). Reconhecida a chave, ele sai: o gesto passa a ser
          conferir o serviço, e o comando manual abaixo é a resposta de quem
          está em OUTRA máquina. */}
      {!jaPareada && (
        <div className={styles.instrucao}>
          <p className={styles.avisoPassoHumano}>{t('runnerOnboarding.instaladorIntro')}</p>
          <code className={styles.comando}>{COMANDO_DO_INSTALADOR}</code>
          <Button type="button" variant="secondary" onClick={() => void copiarComandoDoInstalador()}>
            {copiado ? t('runnerOnboarding.copiedButton') : t('runnerOnboarding.copyButton')}
          </Button>
          <p className={styles.detalhe}>{t('runnerOnboarding.instaladorFaz')}</p>
          <p className={styles.detalhe}>{t('runnerOnboarding.instaladorOutraMaquina')}</p>
          <p className={styles.detalhe}>{t('runnerOnboarding.passoHumano')}</p>

          {/* A espera da RN-474: depois do instalador, o que falta é o agente
              CONECTAR, e é isso que ela responde sozinha. Sem projeto não há o
              que esperar. */}
          {projectId && mostrarEspera && <EsperaDoRunner projectId={projectId} />}
        </div>
      )}

      <details className={styles.manual}>
        <summary>{t('runnerOnboarding.manualDisclosureSummary')}</summary>
        <div className={styles.instrucao}>
          <p>
            {t('runnerOnboarding.instructionPrefix')} <code>apps/runner/README.md</code>
            {t('runnerOnboarding.instructionSuffix')}
          </p>
          <code className={styles.comando}>{comandoManual}</code>
          <p className={styles.detalhe}>{t('runnerOnboarding.detail')}</p>
        </div>
      </details>

      {onRetry && (
        <Button type="button" variant="secondary" onClick={onRetry} loading={retrying}>
          {t('runnerOnboarding.retryButton')}
        </Button>
      )}
    </div>
  );
}

/**
 * O bloco que reconhece — ou recusa reconhecer — um agente local de máquina já
 * pareado (RN-548).
 *
 * Sete estados chegam aqui e **seis** renderizam alguma coisa.
 * `semChaveDeMaquina` renderiza NADA de propósito, e isso não é um vazio
 * escondido: o painel inteiro já É a resposta para "nenhuma máquina pareada",
 * e uma linha dizendo isso ao lado do comando do instalador seria a tela
 * repetindo em prosa o que o comando diz em ação. Os outros seis afirmam coisas que o
 * painel sozinho não afirma — inclusive os dois que afirmam ignorância.
 */
function ReconhecimentoDeMaquina({
  reconhecimento,
  projectId,
  mostrarEspera,
}: {
  reconhecimento: ReconhecimentoDeAgenteDeMaquina;
  projectId: string;
  mostrarEspera: boolean;
}) {
  const { t, i18n } = useTranslation('terminal');

  if (reconhecimento.estado === 'semChaveDeMaquina') return null;

  if (reconhecimento.estado === 'verificando') {
    return <p className={styles.detalhe}>{t('agenteDeMaquina.verificando')}</p>;
  }

  // Os dois textos de ignorância, e eles são DIFERENTES: num sabemos por que
  // não perguntamos, no outro perguntamos e não obtivemos resposta. Nenhum dos
  // dois vira "não há máquina pareada" (RN-470).
  if (reconhecimento.estado === 'semPapel') {
    return <p className={styles.avisoPassoHumano}>{t('agenteDeMaquina.semPapel')}</p>;
  }
  if (reconhecimento.estado === 'naoSei') {
    return <p className={styles.avisoPassoHumano}>{t('agenteDeMaquina.naoSei')}</p>;
  }

  const nomes = reconhecimento.nomes.join(', ');

  if (reconhecimento.estado === 'revogada') {
    return (
      <Alert tone="warning">
        {t('agenteDeMaquina.revogada', { nomes })} {t('agenteDeMaquina.alcance')}
      </Alert>
    );
  }

  return (
    <div className={styles.reconhecimento}>
      {/* `accent`, nunca `success`: verde aqui leria como "está de pé", que é
          exatamente a afirmação que este dado não sustenta — a mesma
          aritmética de tom que `AmbienteDoProjeto` faz na linha do runner. */}
      <Alert tone="accent">
        {reconhecimento.estado === 'pareada'
          ? t('agenteDeMaquina.pareada', {
              nomes,
              data: new Date(reconhecimento.ultimoUso).toLocaleString(i18n.language),
            })
          : t('agenteDeMaquina.pareadaNuncaUsada', { nomes })}
      </Alert>

      {/* As três ressalvas, e nenhuma é opcional: a primeira separa "pareada"
          de "rodando" (RN-468), a segunda separa "sua conta" de "este
          navegador" — sem ela, o `<details>` do comando manual pareceria um
          caminho morto para quem está numa segunda máquina — e a terceira diz o que a
          ESPÉCIE custa: revogar esta chave derruba o agente em todo projeto. */}
      <p className={styles.detalhe}>{t('agenteDeMaquina.ressalvaNaoEBatimento')}</p>
      <p className={styles.detalhe}>{t('agenteDeMaquina.ressalvaDaConta')}</p>
      <p className={styles.detalhe}>{t('agenteDeMaquina.alcance')}</p>

      {/* O comando é o da ESPÉCIE reconhecida (AT-106): a chave de máquina é
          servida pela unit de MÁQUINA (`brabo-runner.service`, RN-545), e
          perguntar pela de projeto responderia "não instalado" sobre uma
          máquina que tem o agente de pé. O comando serve para a pessoa
          PERGUNTAR; a tela continua sem afirmar a resposta (RN-468/548). */}
      <p className={styles.gesto}>{t('agenteDeMaquina.gesto')}</p>
      <code className={styles.comando}>{t('agenteDeMaquina.comandoDeServico')}</code>

      {/* A espera da RN-474, reusada: reconhecida a máquina, o que falta é o
          agente CONECTAR, e essa é exatamente a pergunta que ela responde
          sozinha. `mostrarEspera` continua sendo quem impede a segunda espera
          na mesma tela (o `FolderBrowserModal` monta a dele no topo). */}
      {mostrarEspera && <EsperaDoRunner projectId={projectId} />}
    </div>
  );
}

/**
 * O bloco da chave de PROJETO já pareada (AT-107). Mesmo vocabulário do de
 * máquina: tom `accent` e nunca `success`, chave registrada não é agente de pé,
 * e o custo da ESPÉCIE é dito — revogar derruba o agente NESTE projeto só.
 */
function ReconhecimentoDeProjeto({
  reconhecimento,
  projectId,
  mostrarEspera,
}: {
  reconhecimento: ReconhecimentoDeChaveDeProjeto;
  projectId: string;
  mostrarEspera: boolean;
}) {
  const { t, i18n } = useTranslation('terminal');

  if (reconhecimento.estado === 'nenhuma') return null;
  const nomes = reconhecimento.nomes.join(', ');

  if (reconhecimento.estado === 'revogada') {
    return (
      <Alert tone="warning">
        {t('chaveDeProjeto.revogada', { nomes })} {t('chaveDeProjeto.alcance')}
      </Alert>
    );
  }

  return (
    <div className={styles.reconhecimento}>
      <Alert tone="accent">
        {reconhecimento.estado === 'pareada'
          ? t('chaveDeProjeto.pareada', {
              nomes,
              data: new Date(reconhecimento.ultimoUso).toLocaleString(i18n.language),
            })
          : t('chaveDeProjeto.pareadaNuncaUsada', { nomes })}
      </Alert>
      <p className={styles.detalhe}>{t('agenteDeMaquina.ressalvaNaoEBatimento')}</p>
      <p className={styles.detalhe}>{t('agenteDeMaquina.ressalvaDaConta')}</p>
      <p className={styles.detalhe}>{t('chaveDeProjeto.alcance')}</p>
      <p className={styles.gesto}>{t('agenteDeMaquina.gesto')}</p>
      <code className={styles.comando}>
        {t('chaveDeProjeto.comandoDeServico', { projectId })}
      </code>
      {mostrarEspera && <EsperaDoRunner projectId={projectId} />}
    </div>
  );
}
