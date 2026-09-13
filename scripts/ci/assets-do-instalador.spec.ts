import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ASSETS_DO_INSTALADOR,
  PREFIXO_DOS_ASSETS,
  prepararAssets,
  problemasDoMapeamento,
} from './assets-do-instalador.ts';

/**
 * Os arquivos que o `install.sh` baixa para subir a instalação viram assets
 * da Release e entram no `checksums.txt` assinado (ADR 0160, RN-570).
 *
 * O defeito que isto fecha nasceu por ESQUECIMENTO, não por decisão: o
 * compose de instalação ganhou dois bind-mounts `./…` e ninguém se perguntou
 * como eles chegariam à máquina de quem instala. Por isso o teste que mais
 * vale aqui é o que DERIVA do compose — um bind-mount novo que não esteja na
 * tabela reprova, em vez de repetir o defeito na próxima instalação.
 *
 * Estático, com o limite de sempre (`checksums-nao-espera-a-matriz.spec.ts`):
 * a esteira só roda numa tag final. O que se garante a cada PR é que a tabela,
 * o `install.sh` e o workflow não divirjam.
 */

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ler = (relativo: string) => readFileSync(path.join(RAIZ, relativo), 'utf8');

describe('a tabela de assets', () => {
  it('não tem problema nenhum — prefixo, nome, colisão, caminho', () => {
    expect(problemasDoMapeamento(ASSETS_DO_INSTALADOR)).toEqual([]);
  });

  it('todo caminho da tabela existe no checkout — asset que não existe não é publicado', () => {
    for (const { caminho } of ASSETS_DO_INSTALADOR) {
      expect(existsSync(path.join(RAIZ, caminho)), caminho).toBe(true);
    }
  });

  it.each([
    ['sem o prefixo', { asset: 'init.sql', caminho: 'docker/postgres/init.sql', papel: '' }, 'começa com'],
    ['colidindo com o manifesto', { asset: 'checksums.txt', caminho: 'x', papel: '' }, 'começa com'],
    ['casando com o padrão dos binários', { asset: 'brabo-runner-compose.yml', caminho: 'x', papel: '' }, 'começa com'],
    ['com espaço no nome', { asset: 'brabo-install-a b', caminho: 'x', papel: '' }, '[a-z0-9.-]'],
    ['com caminho absoluto', { asset: 'brabo-install-a', caminho: '/etc/passwd', papel: '' }, "sem '..'"],
    ['com caminho que sobe', { asset: 'brabo-install-a', caminho: 'docker/../../x', papel: '' }, "sem '..'"],
  ])('reprova um asset %s', (_rotulo, asset, trecho) => {
    const problemas = problemasDoMapeamento([asset]);
    expect(problemas.join('\n')).toContain(trecho);
  });

  it('reprova dois assets com o mesmo nome, e dois para o mesmo caminho', () => {
    const a = { asset: 'brabo-install-a', caminho: 'docker/a', papel: '' };
    expect(problemasDoMapeamento([a, a]).join('\n')).toContain('asset repetido');
    expect(problemasDoMapeamento([a, { ...a, asset: 'brabo-install-b' }]).join('\n')).toContain(
      'dois assets para o mesmo caminho',
    );
  });
});

describe('o compose de instalação não monta nada que não viaje', () => {
  /** Toda fonte `./…` de volume, convertida para caminho a partir da raiz. */
  function bindMountsRelativos(): string[] {
    const compose = YAML.parse(ler('docker/docker-compose.install.yml')) as {
      services: Record<string, { volumes?: unknown[] }>;
    };
    const fontes: string[] = [];
    for (const servico of Object.values(compose.services)) {
      for (const volume of servico.volumes ?? []) {
        const fonte =
          typeof volume === 'string'
            ? volume.split(':')[0]
            : String((volume as { source?: string }).source ?? '');
        if (fonte?.startsWith('./') || fonte?.startsWith('../')) {
          fontes.push(path.posix.normalize(path.posix.join('docker', fonte)));
        }
      }
    }
    return fontes.sort();
  }

  it('acha os bind-mounts de hoje — um parser que não acha nada passaria verde', () => {
    expect(bindMountsRelativos()).toEqual(['docker/ollama/pull-models.sh', 'docker/postgres/init.sql']);
  });

  it('cada bind-mount relativo é um asset do instalador', () => {
    const caminhos = ASSETS_DO_INSTALADOR.map((a) => a.caminho);
    for (const fonte of bindMountsRelativos()) {
      expect(caminhos, `${fonte} é montado pelo compose e não viaja com o instalador`).toContain(fonte);
    }
  });

  it('o próprio compose é um asset', () => {
    expect(ASSETS_DO_INSTALADOR.map((a) => a.caminho)).toContain('docker/docker-compose.install.yml');
  });
});

