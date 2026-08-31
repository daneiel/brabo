import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `./api-client` é substituído por um dublê — só `registerRunnerDeviceKey` e
 * `API_URL` importam aqui, e o resto do arquivo real puxaria `runtime-config`
 * (que lê `import.meta.env`), fora do que este teste quer exercitar.
 */
const { registerRunnerDeviceKeyMock } = vi.hoisted(() => ({
  registerRunnerDeviceKeyMock: vi.fn(),
}));

vi.mock('./api-client', () => ({
  API_URL: 'https://api.brabo.example',
  registerRunnerDeviceKey: (...args: unknown[]) => registerRunnerDeviceKeyMock(...args),
}));

import {
  COMANDO_VIA_NPM,
  baixarBinario,
  baixarKitManual,
  configurarPastaAutomaticamente,
  detectarPlataforma,
  exportarJwkPrivada,
  exportarJwkPublica,
  gerarParDeChaves,
  suportaEscritaDeArquivos,
} from './runner-bootstrap';

function fakeResponse(status: number, body: ArrayBuffer | null = new ArrayBuffer(4)): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: () => Promise.resolve(body ?? new ArrayBuffer(0)),
  } as unknown as Response;
}

const PAR_FAKE = {
  publicKey: { type: 'public' } as unknown as CryptoKey,
  privateKey: { type: 'private' } as unknown as CryptoKey,
};

beforeEach(() => {
  registerRunnerDeviceKeyMock.mockReset();
  registerRunnerDeviceKeyMock.mockResolvedValue({
    id: 'device-1',
    name: 'navegador',
    createdAt: '2026-08-27T00:00:00.000Z',
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('suportaEscritaDeArquivos', () => {
  it('true quando `showDirectoryPicker` existe em `window`', () => {
    vi.stubGlobal('window', { showDirectoryPicker: vi.fn() });
    expect(suportaEscritaDeArquivos()).toBe(true);
  });

  it('false sem `showDirectoryPicker` — Firefox e Safari', () => {
    vi.stubGlobal('window', {});
    expect(suportaEscritaDeArquivos()).toBe(false);
  });
});

describe('detectarPlataforma', () => {
  it('usa `userAgentData.getHighEntropyValues` em Chromium', async () => {
    vi.stubGlobal('navigator', {
      userAgentData: {
        platform: 'macOS',
        getHighEntropyValues: vi.fn().mockResolvedValue({
          platform: 'macOS',
          architecture: 'arm',
          bitness: '64',
        }),
      },
    });

    await expect(detectarPlataforma()).resolves.toBe('darwin-arm64');
  });

  it('Chromium em Linux x64 via UA-CH', async () => {
    vi.stubGlobal('navigator', {
      userAgentData: {
        platform: 'Linux',
        getHighEntropyValues: vi.fn().mockResolvedValue({
          platform: 'Linux',
          architecture: 'x86',
          bitness: '64',
        }),
      },
    });

    await expect(detectarPlataforma()).resolves.toBe('linux-x64');
  });

  it('fallback de heurística por user-agent fora do Chromium (Firefox/Safari)', async () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Gecko/20100101 Firefox/128.0',
      platform: 'MacIntel',
    });

    await expect(detectarPlataforma()).resolves.toBe('darwin-x64');
  });

  it('fallback detecta Linux arm64 pela substring "aarch64"', async () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (X11; Linux aarch64) Gecko/20100101 Firefox/128.0',
      platform: 'Linux aarch64',
    });

    await expect(detectarPlataforma()).resolves.toBe('linux-arm64');
  });

  it('devolve null quando não dá pra determinar com confiança', async () => {
    vi.stubGlobal('navigator', { userAgent: '', platform: '' });

    await expect(detectarPlataforma()).resolves.toBeNull();
  });
});

