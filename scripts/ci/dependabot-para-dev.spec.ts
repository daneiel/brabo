import { describe, expect, it } from 'vitest';
import {
  compararVersoes,
  decidir,
  diretorioDoManifesto,
  extrairAtualizacoes,
  limiar,
  manifestoDoDiretorio,
  versoesResolvidas,
  type Alerta,
} from './dependabot-para-dev.ts';

/**
 * A regra: PR do Dependabot contra `main` é FECHADO só quando a `dev` já
 * resolve toda dependência dele em versão >= o limiar (a primeira corrigida
 * do alerta, ou o destino do PR sem alerta); qualquer outra
 * coisa — inclusive a dúvida — é REDIRECIONADA para a `dev`.
 */

// Recorte do corpo real do #553 (security update, fechado à mão em 13/09).
const CORPO_553 = `Bumps the npm_and_yarn group with 1 update in the / directory: [nodemailer](https://github.com/nodemailer/nodemailer).

Updates \`nodemailer\` from 9.0.5 to 9.1.1
<details>
<summary>Release notes</summary>
...
</details>

Updates \`@vitest/mocker\` from 4.1.10 to 5.0.0
<details>`;

const alerta = (nome: string, corrigida: string | null, manifesto = 'pnpm-lock.yaml'): Alerta => ({
  dependency: { package: { name: nome }, manifest_path: manifesto },
  security_vulnerability: {
    first_patched_version: corrigida === null ? null : { identifier: corrigida },
  },
});

// Os alertas abertos em 13/09 para os dois pacotes do #553 (#52..#55).
const ALERTAS_553: Alerta[] = [
  alerta('nodemailer', '9.1.0'),
  alerta('nodemailer', '9.1.0'),
  alerta('nodemailer', '9.1.1'),
  alerta('@vitest/mocker', '4.1.11'),
];

const LOCK = `lockfileVersion: '9.0'

importers:

  apps/api:
    dependencies:
      nodemailer:
        specifier: ^9.1.0
        version: 9.1.1

packages:

  '@types/nodemailer@8.0.1':
    resolution: {integrity: sha512-x}

  nodemailer@9.1.1:
    resolution: {integrity: sha512-y}

  qs@6.14.1:
    resolution: {integrity: sha512-z}

  qs@6.15.0:
    resolution: {integrity: sha512-w}

snapshots:

  '@types/nodemailer@8.0.1':
    dependencies:
      '@types/node': 26.1.1

  nodemailer@9.1.1: {}

  '@vitest/mocker@4.1.11(vite@7.0.0)': {}

  qs@6.14.1: {}

  qs@6.15.0(side-channel@1.1.0): {}
`;

describe('extrairAtualizacoes', () => {
  it('lê as DUAS linhas "Updates `pkg` from X to Y" do corpo real do #553', () => {
    expect(extrairAtualizacoes(CORPO_553)).toEqual([
      { nome: 'nodemailer', de: '9.0.5', para: '9.1.1' },
      { nome: '@vitest/mocker', de: '4.1.10', para: '5.0.0' },
    ]);
  });

  it('lê todas as atualizações de um PR de grupo, inclusive pacote com escopo', () => {
    const corpo = `Updates \`qs\` from 6.14.0 to 6.14.1
...
Updates \`@types/nodemailer\` from 8.0.0 to 8.0.1.`;
    expect(extrairAtualizacoes(corpo)).toEqual([
      { nome: 'qs', de: '6.14.0', para: '6.14.1' },
      { nome: '@types/nodemailer', de: '8.0.0', para: '8.0.1' },
    ]);
  });

  it('corpo sem a frase não inventa atualização', () => {
    expect(extrairAtualizacoes('Bumps something.')).toEqual([]);
  });
});

describe('diretorioDoManifesto', () => {
  it('lê o diretório da frase do Dependabot', () => {
    expect(diretorioDoManifesto('1 update in the /website directory: [x]')).toBe('/website');
    expect(diretorioDoManifesto(CORPO_553)).toBe('/');
  });

  it('sem a frase, cai na raiz', () => {
    expect(diretorioDoManifesto('nada aqui')).toBe('/');
  });
});

