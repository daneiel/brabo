import { API_URL, registerRunnerDeviceKey } from './api-client';

/**
 * Bootstrap do runner local direto do navegador (onboarding de projeto em
 * modo `runner`, ver `RunnerOnboardingPanel`).
 *
 * Hoje configurar o `brabo-runner` na máquina do usuário exigia juntar à mão
 * três coisas espalhadas em telas diferentes: o id do projeto, o caminho da
 * pasta (digitado, nunca gravado) e um Personal Access Token (emitido numa
 * terceira tela). Este módulo junta os três num fluxo só: escolhe a PASTA,
 * gera um par de chaves Ed25519 NO PRÓPRIO NAVEGADOR (Web Crypto nativo —
 * sem PAT nenhum pra digitar), registra a chave pública no projeto e grava
 * tudo já configurado ali dentro (File System Access API, só Chromium) — ou,
 * fora do Chromium/sem suporte, dispara dois downloads comuns pro usuário
 * mover pra mesma pasta manualmente.
 *
 * A chave PRIVADA nunca sai do navegador por rede: só a pública vai para a
 * api (`registerRunnerDeviceKey`); a privada é escrita local (arquivo na
 * pasta, ou download) para o runner ler ao subir.
 *
 * ## A pasta vem PRIMEIRO, e o binário é o ÚLTIMO passo (RN-473)
 *
 * A ordem original era `chave → registro → binário → pasta`, e ela tinha um
 * defeito de consequência desproporcional: o download do binário é o único
 * passo que depende de uma release publicada no GitHub, e quando ele falha
 * (hoje, 502 "plataforma ainda não publicada nesta release") a exceção subia
 * ANTES de `showDirectoryPicker` — o seletor de pasta nunca chegava a abrir,
 * e o fluxo inteiro terminava sem nada gravado.
 *
 * A ordem de agora é `pasta → chave → registro → config → chave privada →
 * binário`, e o último passo é BEST-EFFORT: falhar ali devolve
 * `falhaDoBinario` preenchido, nunca lança. Os dois arquivos que o runner
 * REALMENTE precisa (`brabo-runner.config.json` e
 * `brabo-runner-device-key.jwk.json`, RN-466) já estão na pasta, e o binário
 * tem outros dois caminhos de distribuição documentados — `npm install -g
 * @brabo/runner` e o checkout do monorepo — que `instrucaoFinal` passa a
 * oferecer nesse caso.
 *
 * Pôr `showDirectoryPicker` na primeira linha também é mais correto do lado
 * do navegador: ele exige ativação transitória do usuário, e três `await` de
 * rede/cripto antes dele consomem essa janela em alguns Chromium.
 */

export type RunnerPlatform =
  | 'linux-x64'
  | 'linux-arm64'
  | 'darwin-x64'
  | 'darwin-arm64'
  | 'win32-x64';

const PLATAFORMAS: readonly RunnerPlatform[] = [
  'linux-x64',
  'linux-arm64',
  'darwin-x64',
  'darwin-arm64',
  'win32-x64',
];

export function plataformasSuportadas(): readonly RunnerPlatform[] {
  return PLATAFORMAS;
}

// A File System Access API (`showDirectoryPicker`) e a UA-CH
// (`navigator.userAgentData`) não fazem parte do `lib.dom.d.ts` padrão do
// TypeScript ainda — augmentação mínima, só o que este módulo usa.
declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      id?: string;
      mode?: 'read' | 'readwrite';
    }) => Promise<FileSystemDirectoryHandle>;
  }
  interface Navigator {
    userAgentData?: {
      platform: string;
      getHighEntropyValues(hints: string[]): Promise<{
        platform?: string;
        architecture?: string;
        bitness?: string;
      }>;
    };
  }
}

/**
 * A File System Access API (`showDirectoryPicker`) só existe em
 * Chromium — Chrome, Edge, Opera. Firefox e Safari não implementam.
 */
