import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CwdForaDaRaizError,
  DirForaDoHomeError,
  DirNaoEUmaPastaError,
  NaoConsegiuCriarDiretorioError,
  cwdParaContainer,
  garantirDiretorio,
  resolverDir,
  validarCwdDentroDaRaiz,
  validarDirDentroDoHomeNoLinux,
} from './guard.ts';

describe('validarCwdDentroDaRaiz', () => {
  let raiz: string;

  beforeEach(() => {
    raiz = mkdtempSync(join(tmpdir(), 'brabo-runner-guard-'));
    mkdirSync(join(raiz, 'sub'));
  });

  afterEach(() => {
    rmSync(raiz, { recursive: true, force: true });
  });

  it('aceita a própria raiz', () => {
    expect(validarCwdDentroDaRaiz(raiz, raiz)).toBe(raiz);
  });

  it('aceita um caminho dentro da raiz', () => {
    const alvo = join(raiz, 'sub');
    expect(validarCwdDentroDaRaiz(alvo, raiz)).toBe(alvo);
  });

  it('recusa caminho com ".." tentando escapar', () => {
    const alvo = join(raiz, '..', 'etc');
    expect(() => validarCwdDentroDaRaiz(alvo, raiz)).toThrow(CwdForaDaRaizError);
  });

  it('recusa caminho absoluto fora da raiz', () => {
    expect(() => validarCwdDentroDaRaiz('/etc', raiz)).toThrow(CwdForaDaRaizError);
  });

  it('recusa caminho relativo', () => {
    expect(() => validarCwdDentroDaRaiz('sub', raiz)).toThrow(CwdForaDaRaizError);
  });

  it('recusa caminho vazio', () => {
    expect(() => validarCwdDentroDaRaiz('', raiz)).toThrow(CwdForaDaRaizError);
  });

  it('recusa symlink dentro da raiz que aponta para fora dela', () => {
    const fora = mkdtempSync(join(tmpdir(), 'brabo-runner-fora-'));
    const link = join(raiz, 'escape');
    symlinkSync(fora, link);

    try {
      expect(() => validarCwdDentroDaRaiz(link, raiz)).toThrow(CwdForaDaRaizError);
    } finally {
      rmSync(fora, { recursive: true, force: true });
    }
  });
});

describe('validarDirDentroDoHomeNoLinux', () => {
  const home = '/home/usuaria';

  it('aceita o próprio home no Linux', () => {
    expect(() => validarDirDentroDoHomeNoLinux(home, 'linux', home)).not.toThrow();
  });

  it('aceita subpasta do home no Linux', () => {
    expect(() =>
      validarDirDentroDoHomeNoLinux(`${home}/exp001`, 'linux', home),
    ).not.toThrow();
  });

  it('recusa caminho fora do home no Linux', () => {
    expect(() => validarDirDentroDoHomeNoLinux('/etc', 'linux', home)).toThrow(
      DirForaDoHomeError,
    );
  });

  it('recusa outra conta dentro de /home no Linux', () => {
    expect(() =>
      validarDirDentroDoHomeNoLinux('/home/outrousuario', 'linux', home),
    ).toThrow(DirForaDoHomeError);
  });

  it('recusa caminho fora do home no Linux mesmo quando ele ainda NÃO existe no disco', () => {
    // RN-435: `garantirDiretorio` (que cria a pasta) só pode rodar DEPOIS
    // desta checagem — esta função nunca toca disco (só `resolve()`), então
    // um `--dir` inexistente e fora do $HOME continua recusado, e a criação
    // automática nunca chega a ser tentada fora do home.
    const foraDoHomeEInexistente = '/home/outra-conta-que-nao-existe/pasta-nova';
    expect(existsSync(foraDoHomeEInexistente)).toBe(false);
    expect(() =>
      validarDirDentroDoHomeNoLinux(foraDoHomeEInexistente, 'linux', home),
    ).toThrow(DirForaDoHomeError);
  });

  it('não aplica a restrição fora do Linux', () => {
    expect(() => validarDirDentroDoHomeNoLinux('/etc', 'darwin', home)).not.toThrow();
    expect(() => validarDirDentroDoHomeNoLinux('/etc', 'win32', home)).not.toThrow();
  });
});