describe('versoesResolvidas', () => {
  it('acha a versão em packages e snapshots, sem confundir com pacote de escopo de mesmo sufixo', () => {
    expect(versoesResolvidas(LOCK, 'nodemailer')).toEqual(['9.1.1']);
    expect(versoesResolvidas(LOCK, '@types/nodemailer')).toEqual(['8.0.1']);
  });

  it('devolve TODAS as versões quando o pacote resolve em mais de uma, ignorando sufixo de peer', () => {
    expect(versoesResolvidas(LOCK, 'qs').sort()).toEqual(['6.14.1', '6.15.0']);
  });

  it('não lê o bloco importers como resolução', () => {
    expect(versoesResolvidas(LOCK, 'specifier')).toEqual([]);
  });
});

describe('compararVersoes', () => {
  it('compara numericamente, não como texto', () => {
    expect(compararVersoes('9.10.0', '9.9.0')).toBeGreaterThan(0);
    expect(compararVersoes('9.1.1', '9.1.1')).toBe(0);
  });

  it('pré-release vem antes da final', () => {
    expect(compararVersoes('1.0.0-rc.1', '1.0.0')).toBeLessThan(0);
  });

  it('versão não-semver não se compara', () => {
    expect(compararVersoes('link:../x', '1.0.0')).toBeNull();
  });
});

describe('manifestoDoDiretorio', () => {
  it('traduz o diretório do corpo para o manifest_path dos alertas', () => {
    expect(manifestoDoDiretorio('/')).toBe('pnpm-lock.yaml');
    expect(manifestoDoDiretorio('/website')).toBe('website/pnpm-lock.yaml');
  });
});

describe('limiar', () => {
  const mocker = { nome: '@vitest/mocker', de: '4.1.10', para: '5.0.0' };

  it('é a primeira versão CORRIGIDA do alerta, não a mais nova que o PR propõe', () => {
    expect(limiar(mocker, ALERTAS_553, 'pnpm-lock.yaml')).toBe('4.1.11');
  });

  it('com vários alertas do pacote, é a MAIOR primeira-corrigida', () => {
    const nodemailer = { nome: 'nodemailer', de: '9.0.5', para: '9.1.1' };
    expect(limiar(nodemailer, ALERTAS_553, 'pnpm-lock.yaml')).toBe('9.1.1');
  });

  it('alerta de OUTRO lockfile não conta', () => {
    expect(limiar(mocker, [alerta('@vitest/mocker', '4.1.11', 'website/pnpm-lock.yaml')], 'pnpm-lock.yaml')).toBe('5.0.0');
  });

  it('sem alerta, ou alerta sem versão corrigida, é o destino do PR', () => {
    expect(limiar(mocker, [], 'pnpm-lock.yaml')).toBe('5.0.0');
    expect(limiar(mocker, [alerta('@vitest/mocker', null)], 'pnpm-lock.yaml')).toBe('5.0.0');
  });
});

describe('decidir', () => {
  it('FECHA o #553: com os alertas, a dev já resolve as duas correções', () => {
    const d = decidir(extrairAtualizacoes(CORPO_553), LOCK, ALERTAS_553);
    expect(d.decisao).toBe('fechar');
    expect(d.motivo).toContain('nodemailer');
    expect(d.motivo).toContain('@vitest/mocker');
  });

  it('sem os alertas, o MESMO #553 é REDIRECIONADO — o destino 5.0.0 é mais estrito', () => {
    const d = decidir(extrairAtualizacoes(CORPO_553), LOCK);
    expect(d.decisao).toBe('redirecionar');
    expect(d.motivo).toContain('@vitest/mocker@4.1.11');
  });

  it('REDIRECIONA quando QUALQUER versão resolvida está abaixo do destino', () => {
    // qs resolve em 6.14.1 E 6.15.0; o destino 6.15.0 deixa uma cópia vulnerável.
    const d = decidir([{ nome: 'qs', de: '6.14.0', para: '6.15.0' }], LOCK);
    expect(d.decisao).toBe('redirecionar');
    expect(d.motivo).toContain('qs@6.14.1');
  });

  it('REDIRECIONA quando uma do grupo está coberta e a outra não', () => {
    const d = decidir(
      [
        { nome: 'nodemailer', de: '9.0.5', para: '9.1.1' },
        { nome: 'nodemailer', de: '9.1.1', para: '9.2.0' },
      ],
      LOCK,
    );
    expect(d.decisao).toBe('redirecionar');
  });

  it('REDIRECIONA pacote ausente do lockfile da dev', () => {
    expect(decidir([{ nome: 'multer', de: '1.0.0', para: '2.0.0' }], LOCK).decisao).toBe(
      'redirecionar',
    );
  });

  it('na dúvida — nenhuma atualização reconhecida — REDIRECIONA, nunca fecha', () => {
    expect(decidir([], LOCK).decisao).toBe('redirecionar');
  });
});