export function suportaEscritaDeArquivos(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

function arquiteturaIndicaArm(architecture: string | undefined): boolean {
  return !!architecture && /arm|aarch64/i.test(architecture);
}

/**
 * Detecta SO + arquitetura para escolher o binário certo do runner.
 *
 * Em Chromium, usa `navigator.userAgentData.getHighEntropyValues` — a única
 * forma confiável de saber a arquitetura real (o `userAgent` clássico do
 * Chrome mais recente congelou e mente sobre isso, "reducing" de propósito).
 * Fora do Chromium, cai numa heurística BEST-EFFORT sobre
 * `navigator.userAgent`/`navigator.platform`: funciona para o SO, mas a
 * arquitetura não tem garantia nenhuma fora da UA-CH. Sem confiança
 * suficiente em nenhuma das duas formas, devolve `null` — quem chama deixa o
 * usuário escolher a plataforma manualmente.
 */
export async function detectarPlataforma(): Promise<RunnerPlatform | null> {
  if (typeof navigator === 'undefined') return null;

  if ('userAgentData' in navigator && navigator.userAgentData) {
    try {
      const valores = await navigator.userAgentData.getHighEntropyValues([
        'platform',
        'architecture',
        'bitness',
      ]);
      const so = (valores.platform ?? '').toLowerCase();
      const arm = arquiteturaIndicaArm(valores.architecture);
      if (so.includes('windows')) return 'win32-x64';
      if (so.includes('mac')) return arm ? 'darwin-arm64' : 'darwin-x64';
      if (so.includes('linux')) return arm ? 'linux-arm64' : 'linux-x64';
      return null;
    } catch {
      // Cai no fallback de heurística abaixo.
    }
  }

  const ua = `${navigator.userAgent ?? ''} ${navigator.platform ?? ''}`;
  const arm = /arm|aarch64/i.test(ua);
  if (/mac/i.test(ua)) return arm ? 'darwin-arm64' : 'darwin-x64';
  if (/win/i.test(ua)) return 'win32-x64';
  if (/linux|x11/i.test(ua)) return arm ? 'linux-arm64' : 'linux-x64';
  return null;
}

/**
 * Par de chaves Ed25519 gerado NO NAVEGADOR (Web Crypto nativo, sem lib
 * nova). Nem todo Chromium mais antigo suporta o algoritmo — a exceção
 * nativa vira um erro com mensagem clara, pro chamador oferecer o comando
 * manual como saída.
 */
export async function gerarParDeChaves(): Promise<CryptoKeyPair> {
  try {
    return await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  } catch {
    throw new Error(
      'Este navegador não suporta geração de chaves Ed25519 — use o comando manual.',
    );
  }
}

export async function exportarJwkPublica(par: CryptoKeyPair): Promise<string> {
  const jwk = await crypto.subtle.exportKey('jwk', par.publicKey);
  return JSON.stringify(jwk);
}

export async function exportarJwkPrivada(par: CryptoKeyPair): Promise<string> {
  const jwk = await crypto.subtle.exportKey('jwk', par.privateKey);
  return JSON.stringify(jwk);
}

/** Bytes do binário do runner para `platform`, direto da api (rota pública). */
export async function baixarBinario(platform: string): Promise<ArrayBuffer> {
  const res = await fetch(
    `${API_URL}/runner-releases/binary?platform=${encodeURIComponent(platform)}`,
  );
  if (!res.ok) {
    throw new Error(
      `Não foi possível baixar o binário do runner para "${platform}" (HTTP ${res.status}).`,
    );
  }
  return res.arrayBuffer();
}

function nomeDoExecutavel(platform: string): string {
  return platform === 'win32-x64' ? 'brabo-runner.exe' : 'brabo-runner';
}

/** Não precisa ser perfeito — só ajudar o usuário a reconhecer o dispositivo depois. */
function nomeDoDispositivo(platform: string): string {
  const data = new Date().toISOString().slice(0, 10);
  return `navegador · ${data} · ${platform}`;
}

function obterShowDirectoryPicker(): NonNullable<Window['showDirectoryPicker']> {
  if (!window.showDirectoryPicker) {
    throw new Error('Este navegador não suporta escrita direta de arquivos — use o comando manual.');
  }
  return window.showDirectoryPicker;
}

async function escreverArquivo(
  dirHandle: FileSystemDirectoryHandle,
  nome: string,
  conteudo: BufferSource | string,
): Promise<void> {
  const fileHandle = await dirHandle.getFileHandle(nome, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(conteudo);
  await writable.close();
}

export interface ConfigurarPastaOpts {
  projectId: string;
  apiUrl: string;
  platform: string;
}

export interface ResultadoDaConfiguracao {
  /**
   * Nome da pasta escolhida (`FileSystemDirectoryHandle.name`). O navegador
   * NUNCA expõe o caminho absoluto — quem sabe dele é o runner, que o
   * reporta ao conectar e SOBRESCREVE `workspacePath`
   * (`ConfirmProjectWorkspaceUseCase`). A tela mostra este nome só para a
   * pessoa reconhecer a pasta, nunca como se fosse o caminho.
   */
  pasta: string;
  /** UM comando, copiável de uma vez, para a pessoa colar no terminal DELA. */
  instrucaoFinal: string;
  /**
   * `null` quando o binário foi gravado na pasta. Preenchido com o motivo
   * quando o download (ou a gravação) falhou — e nesse caso a configuração
   * NÃO é descartada: os outros dois arquivos já estão lá, e
   * `instrucaoFinal` passa a ser o caminho de distribuição alternativo.
   */
  falhaDoBinario: string | null;
}

/**
 * Comando único do caminho alternativo, quando o binário standalone não veio
 * (release sem asset para a plataforma, GitHub fora do ar, disco cheio). É um
 * dos TRÊS caminhos de distribuição do runner que o `CLAUDE.md` declara, e o
 * único que não depende nem da release nem de um checkout do monorepo.
 *
 * Funciona sem flag nenhuma porque `brabo-runner.config.json` e a chave de
 * dispositivo já estão na pasta, e o CLI lê os dois do `cwd` de onde o
 * comando roda (RN-466) — é o mesmo modo automático do binário.
 */
export const COMANDO_VIA_NPM = 'npm install -g @brabo/runner && brabo-runner';

function comandoDoBinario(platform: string): string {
  // A File System Access API NÃO preserva o bit de execução — limitação do
  // navegador, não deste código — então `chmod +x` (Linux/macOS) continua
  // sendo parte do comando. Uma página web não executa binário na máquina de
  // ninguém: este passo é humano em qualquer desenho, e o que dá para fazer
  // é encolhê-lo a UMA linha copiável.
  return platform.startsWith('win32')
    ? '.\\brabo-runner.exe'
    : 'chmod +x ./brabo-runner && ./brabo-runner';
}

/**
 * Fluxo automático, na ordem do docblock do módulo: **pasta primeiro**, e o
 * binário por último, best-effort.
 *
 * Rejeita só quando falta o essencial — sem pasta escolhida (inclusive
 * cancelamento do seletor, que chega como `AbortError`) ou sem chave
 * registrada não existe configuração nenhuma para salvar. A falha do binário
 * volta em `falhaDoBinario`, nunca como exceção.
 */
export async function configurarPastaAutomaticamente(
  opts: ConfigurarPastaOpts,
): Promise<ResultadoDaConfiguracao> {
  // PASSO 1 — a pasta, antes de qualquer rede ou cripto.
  const showDirectoryPicker = obterShowDirectoryPicker();
  const dirHandle = await showDirectoryPicker({ id: 'brabo-runner', mode: 'readwrite' });

  // PASSO 2 — a config, que não depende de chave nenhuma: se a pessoa fechar
  // a aba daqui em diante, a pasta já sabe a que projeto pertence.
  await escreverArquivo(
    dirHandle,
    'brabo-runner.config.json',
    JSON.stringify({ projectId: opts.projectId, apiUrl: opts.apiUrl }),
  );

  // PASSO 3 — o par de chaves e o registro da PÚBLICA, seguido de imediato
  // pela gravação da PRIVADA. Registrar antes de gravar é obrigatório na
  // ordem lógica (uma privada em disco sem contraparte no servidor não
  // autentica nada); a janela entre as duas é a menor possível.
  const par = await gerarParDeChaves();
  const publicKeyJwk = await exportarJwkPublica(par);
  await registerRunnerDeviceKey(opts.projectId, {
    name: nomeDoDispositivo(opts.platform),
    publicKeyJwk,
  });
  await escreverArquivo(
    dirHandle,
    'brabo-runner-device-key.jwk.json',
    await exportarJwkPrivada(par),
  );

  // PASSO 4 — o binário. É o ÚNICO passo que depende de uma release
  // publicada, e por isso é o único que não derruba o fluxo.
  let falhaDoBinario: string | null = null;
  try {
    const bytes = await baixarBinario(opts.platform);
    await escreverArquivo(dirHandle, nomeDoExecutavel(opts.platform), bytes);
  } catch (erro) {
    falhaDoBinario = erro instanceof Error ? erro.message : String(erro);
  }

  return {
    pasta: dirHandle.name,
    instrucaoFinal: falhaDoBinario ? COMANDO_VIA_NPM : comandoDoBinario(opts.platform),
    falhaDoBinario,
  };
}

function dispararDownload(conteudo: BlobPart, nomeArquivo: string, tipo: string): void {
  const blob = new Blob([conteudo], { type: tipo });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nomeArquivo;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export interface ResultadoDoKit {
  instrucaoFinal: string;
  /** Mesma semântica de `ResultadoDaConfiguracao.falhaDoBinario`. */
  falhaDoBinario: string | null;
}

/**
 * Fallback fora do Chromium (ou sem suporte a Ed25519/File System Access):
 * não há pasta a escolher — `showDirectoryPicker` não existe —, então em vez
 * de gravar direto, dispara downloads comuns do navegador que o usuário move
 * pra mesma pasta à mão.
 *
 * A mesma régua da RN-473 vale aqui: o KIT (configuração + chave privada) é
 * baixado PRIMEIRO e o binário é o último passo, best-effort. Antes, a falha
 * do binário abortava antes do kit e a pessoa terminava sem arquivo nenhum,
 * com a chave pública já registrada no projeto.
 */
export async function baixarKitManual(opts: ConfigurarPastaOpts): Promise<ResultadoDoKit> {
  const par = await gerarParDeChaves();
  const publicKeyJwk = await exportarJwkPublica(par);

  await registerRunnerDeviceKey(opts.projectId, {
    name: nomeDoDispositivo(opts.platform),
    publicKeyJwk,
  });

  const privateKeyJwk = await exportarJwkPrivada(par);
  dispararDownload(
    JSON.stringify({ projectId: opts.projectId, apiUrl: opts.apiUrl, privateKeyJwk }),
    'brabo-runner-kit.json',
    'application/json',
  );

  let falhaDoBinario: string | null = null;
  try {
    const bytes = await baixarBinario(opts.platform);
    dispararDownload(bytes, nomeDoExecutavel(opts.platform), 'application/octet-stream');
  } catch (erro) {
    falhaDoBinario = erro instanceof Error ? erro.message : String(erro);
  }

  return {
    instrucaoFinal: falhaDoBinario ? COMANDO_VIA_NPM : comandoDoBinario(opts.platform),
    falhaDoBinario,
  };
}