describe('o `install.sh` baixa exatamente a mesma tabela', () => {
  const instalador = ler('install.sh');

  /** O `case` de `destino_do_asset_do_instalador`, como pares. */
  function tabelaDoShell(): Array<{ asset: string; caminho: string }> {
    const corpo = /destino_do_asset_do_instalador\(\) \{\n\s*case "\$1" in\n([\s\S]*?)\n\s*esac/.exec(instalador)?.[1];
    if (corpo === undefined) throw new Error('não achei o case de destino_do_asset_do_instalador em install.sh');
    return [...corpo.matchAll(/^\s*([a-z0-9.-]+)\)\s+echo '([^']+)' ;;$/gm)].map((m) => ({
      asset: m[1] ?? '',
      caminho: m[2] ?? '',
    }));
  }

  it('o `case` do shell é a tabela do TypeScript, par a par', () => {
    const doTs = ASSETS_DO_INSTALADOR.map(({ asset, caminho }) => ({ asset, caminho }));
    expect(tabelaDoShell()).toEqual(doTs);
  });

  it('a lista que o shell percorre é a mesma, na mesma ordem', () => {
    const lista = /^ASSETS_DO_INSTALADOR='([^']+)'$/m.exec(instalador)?.[1]?.split(' ');
    expect(lista).toEqual(ASSETS_DO_INSTALADOR.map((a) => a.asset));
  });

  it('não sobra caminho relativo de compose no instalador', () => {
    // Só linhas de CÓDIGO: os comentários contam a história do caminho
    // relativo, e é justamente a história que não pode sumir.
    const codigo = instalador
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('#'))
      .join('\n');
    expect(codigo).not.toContain("COMPOSE_DE_INSTALACAO='docker/");
    expect(codigo).not.toMatch(/bash docker\/backup\/test-restore-compose\.sh/);
    expect(codigo).toContain("COMPOSE_DE_INSTALACAO=''");
  });
});

describe('a esteira publica e assina os assets', () => {
  const workflow = YAML.parse(ler('.github/workflows/build-runner-binaries.yml')) as {
    jobs: Record<string, { steps: Array<{ name?: string; run?: string; uses?: string }> }>;
  };
  const checksums = workflow.jobs.checksums;
  const gerar = checksums?.steps.find((p) => p.name === 'Gerar, assinar e anexar o checksums.txt')?.run ?? '';

  it('prepara os assets pelo script, a partir do checkout da tag', () => {
    expect(gerar).toContain('scripts/ci/assets-do-instalador.ts" preparar "${GITHUB_WORKSPACE}"');
  });

  it('eles entram no MESMO `sha256sum` que gera o manifesto', () => {
    expect(gerar).toMatch(/sha256sum brabo-runner-\* install\.sh \$ASSETS_DO_INSTALADOR > checksums\.txt/);
  });

  it('o job confere cada linha do manifesto contra o arquivo, depois de verificar a assinatura e antes de anexar', () => {
    const verificouAssinatura = gerar.indexOf('cosign verify-blob');
    const conferiuLinhas = gerar.indexOf('sha256sum -c --strict checksums.txt');
    const anexou = gerar.indexOf('gh release upload');
    expect(verificouAssinatura).toBeGreaterThan(-1);
    expect(conferiuLinhas).toBeGreaterThan(verificouAssinatura);
    expect(anexou).toBeGreaterThan(conferiuLinhas);
  });

  it('eles são anexados à Release junto com o manifesto', () => {
    expect(gerar).toMatch(/gh release upload "\$TAG" checksums\.txt checksums\.txt\.bundle install\.sh \$ASSETS_DO_INSTALADOR --clobber/);
  });

  it('o job tem Node para rodar o `.ts`, pinado como o resto', () => {
    const setup = checksums?.steps.find((p) => p.uses?.startsWith('actions/setup-node@'));
    expect(setup?.uses).toMatch(/^actions\/setup-node@[0-9a-f]{40}$/);
  });

  it('o padrão que baixa os binários não alcança um asset do instalador', () => {
    expect(gerar).toContain("--pattern 'brabo-runner-*'");
    for (const { asset } of ASSETS_DO_INSTALADOR) expect(asset.startsWith('brabo-runner-')).toBe(false);
    expect(PREFIXO_DOS_ASSETS).toBe('brabo-install-');
  });
});

describe('prepararAssets', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'brabo-assets-'));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it('copia do checkout para o destino com o nome do asset, e devolve os nomes em ordem', () => {
    const destino = path.join(tmp, 'ok');
    const nomes = prepararAssets(RAIZ, destino);
    expect(nomes).toEqual(ASSETS_DO_INSTALADOR.map((a) => a.asset));
    for (const { asset, caminho } of ASSETS_DO_INSTALADOR) {
      expect(readFileSync(path.join(destino, asset), 'utf8')).toBe(ler(caminho));
    }
  });

  it('recusa nomeando o arquivo que falta no checkout', () => {
    const raiz = path.join(tmp, 'raiz-incompleta');
    mkdirSync(path.join(raiz, 'docker'), { recursive: true });
    writeFileSync(path.join(raiz, 'docker/docker-compose.install.yml'), 'services: {}\n');
    expect(() => prepararAssets(raiz, path.join(tmp, 'falha'))).toThrow(/docker\/postgres\/init\.sql não existe/);
  });

  it('recusa uma tabela inválida antes de copiar qualquer coisa', () => {
    const destino = path.join(tmp, 'invalida');
    expect(() =>
      prepararAssets(RAIZ, destino, [{ asset: 'install.sh', caminho: 'install.sh', papel: '' }]),
    ).toThrow(/tabela de assets inválida/);
    expect(existsSync(destino)).toBe(false);
  });
});
