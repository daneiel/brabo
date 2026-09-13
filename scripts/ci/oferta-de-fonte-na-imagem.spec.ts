import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// A imagem do engine embute software sob GPL — `git`, `busybox`,
// `libgcc`/`libstdc++` e outras 18 apk, mais os quatro scanners que o engine
// invoca por `exec`. Executá-los como processo separado não contamina o Brabo,
// que segue MIT; DISTRIBUIR a imagem é outra coisa, e desde o ADR 0119 ela é
// publicada no GHCR a cada tag final.
//
// A oferta escrita de fonte é o `THIRD_PARTY_NOTICES.md`, e ela só cumpre o
// papel se viajar DENTRO da imagem: quem faz `docker pull` não tem o
// repositório, e uma oferta que só existe no GitHub não acompanha a cópia que a
// pessoa recebeu.
//
// Este teste é ESTÁTICO de propósito. O que fecha o item de verdade é
// `docker run … cat /usr/share/doc/brabo/THIRD_PARTY_NOTICES.md` contra a
// imagem publicada, e isso exige uma tag real — o mesmo limite que a assinatura
// dos artefatos tem (RN-524). O que dá para garantir a cada PR é que ninguém
// remova o `COPY` sem que algo fique vermelho, e é isso que está aqui.
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ler = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8');

const DESTINO = '/usr/share/doc/brabo/THIRD_PARTY_NOTICES.md';

describe('a oferta escrita de fonte viaja dentro da imagem', () => {
  it('o Dockerfile de produção do engine copia o THIRD_PARTY_NOTICES.md', () => {
    const dockerfile = ler('docker/engine/Dockerfile.prod');
    expect(dockerfile).toContain('THIRD_PARTY_NOTICES.md');
    expect(dockerfile).toContain(DESTINO);
  });

  it('copia ANTES do USER, e como root — o processo não deve poder reescrevê-la', () => {
    // Uma oferta de fonte que o próprio serviço pode sobrescrever não é oferta.
    // A ordem também importa por um motivo mecânico: depois do `USER engine` o
    // `COPY` nasceria com o dono errado.
    const dockerfile = ler('docker/engine/Dockerfile.prod');
    const copia = dockerfile.indexOf('THIRD_PARTY_NOTICES.md');
    const user = dockerfile.indexOf('USER engine');
    expect(copia).toBeGreaterThan(-1);
    expect(user).toBeGreaterThan(-1);
    expect(copia).toBeLessThan(user);
    expect(dockerfile).toMatch(/--chown=root:root --chmod=0644 THIRD_PARTY_NOTICES\.md/);
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

  it('o NOTICES não afirma mais que nenhuma imagem é publicada', () => {
    // A frase original ("Hoje nenhuma imagem é publicada em registry... o que
    // segue é informativo") era verdadeira em 2026-07-27 e ficou para trás
    // quando o ADR 0119 passou a publicar. Um documento de conformidade que
    // afirma o contrário do que o repositório faz é pior que nenhum.
    const notices = ler('THIRD_PARTY_NOTICES.md');
    expect(notices).not.toMatch(/nenhuma imagem é publicada/i);
    expect(notices).toContain('ADR 0119');
  });
});
