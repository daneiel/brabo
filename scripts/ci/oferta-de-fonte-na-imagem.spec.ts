import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { describe, expect, it } from 'vitest';
import { ALVOS } from './images-manifest.ts';
import { ASSETS_DO_INSTALADOR, NOMES_QUE_A_RELEASE_JA_USA } from './assets-do-instalador.ts';

// A imagem do engine embute software sob GPL — `git`, `busybox`,
// `libgcc`/`libstdc++` e outras 18 apk, mais os quatro scanners que o engine
// invoca por `exec`. Executá-los como processo separado não contamina o Brabo,
// que segue MIT; DISTRIBUIR a imagem é outra coisa, e desde o ADR 0119 ela é
// publicada no GHCR a cada tag final.
//
// A oferta escrita de fonte é o `THIRD_PARTY_NOTICES.md`, e ela só cumpre o
// papel se viajar DENTRO do artefato: quem faz `docker pull` (ou baixa o
// binário do runner da Release) não tem o repositório, e uma oferta que só
// existe no GitHub não acompanha a cópia que a pessoa recebeu.
//
// A AT-020 a pôs na imagem do engine. A AT-120, por decisão do mantenedor
// (01/10), a estende a TODA imagem publicada e aos binários do runner, na MESMA
// forma — conservador: nenhum artefato é declarado dispensado.
//
// Este teste é ESTÁTICO. A prova contra a imagem CONSTRUÍDA é o passo "A
// oferta de fonte está dentro das cinco imagens" do `ci.yml` (`docker run …
// cat` + `cmp`); a da Release só uma tag real dá — o mesmo limite da
// assinatura (RN-524). O que se garante a cada PR é que ninguém remova um
// `COPY` nem tire o asset do manifesto sem que algo fique vermelho.
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ler = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8');

const DESTINO = '/usr/share/doc/brabo/THIRD_PARTY_NOTICES.md';
const COPIA =
  /^COPY --chown=root:root --chmod=0644 THIRD_PARTY_NOTICES\.md \\\n\s+\/usr\/share\/doc\/brabo\/THIRD_PARTY_NOTICES\.md$/m;

const PASTA = /^RUN install -d -m 0755 \/usr\/share\/doc\/brabo$/m;

/** `null` se o ESTÁGIO FINAL copia a oferta como root antes do `USER`; senão, o motivo. */
function problemaDaOferta(dockerfile: string): string | null {
  const froms = [...dockerfile.matchAll(/^FROM /gm)];
  const ultimo = froms.at(-1);
  if (ultimo?.index === undefined) return 'sem FROM';
  const estagioFinal = dockerfile.slice(ultimo.index);
  const copia = estagioFinal.search(COPIA);
  if (copia < 0) return `o estágio final não copia THIRD_PARTY_NOTICES.md para ${DESTINO} como root, 0644`;
  // O BuildKit aplica o `--chmod` às pastas que o `COPY` CRIA: sem a pasta
  // criada antes em 0755, ela nasce 0644 e o `USER` da imagem não a atravessa.
  const pasta = estagioFinal.search(PASTA);
  if (pasta < 0 || pasta > copia) return 'a pasta /usr/share/doc/brabo não é criada em 0755 ANTES do COPY';
  const user = estagioFinal.search(/^USER /m);
  if (user < 0) return 'o estágio final não tem USER';
  if (copia > user) return 'o COPY da oferta vem depois do USER';
  return null;
}

const pasta = 'RUN install -d -m 0755 /usr/share/doc/brabo\n';
const copia = `COPY --chown=root:root --chmod=0644 THIRD_PARTY_NOTICES.md \\\n     ${DESTINO}\n`;

