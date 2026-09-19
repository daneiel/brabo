import { describe, expect, it } from 'vitest';
import {
  MARCA,
  analisarDiff,
  blocoDoBot,
  decidir,
  semBlocoDoBot,
  type Entrada,
} from './dependabot-justifica-pin.ts';

/**
 * A regra: o bot escreve `docs-not-needed:` no corpo SÓ quando o autor é o
 * Dependabot E o diff é só troca de pin (SHA + comentário de versão) de
 * `uses:`. Qualquer outra linha, ou outro autor, e nada é escrito.
 */

// Diff REAL do #578 (`gh pr diff 578`, 17/09): o que o docmap bloqueou.
const DIFF_578 = `diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
index bdb87224a..be3e51853 100644
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -863,7 +863,7 @@ jobs:
       # O que cada alvo constrói, com que cache e com que tag está no
       # docker-bake.hcl da raiz, que também é o que se roda na mão.
       - name: Build das quatro imagens (em paralelo)
-        uses: docker/bake-action@5be5f02ff8819ecd3092ea6b2e6261c31774f2b4  # v6
+        uses: docker/bake-action@d3418bd7d0e9324001bca92fa8ba175ea7e6dc9b  # v7.3.0
         with:
           files: docker-bake.hcl
           targets: default
diff --git a/.github/workflows/release.yml b/.github/workflows/release.yml
index 24d65405f..e48cfc2ca 100644
--- a/.github/workflows/release.yml
+++ b/.github/workflows/release.yml
@@ -288,7 +288,7 @@ jobs:

       - name: Build e publicação das imagens taggeadas
         id: bake
-        uses: docker/bake-action@5be5f02ff8819ecd3092ea6b2e6261c31774f2b4  # v6
+        uses: docker/bake-action@d3418bd7d0e9324001bca92fa8ba175ea7e6dc9b  # v7.3.0
         with:
           files: docker-bake.hcl
           targets: default
`;

// Diff REAL do #580: a forma `- uses:` de item de lista.
const DIFF_580 = `diff --git a/.github/workflows/release.yml b/.github/workflows/release.yml
index 1111111..2222222 100644
--- a/.github/workflows/release.yml
+++ b/.github/workflows/release.yml
@@ -232,7 +232,7 @@ jobs:
-      - uses: docker/setup-buildx-action@8d2750c68a42422c14e847fe6c8ac0403b4cbd6f  # v3
+      - uses: docker/setup-buildx-action@37fe631027851001ddb9b187196cc803df7f5f0e  # v4.3.0

       # As duas tags de cada imagem, calculadas num passo só porque agora são
`;

const DEPENDABOT = {
  head: 'dependabot/github_actions/dev/docker/bake-action-7.3.0',
  autor: 'dependabot[bot]',
  tipoDoAutor: 'Bot',
};

const CORPO = 'Bumps [docker/bake-action](https://github.com/docker/bake-action) from 6.10.0 to 7.3.0.\n</details>\n';

const entrada = (parcial: Partial<Entrada>): Entrada => ({ ...DEPENDABOT, diff: DIFF_578, corpo: CORPO, ...parcial });

