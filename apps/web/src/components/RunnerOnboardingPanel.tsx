import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { API_URL, ApiError, getProject, listRunnerDeviceKeys } from '../lib/api-client';
import { useCurrentWorkspaceWithRole } from '../lib/hooks';
import {
  maquinaJaPareada,
  podeLerChavesDeDispositivo,
  reconhecerAgenteDeMaquina,
  type ReconhecimentoDeAgenteDeMaquina,
} from '../lib/agente-de-maquina';
import {
  baixarKitManual,
  configurarPastaAutomaticamente,
  detectarPlataforma,
  plataformasSuportadas,
  suportaEscritaDeArquivos,
  type RunnerPlatform,
} from '../lib/runner-bootstrap';
import { Button } from './ui/Button';
import { Alert } from './ui/Alert';
import { TerminalIcon } from './ui/icons';
import { EsperaDoRunner } from './EsperaDoRunner';
import styles from './RunnerOnboardingPanel.module.css';

interface RunnerOnboardingPanelProps {
  /**
   * `null` quando o projeto ainda não existe (passo `workspace` do
   * `NewProjectWizard`, ANTES da criação antecipada — RN-437/ADR 0108): a
   * configuração automática precisa de um id real para registrar a chave de
   * dispositivo, então só o comando manual (com placeholder) fica visível.
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

type EstadoAutomatico =
  | { fase: 'idle' }
  | { fase: 'configurando' }
  | { fase: 'baixando' }
  | { fase: 'sucesso'; instrucaoFinal: string; pasta: string; falhaDoBinario: string | null }
  | { fase: 'kitBaixado'; instrucaoFinal: string; falhaDoBinario: string | null }
  | { fase: 'erro'; mensagem: string };

/**
 * Cancelar o seletor de pasta chega como `AbortError` e NÃO é falha: nada foi
 * registrado, nada foi gravado, e um alerta vermelho ali diria que algo deu
 * errado quando a pessoa só mudou de ideia. Volta para `idle`, com o botão
 * pronto de novo.
 */
function ehCancelamentoDoSeletor(erro: unknown): boolean {
  return erro instanceof Error && (erro.name === 'AbortError' || erro.name === 'NotAllowedError');
}

/**
 * Onboarding de instalação do Runner (ADR sobre navegação de pasta via o
 * Runner) — painel compartilhado por TRÊS lugares: `TerminalPanel` (estado
 * "sem runner" da aba Terminal, RN-088), `FolderBrowserModal` (sem como
 * navegar sem runner) e `NewProjectWizard` (passo `workspace`, modo
 * `runner`). Um só texto de instalação, uma só régua de "está conectado?".
 *
 * Além do comando manual de sempre (agora sempre com `--token`, e escondido
 * atrás de um `<details>` colapsável — "prefiro rodar manualmente"), oferece
 * um caminho que não pede PAT nenhum: gera um par de chaves Ed25519 NO
 * PRÓPRIO NAVEGADOR, registra a pública no projeto e grava o binário já
 * configurado numa pasta real (File System Access API, só Chromium) ou, fora
 * disso, dispara dois downloads comuns pro usuário mover à mão
 * (`lib/runner-bootstrap.ts`).
 *
 * ## Os quatro passos, nesta ordem (RN-473)
 *
 * 1. **Pasta** — `showDirectoryPicker` abre antes de qualquer rede ou cripto.
 * 2. **Configuração** — config + chave de dispositivo gravadas ali dentro.
 * 3. **Binário**, best-effort: falhar aqui não descarta nada, só troca a
 *    instrução pelo caminho de distribuição alternativo (`npm install -g
 *    @brabo/runner`).
 * 4. **Instrução e espera** — UM comando copiável, e a `EsperaDoRunner`
 *    logo abaixo, que resolve sozinha quando o runner conectar (RN-474).
 *
 * O passo 4 é humano em qualquer desenho: uma página web não executa binário
 * na máquina de ninguém, e a File System Access API não preserva o bit de
 * execução. O que este painel faz é encolhê-lo a uma linha e um clique de
 * cópia — nunca fingir que ele sumiu.
 *
 * ## O reconhecimento de máquina já pareada (RN-548, ADR 0154)
 *
 * Desde a RN-543 a listagem de chaves marca a ESPÉCIE, e é daqui que essa
 * marca é consumida: quando a conta já tem chave de MÁQUINA ativa, mandar a
 * pessoa repetir o pareamento que a máquina já tem é o painel respondendo à
 * pergunta errada. A derivação inteira — sete estados, nenhum virando o
 * outro — mora em `lib/agente-de-maquina.ts`, fora do componente, porque a
 * regra é sobre o DADO e o componente é sobre o desenho.
 *
 * **Reconhecer NÃO é dizer que o agente está de pé.** Chave registrada prova
 * pareamento, nunca processo vivo (RN-468, a régua do `workspaceVerifiedAt`),
 * e a lista é da CONTA e não deste navegador — então nem "esta máquina está
 * pareada" a tela pode afirmar. Os dois limites são ditos em texto, ao lado
 * do reconhecimento, e é por eles que o caminho do ADR 0118 **continua
 * alcançável em todos os estados**: ele apenas deixa de ser o primeiro,
 * recolhido para um `<details>` cujo rótulo nomeia o caso que ele resolve
 * ("esta máquina é outra"). Nada é removido — aposentá-lo é o BRB-031, e é
 * decisão do mantenedor.
 *
 * **Onde isso aparece, e por que não é igual nos três montadores.** O
 * reconhecimento é por PROJETO, porque a rota é
 * `GET /projects/:projectId/runner-device-keys` — então ele existe em
 * `TerminalPanel` e `FolderBrowserModal`, que sempre têm um projeto, e no
 * `NewProjectWizard` só DEPOIS da criação antecipada (RN-437): sem
 * `projectId` não há a quem perguntar, e o painel fica byte a byte como era.
 * A diferença não é escolha de desenho, é a forma do endpoint.
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
    queryKey: ['runner-device-keys', projectId],
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
  const jaPareada = maquinaJaPareada(reconhecimento);

  const [suportaFS] = useState(() => suportaEscritaDeArquivos());
  const [plataforma, setPlataforma] = useState<RunnerPlatform | null>(null);
  const [detectandoPlataforma, setDetectandoPlataforma] = useState(true);
  const [plataformaManual, setPlataformaManual] = useState<RunnerPlatform>('linux-x64');
  const [estado, setEstado] = useState<EstadoAutomatico>({ fase: 'idle' });
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    let cancelado = false;
    void detectarPlataforma().then((detectada) => {
      if (cancelado) return;
      setPlataforma(detectada);
      setDetectandoPlataforma(false);
    });
    return () => {
      cancelado = true;
    };
  }, []);

  const modoAutomatico = suportaFS && plataforma !== null;
  const plataformaEfetiva = plataforma ?? plataformaManual;

  async function handleConfigurarAutomaticamente() {
    if (!projectId) return;
    setEstado({ fase: 'configurando' });
    try {
      const { instrucaoFinal, pasta, falhaDoBinario } = await configurarPastaAutomaticamente({
        projectId,
        apiUrl: API_URL,
        platform: plataformaEfetiva,
        // Só o fluxo AUTOMÁTICO recebe o caminho: nele o navegador grava os
        // arquivos DENTRO da pasta escolhida, então `cd <caminho>` leva a
        // pessoa a um lugar onde o comando funciona. O kit manual (abaixo)
        // NÃO recebe, e não é esquecimento — lá os arquivos caem na pasta de
        // downloads, e prefixar `cd` mandaria para uma pasta onde eles ainda
        // não estão.
        caminhoDoProjeto,
      });
      setCopiado(false);
      setEstado({ fase: 'sucesso', instrucaoFinal, pasta, falhaDoBinario });
    } catch (erro) {
      if (ehCancelamentoDoSeletor(erro)) {
        setEstado({ fase: 'idle' });
        return;
      }
      setEstado({
        fase: 'erro',
        mensagem: erro instanceof Error ? erro.message : t('runnerOnboarding.autoConfigureError'),
      });
    }
  }

  async function handleBaixarKit() {
    if (!projectId) return;
    setEstado({ fase: 'baixando' });
    try {
      const { instrucaoFinal, falhaDoBinario } = await baixarKitManual({
        projectId,
        apiUrl: API_URL,
        platform: plataformaEfetiva,
      });
      setCopiado(false);
      setEstado({ fase: 'kitBaixado', instrucaoFinal, falhaDoBinario });
    } catch (erro) {
      setEstado({
        fase: 'erro',
        mensagem: erro instanceof Error ? erro.message : t('runnerOnboarding.autoConfigureError'),
      });
    }
  }

  async function copiarInstrucao() {
    if (estado.fase !== 'sucesso' && estado.fase !== 'kitBaixado') return;
    try {
      await navigator.clipboard.writeText(estado.instrucaoFinal);
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

  /*
   * O pareamento do ADR 0118 — o aviso do passo humano e os botões — num
   * bloco só, porque ele muda de LUGAR (primeiro plano ou dentro do
   * `<details>`) e nunca de conteúdo. Duplicar o JSX nos dois ramos faria as
   * duas cópias divergirem exatamente uma vez.
   */
  const blocoDePareamento = projectId && (
    <>
      {/* O passo humano é anunciado ANTES do clique, não só no fim.
          `passoHumano` já existia — mas só era renderizado no estado de
          SUCESSO, depois de a pessoa escolher a pasta e esperar. Quem clica
          num botão chamado "Configurar pasta automaticamente" e só então
          descobre que ainda vai ter de abrir um terminal foi surpreendido,
          mesmo que nenhuma frase tenha mentido. A RN-473 diz que a tela nunca
          finge que o passo não existe; anunciá-lo no fim é o mais tarde
          possível para não ser fingimento.

          O texto do sucesso CONTINUA lá: aqui ele avisa que o passo VAI
          existir, lá ele explica POR QUE existe. São duas perguntas
          diferentes, feitas em momentos diferentes. */}
      {estado.fase === 'idle' && (
        <p className={styles.avisoPassoHumano}>
          {t('runnerOnboarding.avisoTerminalAntes')}
        </p>
      )}

      <div className={styles.acoesAutomaticas}>
        {modoAutomatico ? (
          <Button type="button" onClick={() => void handleConfigurarAutomaticamente()} loading={estado.fase === 'configurando'}>
            {estado.fase === 'configurando'
              ? t('runnerOnboarding.autoConfiguring')
              : t('runnerOnboarding.autoConfigureButton')}
          </Button>
        ) : (
          <>
            {!detectandoPlataforma && plataforma === null && (
              <label className={styles.selecaoPlataforma}>
                {t('runnerOnboarding.platformSelectLabel')}
                <select
                  value={plataformaManual}
                  onChange={(e) => setPlataformaManual(e.target.value as RunnerPlatform)}
                >
                  {plataformasSuportadas().map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <Button type="button" variant="secondary" onClick={() => void handleBaixarKit()} loading={estado.fase === 'baixando'}>
              {estado.fase === 'baixando'
                ? t('runnerOnboarding.downloadingKit')
                : t('runnerOnboarding.downloadKitButton')}
            </Button>
            <p className={styles.detalhe}>{t('runnerOnboarding.downloadKitNote')}</p>
          </>
        )}
      </div>
    </>
  );

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
          // UMA espera por tela, e a regra não muda com o reconhecimento: se a
          // pessoa entrou no `<details>` e configurou a pasta mesmo assim, quem
          // mostra a espera é o bloco de sucesso, que é o passo mais recente.
          // Duas esperas seriam duas sondas, dois tetos e — no pior caso — duas
          // frases discordando sobre o mesmo carimbo.
          mostrarEspera={
            mostrarEspera && estado.fase !== 'sucesso' && estado.fase !== 'kitBaixado'
          }
        />
      )}

      {/* O caminho do ADR 0118 NUNCA some — ele muda de lugar. Reconhecida a
          máquina, o primeiro plano passa a ser "o agente não está de pé", e
          parear vai para um `<details>` cujo rótulo nomeia o único caso em que
          ele ainda é a resposta: você está em OUTRA máquina. */}
      {jaPareada ? (
        <details className={styles.manual}>
          <summary>{t('agenteDeMaquina.parearMesmoAssim')}</summary>
          <div className={styles.instrucao}>{blocoDePareamento}</div>
        </details>
      ) : (
        blocoDePareamento
      )}

      {estado.fase === 'erro' && (
        <Alert tone="danger" role="alert">
          {estado.mensagem}
        </Alert>
      )}

      {(estado.fase === 'sucesso' || estado.fase === 'kitBaixado') && (
        <div className={styles.instrucao}>
          {estado.fase === 'sucesso' ? (
            <Alert tone="success">
              {t('runnerOnboarding.pastaConfigurada', { pasta: estado.pasta })}
            </Alert>
          ) : (
            <Alert tone="success">{t('runnerOnboarding.downloadKitDone')}</Alert>
          )}

          {/* A falha do binário NÃO descarta a configuração (RN-473): os dois
              arquivos que o runner precisa já estão gravados, e o que muda é
              só POR ONDE o executável chega. O aviso diz o que houve, e a
              instrução abaixo já é a do caminho alternativo. */}
          {estado.falhaDoBinario && (
            <Alert tone="warning">
              {t('runnerOnboarding.binarioIndisponivel', { motivo: estado.falhaDoBinario })}
            </Alert>
          )}

          <p>
            {estado.falhaDoBinario
              ? t('runnerOnboarding.successIntroSemBinario')
              : estado.fase === 'sucesso'
                ? t('runnerOnboarding.successIntro')
                : t('runnerOnboarding.successIntroKit')}
          </p>
          <code className={styles.comando}>{estado.instrucaoFinal}</code>
          <Button type="button" variant="secondary" onClick={() => void copiarInstrucao()}>
            {copiado ? t('runnerOnboarding.copiedButton') : t('runnerOnboarding.copyButton')}
          </Button>
          <p className={styles.detalhe}>{t('runnerOnboarding.passoHumano')}</p>

          {/* Só existe configuração feita se havia `projectId` — os dois
              handlers retornam cedo sem ele. A guarda é para o compilador. */}
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
 * e uma linha dizendo isso ao lado do botão de parear seria a tela repetindo
 * em prosa o que o botão diz em ação. Os outros seis afirmam coisas que o
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
          navegador" — sem ela, o `<details>` de parear pareceria um caminho
          morto para quem está numa segunda máquina — e a terceira diz o que a
          ESPÉCIE custa: revogar esta chave derruba o agente em todo projeto. */}
      <p className={styles.detalhe}>{t('agenteDeMaquina.ressalvaNaoEBatimento')}</p>
      <p className={styles.detalhe}>{t('agenteDeMaquina.ressalvaDaConta')}</p>
      <p className={styles.detalhe}>{t('agenteDeMaquina.alcance')}</p>

      <p className={styles.gesto}>{t('agenteDeMaquina.gesto')}</p>
      <code className={styles.comando}>
        {t('agenteDeMaquina.comandoDeServico', { projectId })}
      </code>

      {/* A espera da RN-474, reusada: reconhecida a máquina, o que falta é o
          agente CONECTAR, e essa é exatamente a pergunta que ela responde
          sozinha. `mostrarEspera` continua sendo quem impede a segunda espera
          na mesma tela (o `FolderBrowserModal` monta a dele no topo). */}
      {mostrarEspera && <EsperaDoRunner projectId={projectId} />}
    </div>
  );
}