describe('a oferta escrita de fonte viaja dentro de TODA imagem publicada', () => {
  it('a lista de imagens é a dos alvos publicados — imagem nova entra aqui sozinha', () => {
    expect([...ALVOS].sort()).toEqual(['api', 'backup', 'broker', 'engine', 'web']);
  });

  it.each([...ALVOS])('docker/%s/Dockerfile.prod copia a oferta, como root, ANTES do USER, no estágio final', (alvo) => {
    // Uma oferta de fonte que o próprio serviço pode sobrescrever não é oferta.
    // A ordem também importa por um motivo mecânico: depois do `USER` o `COPY`
    // nasceria com o dono errado. E num estágio de BUILD ela não chegaria à
    // imagem publicada.
    expect(problemaDaOferta(ler(`docker/${alvo}/Dockerfile.prod`))).toBeNull();
  });

  it.each([
    ['sem o COPY', 'FROM a AS b\nUSER x\n', 'não copia'],
    ['com o COPY depois do USER', `FROM a AS b\n${pasta}USER x\n${copia}`, 'depois do USER'],
    ['com o COPY só num estágio de build', `FROM a AS build\n${pasta}${copia}FROM c AS runtime\nUSER x\n`, 'não copia'],
    [
      'com o COPY sem o dono root',
      `FROM a AS b\n${pasta}COPY --chmod=0644 THIRD_PARTY_NOTICES.md \\\n     ${DESTINO}\nUSER x\n`,
      'não copia',
    ],
    ['sem criar a pasta antes (ela nasceria 0644)', `FROM a AS b\n${copia}USER x\n`, 'ANTES do COPY'],
    ['criando a pasta DEPOIS do COPY', `FROM a AS b\n${copia}${pasta}USER x\n`, 'ANTES do COPY'],
  ])('a régua reprova um Dockerfile %s', (_rotulo, dockerfile, trecho) => {
    expect(problemaDaOferta(dockerfile)).toContain(trecho);
  });

  it('o arquivo existe na raiz e não é bloqueado pelo .dockerignore', () => {
    // `COPY` de arquivo ausente falha o build, mas só na hora do build; e um
    // padrão novo no `.dockerignore` o tiraria do contexto sem erro nenhum
    // até lá.
    expect(ler('THIRD_PARTY_NOTICES.md').length).toBeGreaterThan(0);

    const ignore = ler('.dockerignore')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'));
    for (const padrao of ignore) {
      expect(padrao).not.toBe('THIRD_PARTY_NOTICES.md');
      expect(padrao).not.toBe('*.md');
      expect(padrao).not.toBe('**/*.md');
    }
  });

  it('o ci.yml prova a oferta dentro das cinco imagens construídas', () => {
    const workflow = YAML.parse(ler('.github/workflows/ci.yml')) as {
      jobs: Record<string, { steps?: Array<{ name?: string; run?: string }> }>;
    };
    const passo = Object.values(workflow.jobs)
      .flatMap((j) => j.steps ?? [])
      .find((p) => p.name === 'A oferta de fonte está dentro das cinco imagens')?.run;
    expect(passo).toBeDefined();
    for (const alvo of ALVOS) expect(passo).toContain(`brabo-${alvo}:prod`);
    expect(passo).toContain(DESTINO);
    expect(passo).toContain('cmp -s - THIRD_PARTY_NOTICES.md');
  });
});

describe('a oferta escrita de fonte viaja junto dos binários do runner', () => {
  const workflow = YAML.parse(ler('.github/workflows/build-runner-binaries.yml')) as {
    jobs: Record<string, { steps: Array<{ name?: string; run?: string }> }>;
  };
  const gerar =
    workflow.jobs.checksums?.steps.find((p) => p.name === 'Gerar, assinar e anexar o checksums.txt')?.run ?? '';

  it('vem do checkout da tag', () => {
    expect(gerar).toContain('cp "${GITHUB_WORKSPACE}/THIRD_PARTY_NOTICES.md" .');
  });

  it('entra no MESMO manifesto assinado dos binários, e é anexada com ele', () => {
    expect(gerar).toMatch(
      /sha256sum brabo-runner-\* install\.sh THIRD_PARTY_NOTICES\.md \$ASSETS_DO_INSTALADOR > checksums\.txt/,
    );
    expect(gerar).toMatch(
      /gh release upload "\$TAG" checksums\.txt checksums\.txt\.bundle install\.sh THIRD_PARTY_NOTICES\.md /,
    );
  });

  it('o nome é reservado — nenhum asset do instalador pode colidir com ele', () => {
    expect(NOMES_QUE_A_RELEASE_JA_USA).toContain('THIRD_PARTY_NOTICES.md');
    for (const { asset } of ASSETS_DO_INSTALADOR) expect(asset).not.toBe('THIRD_PARTY_NOTICES.md');
  });
});

describe('o NOTICES diz a verdade sobre onde ele viaja', () => {
  it('não afirma mais que nenhuma imagem é publicada', () => {
    // A frase original ("Hoje nenhuma imagem é publicada em registry... o que
    // segue é informativo") era verdadeira em 2026-07-27 e ficou para trás
    // quando o ADR 0119 passou a publicar. Um documento de conformidade que
    // afirma o contrário do que o repositório faz é pior que nenhum.
    const notices = ler('THIRD_PARTY_NOTICES.md');
    expect(notices).not.toMatch(/nenhuma imagem é publicada/i);
    expect(notices).toContain('ADR 0119');
  });

  it('cita o caminho dentro da imagem e o asset da Release', () => {
    const notices = ler('THIRD_PARTY_NOTICES.md');
    expect(notices).toContain(DESTINO);
    expect(notices).toContain('checksums.txt');
  });
});