describe('garantirDiretorio', () => {
  let base: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'brabo-runner-garantir-dir-'));
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it('não faz nada quando a pasta já existe', () => {
    expect(() => garantirDiretorio(base)).not.toThrow();
    expect(statSync(base).isDirectory()).toBe(true);
  });

  it('cria a pasta (recursivamente) quando ainda não existe', () => {
    const alvo = join(base, 'projeto-novo', 'sub');
    expect(existsSync(alvo)).toBe(false);

    expect(() => garantirDiretorio(alvo)).not.toThrow();

    expect(existsSync(alvo)).toBe(true);
    expect(statSync(alvo).isDirectory()).toBe(true);
  });

  it('recusa sem criar quando o caminho já existe e é um arquivo', () => {
    const arquivo = join(base, 'ja-existe.txt');
    writeFileSync(arquivo, 'conteúdo');

    expect(() => garantirDiretorio(arquivo)).toThrow(DirNaoEUmaPastaError);
    expect(statSync(arquivo).isFile()).toBe(true);
  });

  it('embrulha falha de mkdir em NaoConsegiuCriarDiretorioError', () => {
    // Um ancestral que é ARQUIVO (não pasta) faz `mkdirSync` recursivo
    // falhar (ENOTDIR) — forma portátil de simular falha de criação sem
    // depender de permissão de root/non-root do ambiente de CI.
    const arquivoNoMeio = join(base, 'nao-e-pasta.txt');
    writeFileSync(arquivoNoMeio, 'conteúdo');
    const alvo = join(arquivoNoMeio, 'sub');

    expect(() => garantirDiretorio(alvo)).toThrow(NaoConsegiuCriarDiretorioError);
  });
});

describe('resolverDir', () => {
  it('resolve relativo contra initCwd quando presente — o achado real', () => {
    // `pnpm --filter runner start -- --dir ../exp001`, rodado de
    // `~/dev/brabo`, rebaseia `process.cwd()` para `apps/runner`; sem
    // `INIT_CWD`, `../exp001` viraria `~/dev/brabo/apps/exp001`.
    expect(resolverDir('../exp001', '/home/user/dev/brabo', '/home/user/dev/brabo/apps/runner')).toBe(
      '/home/user/dev/exp001',
    );
  });

  it('cai no cwd do processo quando INIT_CWD está ausente', () => {
    // Binário standalone / `node dist/index.cjs` direto: não nasce de um
    // script do package.json, então não há INIT_CWD — e ali `process.cwd()`
    // já é a pasta certa.
    expect(resolverDir('exp001', undefined, '/home/user/dev')).toBe('/home/user/dev/exp001');
  });

  it('caminho já absoluto ignora as duas bases', () => {
    expect(resolverDir('/abs/pasta', '/qualquer', '/outro/qualquer')).toBe('/abs/pasta');
  });
});

describe('cwdParaContainer (ADR 0137)', () => {
  it('cwd igual à raiz vira o ponto de montagem, sem sobra', () => {
    expect(cwdParaContainer('/home/user/projetos/loja', '/home/user/projetos/loja', '/work')).toBe(
      '/work',
    );
  });

  it('cwd dentro da raiz vira /work + o que sobra, trocando só o prefixo', () => {
    expect(
      cwdParaContainer(
        '/home/user/projetos/loja',
        '/home/user/projetos/loja/src/api',
        '/work',
      ),
    ).toBe('/work/src/api');
  });

  it('não confunde raiz com prefixo textual parecido (ex.: "loja" vs "loja-2")', () => {
    // Sem o separador `/` na comparação, "loja" seria prefixo textual de
    // "loja-2" — mesmo cuidado de `dentroDoEscopo` acima.
    expect(cwdParaContainer('/home/user/projetos/loja', '/home/user/projetos/loja-2', '/work')).toBe(
      '/home/user/projetos/loja-2',
    );
  });

  it('cwd fora da raiz (não deveria acontecer) devolve como veio — defesa em profundidade', () => {
    expect(cwdParaContainer('/home/user/projetos/loja', '/etc/passwd', '/work')).toBe(
      '/etc/passwd',
    );
  });
});
