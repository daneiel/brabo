import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assinarTicketComChaveDeDispositivo } from './auth.ts';
import { pastaDeConfiguracaoDoBrabo } from './base.ts';
import {
  criarChaveDeDispositivo,
  finalizarChaveDeDispositivo,
  modoDoArquivo,
  rodarSubcomandoDeChave,
  SUFIXO_PARCIAL,
  type ContextoDaChave,
} from './criar-chave-de-dispositivo.ts';
import { estadoDaChaveDeDispositivo, lerChaveDeDispositivo, NOME_ARQUIVO_CHAVE } from './device-key.ts';

/**
 * Filesystem de VERDADE, numa pasta temporária dentro do `$HOME`. Os dois
 * motivos: o modo 600 é metade do que esta RN promete e um `fs` dublê não o
 * prova, e a RN-434 (reusada aqui) recusa pasta fora do `$HOME` no Linux — um
 * `tmpdir()` faria todo caso passar ou falhar pelo motivo errado, como o
 * docblock de `index.spec.ts` já registra.
 */
describe('device-key: o par nasce NESTA máquina (RN-551)', () => {
  let raiz: string;
  let ctx: ContextoDaChave;

  function contexto(argv: string[]): ContextoDaChave {
    return { ...ctx, argv: ['node', 'brabo-runner', ...argv] };
  }

  beforeEach(() => {
    raiz = mkdtempSync(join(homedir(), '.brabo-device-key-spec-'));
    ctx = {
      argv: [],
      cwd: raiz,
      home: homedir(),
      // A pasta padrão do comando sai daqui — o teste nunca escreve no
      // `~/.config/brabo` de quem roda a suíte.
      xdgConfigHome: join(raiz, 'config'),
      plataforma: process.platform,
    };
  });

  afterEach(() => {
    rmSync(raiz, { recursive: true, force: true });
  });

  it('caminho feliz: create imprime a PÚBLICA no stdout, finish carimba o kid — e a chave resultante ASSINA', async () => {
    const criacao = await criarChaveDeDispositivo(contexto(['device-key', 'create']));

    expect(criacao.codigo).toBe(0);
    const publica = JSON.parse(criacao.stdout ?? '') as Record<string, unknown>;
    // Exatamente a forma que a api valida no registro (`kty`/`crv`/`x`), e sem
    // o `d`: é a metade PÚBLICA que viaja, nunca a outra.
    expect(publica).toMatchObject({ kty: 'OKP', crv: 'Ed25519' });
    expect(typeof publica.x).toBe('string');
    expect(publica.d).toBeUndefined();
    // Uma linha só, sem espaço: é o que faz `PUB=$(...)` prestar.
    expect(criacao.stdout).not.toMatch(/\s/);

    const pasta = pastaDeConfiguracaoDoBrabo(ctx.home, ctx.xdgConfigHome);
    const final = join(pasta, NOME_ARQUIVO_CHAVE);
    const parcial = `${final}${SUFIXO_PARCIAL}`;

    // O nome que o runner LÊ ainda não existe — nunca existe pela metade.
    expect(existsSync(parcial)).toBe(true);
    expect(existsSync(final)).toBe(false);
    expect(estadoDaChaveDeDispositivo(pasta)).toBe('ausente');
    expect(modoDoArquivo(parcial)).toBe(0o600);

    const fim = finalizarChaveDeDispositivo(
      contexto(['device-key', 'finish', '--id', 'reg-123']),
    );

    expect(fim.codigo).toBe(0);
    expect(fim.stdout).toBe(final);
    expect(existsSync(parcial)).toBe(false);
    expect(modoDoArquivo(final)).toBe(0o600);

    // A ponta a ponta que importa: o arquivo é lido por quem sempre leu, o
    // `kid` é o id do REGISTRO, e a privada assina um JWT de ticket de verdade.
    const chave = lerChaveDeDispositivo(pasta);
    expect(chave?.deviceKeyId).toBe('reg-123');
    const jwt = await assinarTicketComChaveDeDispositivo(
      chave?.jwkPrivada ?? {},
      chave?.deviceKeyId ?? '',
      'proj-1',
    );
    const cabecalho = JSON.parse(
      Buffer.from(jwt.split('.')[0] as string, 'base64url').toString('utf-8'),
    ) as Record<string, unknown>;
    expect(cabecalho).toMatchObject({ alg: 'EdDSA', kid: 'reg-123' });
  });

  it('`--dir` manda a chave para a pasta pedida, e é ela que o runner lê de lá', async () => {
    const criacao = await criarChaveDeDispositivo(
      contexto(['device-key', 'create', '--dir', raiz]),
    );
    expect(criacao.codigo).toBe(0);

    const fim = finalizarChaveDeDispositivo(
      contexto(['device-key', 'finish', '--id', 'reg-9', '--dir', raiz]),
    );

    expect(fim.codigo).toBe(0);
    expect(lerChaveDeDispositivo(raiz)?.deviceKeyId).toBe('reg-9');
    // E a pasta padrão continua intocada — `--dir` não é um segundo destino
    // além do primeiro.
    expect(existsSync(join(pastaDeConfiguracaoDoBrabo(ctx.home, ctx.xdgConfigHome), NOME_ARQUIVO_CHAVE))).toBe(
      false,
    );
  });

  it('FALHA: `finish` sem `create` não inventa par nenhum — recusa NOMEANDO o passo que falta', () => {
    const fim = finalizarChaveDeDispositivo(
      contexto(['device-key', 'finish', '--id', 'reg-1', '--dir', raiz]),
    );

    expect(fim.codigo).toBe(2);
    expect(fim.stdout).toBeNull();
    expect(fim.linhas.join('\n')).toContain('device-key create');
    expect(existsSync(join(raiz, NOME_ARQUIVO_CHAVE))).toBe(false);
  });

  it('FALHA: `finish` sem `--id` diz que o kid É o id do servidor, em vez de inventar um local', async () => {
    await criarChaveDeDispositivo(contexto(['device-key', 'create', '--dir', raiz]));

    const fim = finalizarChaveDeDispositivo(contexto(['device-key', 'finish', '--dir', raiz]));

    expect(fim.codigo).toBe(2);
    expect(fim.linhas.join('\n')).toContain('--id');
    // O parcial continua lá: recusar não é desfazer o passo anterior.
    expect(existsSync(join(raiz, `${NOME_ARQUIVO_CHAVE}${SUFIXO_PARCIAL}`))).toBe(true);
  });

  it('FALHA: `--id` com espaço (a resposta inteira do POST colada) é recusado nomeando o conserto', async () => {
    await criarChaveDeDispositivo(contexto(['device-key', 'create', '--dir', raiz]));

    const fim = finalizarChaveDeDispositivo(
      contexto(['device-key', 'finish', '--dir', raiz, '--id', '{"id": "reg-1"}']),
    );

    expect(fim.codigo).toBe(2);
    expect(fim.linhas.join('\n')).toContain('jq -r .id');
  });

  it('FALHA: chave COMPLETA já no lugar não é sobrescrita por `create` nem por `finish`', async () => {
    await criarChaveDeDispositivo(contexto(['device-key', 'create', '--dir', raiz]));
    finalizarChaveDeDispositivo(contexto(['device-key', 'finish', '--id', 'reg-1', '--dir', raiz]));
    const antes = readFileSync(join(raiz, NOME_ARQUIVO_CHAVE), 'utf-8');

    const denovo = await criarChaveDeDispositivo(contexto(['device-key', 'create', '--dir', raiz]));
    expect(denovo.codigo).toBe(2);
    expect(denovo.linhas.join('\n')).toContain('revogue');

    await criarChaveDeDispositivo(contexto(['device-key', 'create', '--dir', join(raiz, 'outra')]));
    const parcialForjado = readFileSync(
      join(raiz, 'outra', `${NOME_ARQUIVO_CHAVE}${SUFIXO_PARCIAL}`),
      'utf-8',
    );
    writeFileSync(join(raiz, `${NOME_ARQUIVO_CHAVE}${SUFIXO_PARCIAL}`), parcialForjado);
    const fim = finalizarChaveDeDispositivo(
      contexto(['device-key', 'finish', '--id', 'reg-2', '--dir', raiz]),
    );
    expect(fim.codigo).toBe(2);

    expect(readFileSync(join(raiz, NOME_ARQUIVO_CHAVE), 'utf-8')).toBe(antes);
  });

  it('FALHA: um parcial que não é a JWK privada é recusado em vez de ganhar um kid', async () => {
    writeFileSync(join(raiz, `${NOME_ARQUIVO_CHAVE}${SUFIXO_PARCIAL}`), '{"oi": 1}');

    const fim = finalizarChaveDeDispositivo(
      contexto(['device-key', 'finish', '--id', 'reg-1', '--dir', raiz]),
    );

    expect(fim.codigo).toBe(2);
    expect(fim.linhas.join('\n')).toContain('Ed25519');
    expect(existsSync(join(raiz, NOME_ARQUIVO_CHAVE))).toBe(false);
  });

  it('subcomando desconhecido cai no bloco de uso, que explica os DOIS passos', async () => {
    const resposta = await rodarSubcomandoDeChave(contexto(['device-key', 'gerar']));

    expect(resposta.codigo).toBe(2);
    expect(resposta.stdout).toBeNull();
    expect(resposta.linhas.join('\n')).toContain('device-key create');
    expect(resposta.linhas.join('\n')).toContain('device-key finish');
  });

  it('sobrescrever um parcial abandonado DIZ que o registro anterior pode ter ficado órfão', async () => {
    await criarChaveDeDispositivo(contexto(['device-key', 'create', '--dir', raiz]));

    const denovo = await criarChaveDeDispositivo(contexto(['device-key', 'create', '--dir', raiz]));

    expect(denovo.codigo).toBe(0);
    expect(denovo.linhas.join('\n')).toContain('ÓRFÃO');
  });
});
