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

    // Este dublê só sabia QUE um arquivo foi aberto, nunca o que foi escrito
    // NELE — `write` era um spy só, compartilhado pelos três arquivos, sem
    // vínculo com o nome. Foi essa lacuna que deixou passar uma chave de
    // dispositivo gravada sem `kid` (RN-475) com a suíte verde. `gravados`
    // amarra nome → conteúdo, delegando ao mesmo `write`/`createWritable` de
    // antes para as contagens já afirmadas continuarem valendo.
    const gravados: { nome: string; conteudo: unknown }[] = [];
    const getFileHandle = vi.fn((nome: string) =>
      Promise.resolve({
        createWritable: async () => {
          const writable = await createWritable();
          return {
            write: (conteudo: unknown) => {
              gravados.push({ nome, conteudo });
              return writable.write(conteudo);
            },
            close: writable.close,
          };
        },
      }),
    );
    // `name` é o que a File System Access API expõe da pasta escolhida — o
    // caminho absoluto ela NUNCA dá, e é o runner quem o reporta depois.
    const showDirectoryPicker = vi.fn().mockResolvedValue({ name: 'minha-pasta', getFileHandle });
    vi.stubGlobal('window', { showDirectoryPicker });

    return { showDirectoryPicker, getFileHandle, createWritable, write, close, gravados };
  }

  /** O conteúdo escrito no arquivo `nome` — falha alto se ele não foi escrito. */
  function conteudoDe(
    gravados: { nome: string; conteudo: unknown }[],
    nome: string,
  ): string {
    const registro = gravados.find((g) => g.nome === nome);
    if (!registro) {
      throw new Error(
        `nenhum conteúdo escrito em "${nome}" — escritos: ${gravados.map((g) => g.nome).join(', ') || '(nenhum)'}`,
      );
    }
    return String(registro.conteudo);
  }

  it('caminho feliz: registra a chave, baixa o binário, grava os três arquivos e devolve a instrução final (Linux)', async () => {
    const { getFileHandle, write, gravados } = stubAmbienteFeliz();

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

    // Abrir o arquivo não é gravar a chave certa (RN-475): a JWK privada tem
    // de sair com o `kid` do registro, senão o CLI a recusa sempre.
    expect(JSON.parse(conteudoDe(gravados, 'brabo-runner-device-key.jwk.json'))).toMatchObject({
      kid: 'device-1',
    });
    expect(JSON.parse(conteudoDe(gravados, 'brabo-runner.config.json'))).toEqual({
      projectId: 'proj-1',
      apiUrl: 'https://api.brabo.example',
    });

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

  // ------------------------------------- o comando diz ONDE rodar (RN-477)

  /**
   * A instrução final dizia "dentro da pasta escolhida, rode: …" sem nunca
   * dizer onde essa pasta fica — e não tinha como: a File System Access API
   * expõe só `dirHandle.name`, o basename. O caminho absoluto existe do outro
   * lado (o que a pessoa digitou ao criar o projeto), e é ele que entra aqui.
   */
  it('prefixa `cd <caminho>` quando a pasta escolhida é a do projeto', async () => {
    stubAmbienteFeliz();

    const resultado = await configurarPastaAutomaticamente({
      projectId: 'proj-1',
      apiUrl: 'https://api.brabo.example',
      platform: 'linux-x64',
      caminhoDoProjeto: '/home/alguem/dev/minha-pasta',
    });

    expect(resultado.instrucaoFinal).toBe(
      'cd /home/alguem/dev/minha-pasta && chmod +x ./brabo-runner && ./brabo-runner',
    );
  });

  /**
   * O basename é o ÚNICO vínculo verificável entre a pasta escolhida no
   * seletor e o caminho que o projeto declara — nada obriga a pessoa a
   * escolher a mesma. Quando eles divergem, o comando sai SEM `cd`: um `cd`
   * para a pasta errada seria a tela afirmando o que não sabe.
   */
  it('NÃO prefixa quando a pasta escolhida não é a do projeto', async () => {
    stubAmbienteFeliz();

    const resultado = await configurarPastaAutomaticamente({
      projectId: 'proj-1',
      apiUrl: 'https://api.brabo.example',
      platform: 'linux-x64',
      caminhoDoProjeto: '/home/alguem/dev/OUTRA-pasta',
    });

    expect(resultado.instrucaoFinal).toBe(
      'chmod +x ./brabo-runner && ./brabo-runner',
    );
  });

  it('sem caminho conhecido, a instrução fica exatamente como era', async () => {
    stubAmbienteFeliz();

    const resultado = await configurarPastaAutomaticamente({
      projectId: 'proj-1',
      apiUrl: 'https://api.brabo.example',
      platform: 'linux-x64',
    });

    expect(resultado.instrucaoFinal).toBe(
      'chmod +x ./brabo-runner && ./brabo-runner',
    );
  });

  it('caminho com espaço sai entre aspas, e barra final não atrapalha', async () => {
    stubAmbienteFeliz();

    const resultado = await configurarPastaAutomaticamente({
      projectId: 'proj-1',
      apiUrl: 'https://api.brabo.example',
      platform: 'linux-x64',
      caminhoDoProjeto: '/home/alguem/meus projetos/minha-pasta/',
    });

    expect(resultado.instrucaoFinal).toBe(
      'cd "/home/alguem/meus projetos/minha-pasta" && chmod +x ./brabo-runner && ./brabo-runner',
    );
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
    const { getFileHandle, write, gravados } = stubAmbienteFeliz();
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

    // E os dois arquivos que sobraram são ÚTEIS, não só presentes: sem o
    // `kid`, "a configuração sobreviveu" seria uma afirmação falsa (RN-475).
    expect(JSON.parse(conteudoDe(gravados, 'brabo-runner-device-key.jwk.json'))).toMatchObject({
      kid: 'device-1',
    });

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

  // ------------------------------------------- o `kid` da chave (RN-475)

  it('o `kid` gravado é o `id` que a api DEVOLVEU — não um valor fixo, nem derivado do projeto', async () => {
    const { gravados } = stubAmbienteFeliz();
    registerRunnerDeviceKeyMock.mockResolvedValue({
      id: 'outro-id-qualquer-7c3f',
      name: 'navegador',
      createdAt: '2026-08-30T00:00:00.000Z',
    });

    await configurarPastaAutomaticamente({
      projectId: 'proj-1',
      apiUrl: 'https://api.brabo.example',
      platform: 'linux-x64',
    });

    // Se alguém voltar a DESCARTAR o retorno de `registerRunnerDeviceKey`,
    // este `kid` some (ou congela) e esta asserção cai — que é exatamente o
    // defeito que passou despercebido enquanto o teste só afirmava que o
    // arquivo tinha sido ABERTO.
    expect(JSON.parse(conteudoDe(gravados, 'brabo-runner-device-key.jwk.json')).kid).toBe(
      'outro-id-qualquer-7c3f',
    );
  });

  it('a chave PÚBLICA registrada não leva `kid` — ele nasce do registro, não vai para ele', async () => {
    stubAmbienteFeliz();

    await configurarPastaAutomaticamente({
      projectId: 'proj-1',
      apiUrl: 'https://api.brabo.example',
      platform: 'linux-x64',
    });

    const [, corpo] = registerRunnerDeviceKeyMock.mock.calls[0] as [
      string,
      { publicKeyJwk: string },
    ];
    expect(JSON.parse(corpo.publicKeyJwk)).not.toHaveProperty('kid');
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

    // Mesma lacuna do dublê da pasta: os downloads eram CONTADOS, nunca
    // lidos. `Blob` vira um recorder para o conteúdo do kit poder ser
    // afirmado (RN-475) — determinístico, sem depender de `Blob.text()` do
    // jsdom.
    const baixados: unknown[] = [];
    vi.stubGlobal(
      'Blob',
      class {
        constructor(partes: unknown[]) {
          baixados.push(partes[0]);
        }
      },
    );

    const click = vi.fn();
    const anchor = { click, remove: vi.fn(), href: '', download: '' };
    const createElementSpy = vi
      .spyOn(document, 'createElement')
      .mockReturnValue(anchor as unknown as HTMLAnchorElement);
    const appendChildSpy = vi.spyOn(document.body, 'appendChild').mockImplementation((n) => n);

    return {
      click,
      createObjectURL,
      revokeObjectURL,
      anchor,
      createElementSpy,
      appendChildSpy,
      baixados,
    };
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

  // ------------------------------------------- o `kid` da chave (RN-475)

  it('o kit baixado leva a JWK privada JÁ com o `kid` do registro — o caminho manual tem o mesmo contrato', async () => {
    const { baixados, createElementSpy, appendChildSpy } = stubDownloads();
    registerRunnerDeviceKeyMock.mockResolvedValue({
      id: 'device-manual-9a1',
      name: 'navegador',
      createdAt: '2026-08-30T00:00:00.000Z',
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse(502, null)));

    await baixarKitManual({
      projectId: 'proj-1',
      apiUrl: 'https://api.brabo.example',
      platform: 'darwin-arm64',
    });

    // O kit é UM json com a privada embutida como string; quem separa os dois
    // arquivos é o usuário, à mão — e a JWK que ele move para a pasta precisa
    // já trazer o `kid`, pelo mesmo motivo do caminho automático.
    const kit = JSON.parse(String(baixados[0]));
    expect(kit).toMatchObject({ projectId: 'proj-1', apiUrl: 'https://api.brabo.example' });
    expect(JSON.parse(kit.privateKeyJwk).kid).toBe('device-manual-9a1');

    createElementSpy.mockRestore();
    appendChildSpy.mockRestore();
  });
});