describe('analisarDiff', () => {
  it('reconhece o diff do #578 como só troca de pin', () => {
    expect(analisarDiff(DIFF_578)).toEqual({
      puro: true,
      linhas: 2,
      arquivos: ['.github/workflows/ci.yml', '.github/workflows/release.yml'],
    });
  });

  it('reconhece a forma `- uses:` do #580', () => {
    expect(analisarDiff(DIFF_580)).toMatchObject({ puro: true, linhas: 1 });
  });

  it('pin + job novo no MESMO arquivo não é puro', () => {
    const diff = DIFF_578.replace(
      '         with:\n           files: docker-bake.hcl\n           targets: default\ndiff --git a/.github/workflows/release.yml',
      '         with:\n           files: docker-bake.hcl\n+  job-novo:\n+    runs-on: ubuntu-latest\n           targets: default\ndiff --git a/.github/workflows/release.yml',
    );
    expect(diff).not.toBe(DIFF_578);
    const analise = analisarDiff(diff);
    expect(analise.puro).toBe(false);
  });

  it('pin + `with:` trocado no mesmo trecho não é puro', () => {
    const diff = DIFF_580.replace(
      '+      - uses: docker/setup-buildx-action@37fe631027851001ddb9b187196cc803df7f5f0e  # v4.3.0\n',
      '+      - uses: docker/setup-buildx-action@37fe631027851001ddb9b187196cc803df7f5f0e  # v4.3.0\n+        with:\n+          driver: docker\n',
    );
    expect(analisarDiff(diff).puro).toBe(false);
  });

  it('gatilho alterado ao lado do pin não é puro', () => {
    const diff = `${DIFF_580}@@ -1,3 +1,3 @@
 on:
-  push:
+  pull_request_target:
`;
    expect(analisarDiff(diff).puro).toBe(false);
  });

  it('troca de action (não de pin) não é pura', () => {
    const diff = DIFF_580.replace(
      '+      - uses: docker/setup-buildx-action@',
      '+      - uses: evil/setup-buildx-action@',
    );
    expect(analisarDiff(diff)).toMatchObject({ puro: false });
  });

  it('pin que vira tag (referência mutável) não é puro', () => {
    const diff = DIFF_580.replace(
      '@37fe631027851001ddb9b187196cc803df7f5f0e  # v4.3.0',
      '@v4.3.0',
    );
    expect(analisarDiff(diff).puro).toBe(false);
  });

  it('comentário de versão com prosa depois não é puro', () => {
    const diff = DIFF_580.replace('# v4.3.0', '# v4.3.0 agora sem cache');
    expect(analisarDiff(diff).puro).toBe(false);
  });

  it('mudança de indentação do `uses:` não é pura', () => {
    const diff = DIFF_580.replace('+      - uses:', '+        - uses:');
    expect(analisarDiff(diff).puro).toBe(false);
  });

  it('bump de pnpm (package.json + lockfile) não é puro', () => {
    const diff = `diff --git a/apps/api/package.json b/apps/api/package.json
index 1..2 100644
--- a/apps/api/package.json
+++ b/apps/api/package.json
@@ -73,7 +73,7 @@
-    "nodemailer": "^9.0.5",
+    "nodemailer": "^9.1.1",
     "pg": "^8.22.0",
diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
index 3..4 100644
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -10,1 +10,1 @@
-  nodemailer: 9.0.5
+  nodemailer: 9.1.1
`;
    expect(analisarDiff(diff)).toEqual({
      puro: false,
      motivo: '`apps/api/package.json` não é workflow nem action',
    });
  });

  it('workflow NOVO não é puro, mesmo que só tenha `uses:`', () => {
    const diff = `diff --git a/.github/workflows/novo.yml b/.github/workflows/novo.yml
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/.github/workflows/novo.yml
@@ -0,0 +1,1 @@
+      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1  # v7.0.1
`;
    expect(analisarDiff(diff).puro).toBe(false);
  });

  it('pin junto com RENOMEAR o workflow não é puro', () => {
    const diff = DIFF_580.replace(
      'index 1111111..2222222 100644\n--- a/.github/workflows/release.yml\n',
      'similarity index 97%\nrename from .github/workflows/release.yml\nrename to .github/workflows/publicar.yml\nindex 1111111..2222222 100644\n--- a/.github/workflows/release.yml\n',
    ).replace('+++ b/.github/workflows/release.yml', '+++ b/.github/workflows/publicar.yml');
    expect(analisarDiff(diff)).toMatchObject({ puro: false });
  });

  it('pin junto com troca de MODO do arquivo não é puro', () => {
    const diff = DIFF_580.replace('index 1111111..2222222 100644\n', 'old mode 100644\nnew mode 100755\nindex 1111111..2222222\n');
    expect(analisarDiff(diff)).toMatchObject({ puro: false });
  });

  it('pin de composite action em `.github/actions/` é puro', () => {
    const diff = DIFF_580.replaceAll('.github/workflows/release.yml', '.github/actions/setup/action.yml');
    expect(analisarDiff(diff).puro).toBe(true);
  });

  it('diff vazio não é puro — não há o que justificar', () => {
    expect(analisarDiff('').puro).toBe(false);
  });
});

