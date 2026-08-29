import { API_URL, registerRunnerDeviceKey } from './api-client';

/**
 * Bootstrap do runner local direto do navegador (onboarding de projeto em
 * modo `runner`, ver `RunnerOnboardingPanel`).
 *
 * Hoje configurar o `brabo-runner` na máquina do usuário exigia juntar à mão
 * três coisas espalhadas em telas diferentes: o id do projeto, o caminho da
 * pasta (digitado, nunca gravado) e um Personal Access Token (emitido numa
 * terceira tela). Este módulo junta os três num fluxo só: gera um par de
 * chaves Ed25519 NO PRÓPRIO NAVEGADOR (Web Crypto nativo — sem PAT nenhum
 * pra digitar), registra a chave pública no projeto, baixa o binário do
 * runner certo para a plataforma detectada e grava tudo já configurado
 * numa pasta real escolhida pelo usuário (File System Access API, só
 * Chromium) — ou, fora do Chromium/sem suporte, dispara dois downloads
 * comuns pro usuário mover pra mesma pasta manualmente.
 *
 * A chave PRIVADA nunca sai do navegador por rede: só a pública vai para a
 * api (`registerRunnerDeviceKey`); a privada é escrita local (arquivo na
 * pasta, ou download) para o runner ler ao subir.
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

/**
 * Fluxo automático: gera a chave, registra a pública, baixa o binário e
 * grava os três arquivos já configurados numa pasta escolhida pelo usuário.
 *
 * A File System Access API NÃO preserva o bit de execução — limitação do
 * navegador, não deste código — então o passo `chmod +x` (Linux/macOS)
 * continua sendo manual, e é o que `instrucaoFinal` devolve para a UI
 * destacar.
 */
export async function configurarPastaAutomaticamente(
  opts: ConfigurarPastaOpts,
): Promise<{ instrucaoFinal: string }> {
  const par = await gerarParDeChaves();
  const publicKeyJwk = await exportarJwkPublica(par);

  await registerRunnerDeviceKey(opts.projectId, {
    name: nomeDoDispositivo(opts.platform),
    publicKeyJwk,
  });

  const bytes = await baixarBinario(opts.platform);
  const privateKeyJwk = await exportarJwkPrivada(par);

  const showDirectoryPicker = obterShowDirectoryPicker();
  const dirHandle = await showDirectoryPicker();

  await escreverArquivo(dirHandle, nomeDoExecutavel(opts.platform), bytes);
  await escreverArquivo(
    dirHandle,
    'brabo-runner.config.json',
    JSON.stringify({ projectId: opts.projectId, apiUrl: opts.apiUrl }),
  );
  await escreverArquivo(dirHandle, 'brabo-runner-device-key.jwk.json', privateKeyJwk);

  const instrucaoFinal = opts.platform.startsWith('win32')
    ? '.\\brabo-runner.exe'
    : 'chmod +x ./brabo-runner && ./brabo-runner';

  return { instrucaoFinal };
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

/**
 * Fallback fora do Chromium (ou sem suporte a Ed25519/File System Access):
 * mesmos três primeiros passos (chave, registro, download do binário), mas
 * em vez de gravar direto na pasta, dispara DOIS downloads comuns do
 * navegador — o binário e um kit com a configuração e a chave privada — que
 * o usuário move pra mesma pasta à mão.
 */
export async function baixarKitManual(opts: ConfigurarPastaOpts): Promise<void> {
  const par = await gerarParDeChaves();
  const publicKeyJwk = await exportarJwkPublica(par);

  await registerRunnerDeviceKey(opts.projectId, {
    name: nomeDoDispositivo(opts.platform),
    publicKeyJwk,
  });

  const bytes = await baixarBinario(opts.platform);
  const privateKeyJwk = await exportarJwkPrivada(par);

  dispararDownload(bytes, nomeDoExecutavel(opts.platform), 'application/octet-stream');
  dispararDownload(
    JSON.stringify({ projectId: opts.projectId, apiUrl: opts.apiUrl, privateKeyJwk }),
    'brabo-runner-kit.json',
    'application/json',
  );
}