describe('gerarParDeChaves / exportarJwk*', () => {
  it('gera o par via `crypto.subtle.generateKey` com Ed25519', async () => {
    const generateKey = vi.fn().mockResolvedValue(PAR_FAKE);
    vi.stubGlobal('crypto', { subtle: { generateKey } });

    const par = await gerarParDeChaves();

    expect(generateKey).toHaveBeenCalledWith({ name: 'Ed25519' }, true, ['sign', 'verify']);
    expect(par).toBe(PAR_FAKE);
  });

  it('propaga erro claro quando o navegador não suporta Ed25519', async () => {
    vi.stubGlobal('crypto', {
      subtle: { generateKey: vi.fn().mockRejectedValue(new Error('unsupported')) },
    });

    await expect(gerarParDeChaves()).rejects.toThrow(/não suporta/i);
  });

  it('exporta as JWKs como string JSON', async () => {
    const exportKey = vi.fn((_formato: string, key: CryptoKey) =>
      Promise.resolve({ kty: 'OKP', crv: 'Ed25519', papel: key === PAR_FAKE.publicKey ? 'pub' : 'priv' }),
    );
    vi.stubGlobal('crypto', { subtle: { exportKey } });

    const pub = await exportarJwkPublica(PAR_FAKE);
    const priv = await exportarJwkPrivada(PAR_FAKE);

    expect(JSON.parse(pub)).toMatchObject({ papel: 'pub' });
    expect(JSON.parse(priv)).toMatchObject({ papel: 'priv' });
  });
});

describe('baixarBinario', () => {
  it('busca a rota pública de binário com a plataforma na query', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(200));
    vi.stubGlobal('fetch', fetchMock);

    await baixarBinario('linux-x64');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.brabo.example/runner-releases/binary?platform=linux-x64',
    );
  });

  it('erro HTTP vira mensagem legível', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse(502, null)));

    await expect(baixarBinario('linux-x64')).rejects.toThrow(/502/);
  });
});