describe('decidir', () => {
  it('diff de pin puro, do Dependabot → escreve a justificativa marcada', () => {
    const decisao = decidir(entrada({}));
    expect(decisao.acao).toBe('escrever');
    if (decisao.acao !== 'escrever') return;
    expect(decisao.corpo.startsWith(CORPO.trimEnd())).toBe(true);
    expect(decisao.corpo).toContain(`${MARCA}\ndocs-not-needed: troca de pin de action pelo Dependabot`);
    // É exatamente o que o drift lê (scripts/docs/drift.mjs).
    expect(decisao.corpo.match(/^docs-not-needed:\s*(.+)$/m)?.[1]).toContain('2 linha(s)');
  });

  it('pin + job novo no mesmo arquivo → não escreve', () => {
    const diff = `${DIFF_580}@@ -300,2 +300,4 @@ jobs:
   fim:
+  job-novo:
+    runs-on: ubuntu-latest
`;
    expect(decidir(entrada({ diff })).acao).toBe('manter');
  });

  it('autor humano com o MESMO diff → não escreve', () => {
    expect(decidir(entrada({ autor: 'daneiel', tipoDoAutor: 'User' })).acao).toBe('manter');
  });

  it('humano que nomeia a branch `dependabot/…` → não escreve', () => {
    expect(decidir(entrada({ autor: 'daneiel', tipoDoAutor: 'User' }))).toEqual({
      acao: 'manter',
      motivo: 'o autor não é o Dependabot',
    });
  });

  it('login do Dependabot sem o prefixo de branch → não escreve', () => {
    expect(decidir(entrada({ head: 'chore/bump' })).acao).toBe('manter');
  });

  it('bump de pnpm do Dependabot → não escreve', () => {
    const diff = `diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
index 3..4 100644
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -10,1 +10,1 @@
-  nodemailer: 9.0.5
+  nodemailer: 9.1.1
`;
    expect(
      decidir(entrada({ head: 'dependabot/npm_and_yarn/npm_and_yarn-217f3864fb', diff })).acao,
    ).toBe('manter');
  });

  it('é idempotente: rodar de novo sobre o corpo escrito não muda nada', () => {
    const primeira = decidir(entrada({}));
    if (primeira.acao !== 'escrever') throw new Error('esperava escrever');
    expect(decidir(entrada({ corpo: primeira.corpo })).acao).toBe('manter');
  });

  it('push posterior que traz algo além do pin → REMOVE só a linha do bot', () => {
    const escrito = decidir(entrada({}));
    if (escrito.acao !== 'escrever') throw new Error('esperava escrever');
    const diff = `${DIFF_578}diff --git a/package.json b/package.json
index 1..2 100644
--- a/package.json
+++ b/package.json
@@ -1,1 +1,1 @@
-  "x": "1"
+  "x": "2"
`;
    const decisao = decidir(entrada({ corpo: escrito.corpo, diff }));
    expect(decisao.acao).toBe('remover');
    if (decisao.acao !== 'remover') return;
    expect(decisao.corpo).not.toContain('docs-not-needed:');
    expect(decisao.corpo).not.toContain(MARCA);
    expect(decisao.corpo).toBe(CORPO);
  });

  it('justificativa escrita por HUMANO nunca é tocada', () => {
    const corpo = `${CORPO}\ndocs-not-needed: escrevi eu\n`;
    expect(decidir(entrada({ corpo })).acao).toBe('manter');
    const naoPuro = decidir(entrada({ corpo, autor: 'daneiel', tipoDoAutor: 'User' }));
    expect(naoPuro.acao).toBe('manter');
  });

  it('remover preserva a linha do humano quando as duas coexistem', () => {
    const corpo = `${CORPO}\ndocs-not-needed: escrevi eu\n\n${blocoDoBot({ linhas: 1, arquivos: ['.github/workflows/ci.yml'] })}\n`;
    expect(semBlocoDoBot(corpo)).toContain('docs-not-needed: escrevi eu');
    expect(semBlocoDoBot(corpo)).not.toContain(MARCA);
  });
});