describe('configurarPastaAutomaticamente', () => {
  function stubAmbienteFeliz() {
    vi.stubGlobal('crypto', {
      subtle: {
        generateKey: vi.fn().mockResolvedValue(PAR_FAKE),
        exportKey: vi.fn().mockResolvedValue({ kty: 'OKP' }),
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse(200)));

    const write = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const createWritable = vi.fn().mockResolvedValue({ write, close });
    const getFileHandle = vi.fn().mockResolvedValue({ createWritable });
    // `name` é o que a File System Access API expõe da pasta escolhida — o
    // caminho absoluto ela NUNCA dá, e é o runner quem o reporta depois.
    const showDirectoryPicker = vi.fn().mockResolvedValue({ name: 'minha-pasta', getFileHandle });
    vi.stubGlobal('window', { showDirectoryPicker });

    return { showDirectoryPicker, getFileHandle, createWritable, write, close };
  }

  it('caminho feliz: registra a chave, baixa o binário, grava os três arquivos e devolve a instrução final (Linux)', async () => {
    const { getFileHandle, write } = stubAmbienteFeliz();

    const resultado = await configurarPastaAutomaticamente({
      projectId: 'proj-1',
      apiUrl: 'https://api.brabo.example',
      platform: 'linux-x64',
    });

    expect(registerRunnerDeviceKeyMock).toHaveBeenCalledWith(
      'proj-1',
      expect.objectContaining({ publicKeyJwk: expect.any(String) }),
    );
    expect(getFileHandle).toHaveBeenCalledWith('brabo-runner', { create: true });
    expect(getFileHandle).toHaveBeenCalledWith('brabo-runner.config.json', { create: true });
    expect(getFileHandle).toHaveBeenCalledWith('brabo-runner-device-key.jwk.json', { create: true });
    expect(write).toHaveBeenCalledTimes(3);
    expect(resultado.instrucaoFinal).toBe('chmod +x ./brabo-runner && ./brabo-runner');
    expect(resultado.falhaDoBinario).toBeNull();
    expect(resultado.pasta).toBe('minha-pasta');
  });

  it('Windows: usa o nome .exe e a instrução final sem chmod', async () => {
    const { getFileHandle } = stubAmbienteFeliz();

    const resultado = await configurarPastaAutomaticamente({
      projectId: 'proj-1',
      apiUrl: 'https://api.brabo.example',
      platform: 'win32-x64',
    });

    expect(getFileHandle).toHaveBeenCalledWith('brabo-runner.exe', { create: true });
    expect(resultado.instrucaoFinal).toBe('.\\brabo-runner.exe');
  });

  it('falha (ex.: geração de chave rejeitada) propaga o erro sem registrar chave nenhuma — depois de a pasta já ter sido escolhida', async () => {
    const { showDirectoryPicker } = stubAmbienteFeliz();
    vi.stubGlobal('crypto', {
      subtle: { generateKey: vi.fn().mockRejectedValue(new Error('sem suporte')) },
    });

    await expect(
      configurarPastaAutomaticamente({
        projectId: 'proj-1',
        apiUrl: 'https://api.brabo.example',
        platform: 'linux-x64',
      }),
    ).rejects.toThrow(/não suporta/i);

    // A asserção anterior desta prova era `showDirectoryPicker` NÃO ter sido
    // chamado — ela encodava a ordem ANTIGA (o seletor por último). Com a
    // RN-473 a pasta é o primeiro passo, então o que se prova aqui é o outro
    // lado: falhar depois do seletor não registra chave de dispositivo.
    expect(showDirectoryPicker).toHaveBeenCalledTimes(1);
    expect(registerRunnerDeviceKeyMock).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------ a ordem (RN-473)

  it('A PASTA É O PRIMEIRO PASSO: `showDirectoryPicker` abre antes da chave, do registro e do binário', async () => {
    const ordem: string[] = [];
    const { showDirectoryPicker } = stubAmbienteFeliz();
    showDirectoryPicker.mockImplementation(() => {
      ordem.push('pasta');
      return Promise.resolve({
        name: 'minha-pasta',
        getFileHandle: vi.fn().mockResolvedValue({
          createWritable: vi
            .fn()
            .mockResolvedValue({ write: vi.fn(), close: vi.fn() }),
        }),
      });
    });
    vi.stubGlobal('crypto', {
      subtle: {
        generateKey: vi.fn().mockImplementation(() => {
          ordem.push('chave');
          return Promise.resolve(PAR_FAKE);
        }),
        exportKey: vi.fn().mockResolvedValue({ kty: 'OKP' }),
      },
    });
    registerRunnerDeviceKeyMock.mockImplementation(() => {
      ordem.push('registro');
      return Promise.resolve({ id: 'device-1' });
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        ordem.push('binario');
        return Promise.resolve(fakeResponse(200));
      }),
    );

    await configurarPastaAutomaticamente({
      projectId: 'proj-1',
      apiUrl: 'https://api.brabo.example',
      platform: 'linux-x64',
    });

    expect(ordem).toEqual(['pasta', 'chave', 'registro', 'binario']);
  });

  it('cancelar o seletor de pasta não registra chave nem baixa binário nenhum', async () => {
    stubAmbienteFeliz();
    const cancelamento = new Error('The user aborted a request.');
    cancelamento.name = 'AbortError';
    const showDirectoryPicker = vi.fn().mockRejectedValue(cancelamento);
    vi.stubGlobal('window', { showDirectoryPicker });
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(200));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      configurarPastaAutomaticamente({
        projectId: 'proj-1',
        apiUrl: 'https://api.brabo.example',
        platform: 'linux-x64',
      }),
    ).rejects.toThrow(/aborted/i);

    expect(registerRunnerDeviceKeyMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ------------------------------- a degradação do binário (RN-473, o pedido)

  it('binário 502: NÃO derruba o fluxo — grava os outros dois arquivos e devolve o comando alternativo', async () => {
    const { getFileHandle, write } = stubAmbienteFeliz();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse(502, null)));

    const resultado = await configurarPastaAutomaticamente({
      projectId: 'proj-1',
      apiUrl: 'https://api.brabo.example',
      platform: 'linux-x64',
    });

    // A escolha da pasta e a configuração sobrevivem: os DOIS arquivos que o
    // runner precisa (RN-466) estão lá, e só o executável ficou de fora.
    expect(getFileHandle).toHaveBeenCalledWith('brabo-runner.config.json', { create: true });
    expect(getFileHandle).toHaveBeenCalledWith('brabo-runner-device-key.jwk.json', { create: true });
    expect(getFileHandle).not.toHaveBeenCalledWith('brabo-runner', { create: true });
    expect(write).toHaveBeenCalledTimes(2);

    expect(registerRunnerDeviceKeyMock).toHaveBeenCalledTimes(1);
    expect(resultado.pasta).toBe('minha-pasta');
    expect(resultado.falhaDoBinario).toMatch(/502/);
    expect(resultado.instrucaoFinal).toBe(COMANDO_VIA_NPM);
  });

  it('falha ao GRAVAR o binário (disco cheio) degrada igual — a configuração fica de pé', async () => {
    const { getFileHandle } = stubAmbienteFeliz();
    getFileHandle.mockImplementation((nome: string) => {
      if (nome === 'brabo-runner') return Promise.reject(new Error('disco cheio'));
      return Promise.resolve({
        createWritable: vi.fn().mockResolvedValue({ write: vi.fn(), close: vi.fn() }),
      });
    });

    const resultado = await configurarPastaAutomaticamente({
      projectId: 'proj-1',
      apiUrl: 'https://api.brabo.example',
      platform: 'linux-x64',
    });

    expect(resultado.falhaDoBinario).toBe('disco cheio');
    expect(resultado.instrucaoFinal).toBe(COMANDO_VIA_NPM);
  });
});

describe('baixarKitManual', () => {
  function stubDownloads() {
    vi.stubGlobal('crypto', {
      subtle: {
        generateKey: vi.fn().mockResolvedValue(PAR_FAKE),
        exportKey: vi.fn().mockResolvedValue({ kty: 'OKP' }),
      },
    });

    const createObjectURL = vi.fn().mockReturnValue('blob:fake');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

    const click = vi.fn();
    const anchor = { click, remove: vi.fn(), href: '', download: '' };
    const createElementSpy = vi
      .spyOn(document, 'createElement')
      .mockReturnValue(anchor as unknown as HTMLAnchorElement);
    const appendChildSpy = vi.spyOn(document.body, 'appendChild').mockImplementation((n) => n);

    return { click, createObjectURL, revokeObjectURL, anchor, createElementSpy, appendChildSpy };
  }

  it('dispara dois downloads (kit + binário) via link temporário, sem chamar showDirectoryPicker', async () => {
    const { click, createObjectURL, revokeObjectURL, createElementSpy, appendChildSpy } =
      stubDownloads();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse(200)));

    const resultado = await baixarKitManual({
      projectId: 'proj-1',
      apiUrl: 'https://api.brabo.example',
      platform: 'darwin-arm64',
    });

    expect(registerRunnerDeviceKeyMock).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(2);
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(resultado.falhaDoBinario).toBeNull();
    expect(resultado.instrucaoFinal).toBe('chmod +x ./brabo-runner && ./brabo-runner');

    createElementSpy.mockRestore();
    appendChildSpy.mockRestore();
  });

  it('binário 502 no fallback: o KIT ainda é baixado, e a instrução vira o caminho alternativo', async () => {
    const { click, anchor, createElementSpy, appendChildSpy } = stubDownloads();
    // O nome do último `download` atribuído prova QUAL arquivo saiu.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse(502, null)));

    const resultado = await baixarKitManual({
      projectId: 'proj-1',
      apiUrl: 'https://api.brabo.example',
      platform: 'darwin-arm64',
    });

    expect(registerRunnerDeviceKeyMock).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(anchor.download).toBe('brabo-runner-kit.json');
    expect(resultado.falhaDoBinario).toMatch(/502/);
    expect(resultado.instrucaoFinal).toBe(COMANDO_VIA_NPM);

    createElementSpy.mockRestore();
    appendChildSpy.mockRestore();
  });
});
