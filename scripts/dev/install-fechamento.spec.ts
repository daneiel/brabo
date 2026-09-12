import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// O FECHAMENTO da instalação (RN-547): a primeira conta, a chave desta máquina
// e o serviço do agente local. É o encadeamento de quatro peças que já existem
// testadas do outro lado — `POST /internal/first-account` (RN-546),
// `brabo-runner device-key create|finish` (RN-551),
// `POST /internal/machine-device-keys` (RN-552) e
// `brabo-runner service install --machine` (RN-545) —, e o que se testa aqui é
// o ENCADEAMENTO: quem chama quem, com o quê, e o que acontece quando um elo
// do meio recusa.
//
// Estas funções rodam DE VERDADE, no molde que a RN-542 estabeleceu em
// `install.spec.ts` (`comparar_versoes`, `campo_do_marcador`): o script inteiro
// é carregado com `source` — menos a última linha, a chamada de `main` — e a
// função é invocada por `bash`. Nunca uma reimplementação em TypeScript, que
// continuaria passando depois de o shell quebrar.
//
// A metade HTTP fala com um servidor `node:http` real, em porta efêmera. É a
// única forma de provar que o corpo chega, que o cabeçalho do service token
// chega, e que 201/409/400/500/sem-resposta produzem vereditos DIFERENTES — a
// distinção de que a idempotência inteira depende, porque é ela que faz "esta
// instalação já tem gente" não ser lida como "quebrou".
//
// O que estes testes NÃO cobrem, e é preciso dizer: a instalação de ponta a
// ponta numa máquina limpa — compose de pé, api de verdade, binário do runner
// de verdade, unit escrita e agente esperando o primeiro projeto — é o E2E da
// sessão seguinte da fase. Aqui o `brabo-runner` é um dublê de shell, e a api
// é um servidor de teste.

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(RAIZ, 'install.sh');
const fonte = () => fs.readFileSync(SCRIPT, 'utf8');

/**
 * O script sem a chamada final de `main`, para poder ser carregado por
 * `source`. Recortar só a última linha é o oposto de recortar uma função por
 * regex: tudo o que é exercitado — inclusive o `set -euo pipefail` do topo —
 * roda exatamente como roda na máquina de quem instala.
 */
function scriptCarregavel(): string {
  const texto = fonte();
  const corpo = texto.replace(/\nmain\s+"\$@"\s*$/, '\n');
  if (corpo === texto) throw new Error('não achei a chamada de main para recortar de install.sh');
  return corpo;
}

let carregavel: string | undefined;
let tmpCarregavel: string | undefined;
function caminhoCarregavel(): string {
  if (!carregavel) {
    tmpCarregavel = fs.mkdtempSync(path.join(os.tmpdir(), 'brabo-install-fn-'));
    carregavel = path.join(tmpCarregavel, 'install-sem-main.sh');
    fs.writeFileSync(carregavel, scriptCarregavel());
  }
  return carregavel;
}

afterAll(() => {
  if (tmpCarregavel) fs.rmSync(tmpCarregavel, { recursive: true, force: true });
});

interface Rodada {
  stdout: string;
  stderr: string;
  codigo: number;
}

/**
 * Roda comandos de shell com o `install.sh` já carregado.
 *
 * ASSÍNCRONA de propósito, e isso não é estilo: a api de mentira dos testes
 * abaixo roda NESTE processo, e `spawnSync` bloqueia o event loop — o servidor
 * nunca chegaria a aceitar a conexão, e o `curl` do script morreria no
 * `max-time` de 30s. Foi assim que a primeira versão destes testes travou.
 */
function rodar(
  comandos: string,
  opcoes: { env?: NodeJS.ProcessEnv; entrada?: string } = {},
): Promise<Rodada> {
  return new Promise((resolver) => {
    const processo = spawn('bash', ['-c', `source "${caminhoCarregavel()}"\n${comandos}`], {
      env: { ...process.env, NO_COLOR: '1', ...opcoes.env },
    });
    let stdout = '';
    let stderr = '';
    processo.stdout.setEncoding('utf8');
    processo.stderr.setEncoding('utf8');
    processo.stdout.on('data', (pedaco: string) => {
      stdout += pedaco;
    });
    processo.stderr.on('data', (pedaco: string) => {
      stderr += pedaco;
    });
    processo.on('close', (codigo) => resolver({ stdout, stderr, codigo: codigo ?? -1 }));
    processo.stdin.end(opcoes.entrada ?? '');
  });
}

/** Um executável de mentira no PATH, para exercitar o encadeamento de verdade. */
function comBinario(nome: string, corpo: string): { dir: string; caminho: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brabo-bin-'));
  const caminho = path.join(dir, nome);
  fs.writeFileSync(caminho, corpo);
  fs.chmodSync(caminho, 0o755);
  return { dir, caminho };
}

// ---------------------------------------------------------------------------

describe('install.sh — o plano do fechamento', () => {
  const plano = execFileSync('bash', [SCRIPT, '--print-plan'], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  })
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => {
      const [chave, valor, nota] = l.split('\t');
      return { chave, valor, nota };
    });
  const por = (chave: string) => plano.find((l) => l.chave === chave);

  // O consentimento é o ponto 3 do ADR 0155, e por isso a linha é `pergunta` e
  // não `faz`: não existe caminho em que uma conta nasça com senha escolhida
  // pelo script — nem gerada, nem default.
  it('a primeira conta é PERGUNTADA, nunca decidida', () => {
    expect(por('criar-primeira-conta')?.valor).toBe('pergunta');
  });

  // As três proibições próprias desta entrega, na mesma coluna `nunca` que já
  // guarda a base de projetos e a pasta de espelho.
  it.each(['gravar-senha', 'ligar-smtp', 'pedir-credencial-de-llm'])('%s é nunca', (chave) => {
    expect(por(chave)?.valor).toBe('nunca');
  });

  it.each(['registrar-chave-de-maquina', 'instalar-servico-do-agente'])(
    '%s já acontece',
    (chave) => {
      expect(por(chave)?.valor).toBe('faz');
    },
  );
});

describe('install.sh — a senha nunca entra em argv nem em disco', () => {
  // `/proc/<pid>/cmdline` é legível por qualquer usuário da máquina, então uma
  // senha em `--data` seria exposta a todo mundo durante a requisição. Ela vai
  // pelo STDIN do curl; o cabeçalho com o service token vai num arquivo de
  // configuração 600, que é apagado em seguida — e esse segredo já mora em
  // disco, no `.env`, com o mesmo modo.
  it('o corpo do POST vem do stdin, e o cabeçalho de um --config', () => {
    const texto = fonte();
    expect(texto).toContain("printf 'data-binary = \"@-\"\\n'");
    expect(texto).toMatch(/curl -K "\$cfg"/);
    expect(texto).toMatch(/chmod 600 "\$cfg"/);
    expect(texto).toMatch(/rm -f "\$cfg"/);
  });

  // A senha nunca é gravada: nem no `.env`, nem no marcador, nem em log. O
  // marcador ganha o E-MAIL, que identifica e não é segredo (ADR 0155,
  // Consequences).
  it('o marcador grava o e-mail do dono, e nada mais da conta', () => {
    const texto = fonte();
    expect(texto).toMatch(/"ownerEmail": "\$\(escapar_json "\$CONTA_EMAIL"\)"/);
    expect(texto).not.toMatch(/SENHA[A-Z_]*=.*>.*marcador/i);
    // O heredoc do `.env` lista chave por chave. Nenhuma delas carrega a senha
    // da conta — as variáveis dela (`SENHA_LIDA`, `CONTA_*`) não aparecem ali.
    // `NEO4J_PASSWORD` é outra coisa: um segredo GERADO pelo script, cujo lugar
    // é exatamente esse arquivo.
    const env = texto.match(/cat > "\$env_arquivo" <<ENV[\s\S]*?\nENV\n/)?.[0] ?? '';
    expect(env).toContain('NEO4J_PASSWORD=');
    expect(env).not.toMatch(/SENHA|CONTA_/);
  });

  it('o schema do marcador subiu junto com o campo', () => {
    // Um sobe sem o outro e um marcador novo passa por antigo — a mesma régua
    // que fez o schema ir a 2 quando ele ganhou a `versao`.
    expect(fonte()).toMatch(/^MARCADOR_SCHEMA=3$/m);
  });
});

describe('install.sh — o nome com que a máquina aparece na lista de chaves', () => {
  // O `name` é campo do REGISTRO e o CLI não o escolhe (RN-551 diz isso por
  // escrito): quem nomeia é quem registra, e é este script.
  async function nome(hostname: string | null): Promise<string> {
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'brabo-hostname-'));
    try {
      if (hostname !== null) {
        fs.writeFileSync(path.join(bin, 'hostname'), `#!/bin/sh\nprintf '%s\\n' "${hostname}"\n`);
        fs.chmodSync(path.join(bin, 'hostname'), 0o755);
      } else {
        for (const falho of ['hostname', 'uname']) {
          fs.writeFileSync(path.join(bin, falho), '#!/bin/sh\nexit 1\n');
          fs.chmodSync(path.join(bin, falho), 0o755);
        }
      }
      const saida = await rodar('nome_da_maquina', {
        env: { PATH: `${bin}:${process.env.PATH ?? ''}` },
      });
      return saida.stdout.trim();
    } finally {
      fs.rmSync(bin, { recursive: true, force: true });
    }
  }

  it('usa o hostname — é o nome que a pessoa já usa para falar das máquinas dela', async () => {
    expect(await nome('servidor-de-casa')).toBe('servidor-de-casa');
  });

  it('sem hostname nem uname, ainda devolve um nome — nunca vazio', async () => {
    // Vazio viraria `400` pelo `@MinLength(1)` do DTO, e a recusa chegaria
    // depois de a conta já existir.
    expect(await nome(null)).toBe('maquina-desta-instalacao');
  });

  it('corta em 80, que é o @MaxLength(80) do DTO', async () => {
    expect(await nome('x'.repeat(200))).toHaveLength(80);
  });
});

describe('install.sh — o que não pode entrar num corpo JSON', () => {
  it('escapa barra e aspa, a barra PRIMEIRO', async () => {
    // Na outra ordem, a barra escaparia a barra que a própria substituição
    // acabou de pôr, e a aspa fecharia a string no meio do valor.
    expect((await rodar(`escapar_json 'a"b\\c'`)).stdout).toBe('a\\"b\\\\c');
  });

  it('tabulação é RECUSADA, nunca removida em silêncio', async () => {
    // Remover mudaria a senha que a pessoa digitou, e a conta nasceria com uma
    // senha que ninguém conhece.
    const comTab = await rodar(`sem_controle "$(printf 'a\\tb')" && echo passou || echo recusou`);
    expect(comTab.stdout.trim()).toBe('recusou');
    const semTab = await rodar(`sem_controle 'ab' && echo passou || echo recusou`);
    expect(semTab.stdout.trim()).toBe('passou');
  });
});

describe('install.sh — as duas rotas internas, contra um servidor de verdade', () => {
  interface Recebido {
    caminho: string;
    corpo: string;
    token: string | undefined;
    tipo: string | undefined;
  }

  let servidor: Server;
  let base = '';
  const recebido: Recebido[] = [];
  let resposta = { codigo: 201, corpo: '{}' };

  beforeAll(async () => {
    servidor = createServer((req, res) => {
      let corpo = '';
      req.on('data', (pedaco) => {
        corpo += String(pedaco);
      });
      req.on('end', () => {
        recebido.push({
          caminho: req.url ?? '',
          corpo,
          token: req.headers['x-brabo-service-token'] as string | undefined,
          tipo: req.headers['content-type'],
        });
        res.writeHead(resposta.codigo, { 'content-type': 'application/json' });
        res.end(resposta.corpo);
      });
    });
    await new Promise<void>((resolver) => {
      servidor.listen(0, '127.0.0.1', resolver);
    });
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolver) => {
      servidor.close(() => resolver());
    });
  });

  function conta(codigo: number, corpoDaResposta: string, senha = 'uma frase longa e minha') {
    resposta = { codigo, corpo: corpoDaResposta };
    recebido.length = 0;
    return rodar(
      `criar_primeira_conta '${base}' 'voce@exemplo.dev' '${senha}' 'Fulana'\n` +
        `printf 'veredito=%s codigo=%s\\n' "$RESPOSTA_VEREDITO" "$RESPOSTA_CODIGO"`,
      { env: { BRABO_SERVICE_TOKEN: 'o-token-desta-instalacao' } },
    );
  }

  it('201 vira `criada`, e o corpo chega inteiro com a senha e o service token', async () => {
    const saida = await conta(201, '{"userId":"u1","email":"voce@exemplo.dev"}', 'a minha frase');
    expect(saida.stdout).toContain('veredito=ok codigo=201');

    const pedido = recebido.at(-1);
    expect(pedido?.caminho).toBe('/internal/first-account');
    expect(pedido?.token).toBe('o-token-desta-instalacao');
    expect(pedido?.tipo).toContain('application/json');
    expect(JSON.parse(pedido?.corpo ?? '{}')).toEqual({
      email: 'voce@exemplo.dev',
      senha: 'a minha frase',
      nome: 'Fulana',
    });
  });

  // A distinção de que a idempotência depende: `409` é o desfecho ESPERADO
  // numa instalação que já tem gente (segunda execução, ou migração cujo
  // restore trouxe os usuários), e não uma falha.
  it('409 vira `ja-tem-conta` e 500 vira `falhou` — nunca o mesmo veredito', async () => {
    expect((await conta(409, '{"message":"já há usuário"}')).stdout).toContain(
      'veredito=ja-tem-conta',
    );
    expect((await conta(500, '{"message":"boom"}')).stdout).toContain('veredito=falhou');
  });

  it('400 vira `recusada`, e o corpo da api fica disponível para quem digitou', async () => {
    const saida = await conta(400, '{"message":"a senha é curta demais"}');
    expect(saida.stdout).toContain('veredito=recusada codigo=400');
  });

  // `000` é o curl que NÃO falou com a api. Colapsá-lo com um código de
  // resposta faria "a api não subiu" ser lida como "a api recusou".
  it('sem ninguém atendendo, o código é 000 e o veredito é `falhou`', async () => {
    const saida = await rodar(
      `criar_primeira_conta 'http://127.0.0.1:1/x' 'a@b.dev' 'senha' ''\n` +
        `printf 'veredito=%s codigo=%s\\n' "$RESPOSTA_VEREDITO" "$RESPOSTA_CODIGO"`,
      { env: { BRABO_SERVICE_TOKEN: 'tok' } },
    );
    expect(saida.stdout).toContain('veredito=falhou codigo=000');
  });

  it('o nome é omitido do corpo quando ninguém digitou um', async () => {
    resposta = { codigo: 201, corpo: '{"userId":"u1"}' };
    recebido.length = 0;
    await rodar(`criar_primeira_conta '${base}' 'a@b.dev' 'senha' ''`, {
      env: { BRABO_SERVICE_TOKEN: 'tok' },
    });
    // Omitido, nunca `""`: o DTO tem `@IsOptional()`, e uma string vazia é um
    // nome — o fallback para a parte local do e-mail (RN-410) não aconteceria.
    expect(Object.keys(JSON.parse(recebido.at(-1)?.corpo ?? '{}'))).toEqual(['email', 'senha']);
  });

  it('a JWK pública viaja como STRING no campo publicKeyJwk, escapada', async () => {
    resposta = { codigo: 201, corpo: '{"id":"dk_1","userId":"u1"}' };
    recebido.length = 0;
    const jwk = '{"kty":"OKP","crv":"Ed25519","x":"abc"}';
    const saida = await rodar(
      `registrar_chave_de_maquina '${base}' 'servidor-de-casa' '${jwk}'\n` +
        `printf 'veredito=%s\\n' "$RESPOSTA_VEREDITO"\n` +
        `printf 'id=%s\\n' "$(campo_do_marcador id "$RESPOSTA_CORPO")"`,
      { env: { BRABO_SERVICE_TOKEN: 'tok' } },
    );
    expect(saida.stdout).toContain('veredito=ok');
    // O `id` é o que vira o `kid` (RN-475), e ele sai do corpo da resposta —
    // nunca derivado de outra coisa.
    expect(saida.stdout).toContain('id=dk_1');

    const pedido = recebido.at(-1);
    expect(pedido?.caminho).toBe('/internal/machine-device-keys');
    const corpo = JSON.parse(pedido?.corpo ?? '{}') as { name: string; publicKeyJwk: string };
    expect(corpo.name).toBe('servidor-de-casa');
    expect(JSON.parse(corpo.publicKeyJwk)).toEqual({ kty: 'OKP', crv: 'Ed25519', x: 'abc' });
  });

  // `409` desta rota NÃO diz o mesmo que na outra — aqui é "a instalação não
  // tem exatamente um usuário" (RN-552) —, e por isso tem veredito próprio.
  it('409 da chave é `sem-usuario-unico`, e não `ja-tem-conta`', async () => {
    resposta = { codigo: 409, corpo: '{"message":"sem usuário único"}' };
    const saida = await rodar(
      `registrar_chave_de_maquina '${base}' 'm' '{}'\nprintf '%s\\n' "$RESPOSTA_VEREDITO"`,
      { env: { BRABO_SERVICE_TOKEN: 'tok' } },
    );
    expect(saida.stdout.trim()).toBe('sem-usuario-unico');
  });

  // ---------------------------------------------------------------- perguntar

  // `ler_sem_eco` desiste do `stty` quando a entrada não é um terminal e lê do
  // pipe — que é o que permite exercitar o laço de perguntas aqui. Numa máquina
  // de verdade o `stty -echo` acontece; sem `stty` no PATH o passo é RECUSADO,
  // nunca degradado para perguntar com eco.
  function perguntar(entrada: string, codigo: number, corpoDaResposta: string) {
    resposta = { codigo, corpo: corpoDaResposta };
    recebido.length = 0;
    return rodar(
      `perguntar_e_criar_a_conta '${base}' && echo VEREDITO=ok || echo VEREDITO=parou\n` +
        `printf 'email=%s\\n' "$CONTA_EMAIL"\nprintf 'pendencias=%s\\n' "$PENDENCIAS"`,
      { env: { BRABO_SERVICE_TOKEN: 'tok' }, entrada },
    );
  }

  it('caminho feliz: consente, digita duas vezes a mesma senha, e a conta nasce', async () => {
    const saida = await perguntar(
      's\nvoce@exemplo.dev\numa frase minha\numa frase minha\nFulana\n',
      201,
      '{"userId":"u1"}',
    );
    expect(saida.stdout).toContain('VEREDITO=ok');
    expect(saida.stdout).toContain('email=voce@exemplo.dev');
    expect(saida.stdout).toContain('pendencias=');
    expect(saida.stdout).not.toMatch(/pendencias=./);
    expect(JSON.parse(recebido.at(-1)?.corpo ?? '{}')).toMatchObject({ senha: 'uma frase minha' });
  });

  it('senhas diferentes não chegam à api — a pergunta se repete', async () => {
    const saida = await perguntar(
      's\nvoce@exemplo.dev\numa\noutra\nvoce@exemplo.dev\nigual\nigual\n\n',
      201,
      '{"userId":"u1"}',
    );
    expect(saida.stdout).toContain('VEREDITO=ok');
    // Um POST só: a primeira tentativa morreu antes de sair da máquina.
    expect(recebido).toHaveLength(1);
    expect(JSON.parse(recebido[0].corpo)).toMatchObject({ senha: 'igual' });
  });

  it('a política de senha da api é recusa REPETÍVEL, e o teto vira pendência', async () => {
    // A recusa que mais acontece é a de senha, e ela só é conhecida depois do
    // POST. Abortar a instalação ali deixaria alguém com o compose de pé e a
    // segunda execução caindo no caminho de migração.
    const saida = await perguntar(
      's\na@b.dev\ncurta\ncurta\n\na@b.dev\ncurta\ncurta\n\na@b.dev\ncurta\ncurta\n\n',
      400,
      '{"message":"a senha é curta demais"}',
    );
    expect(saida.stdout).toContain('VEREDITO=parou');
    expect(recebido).toHaveLength(3);
    expect(saida.stdout).toMatch(/pendencias=a primeira conta: 3 tentativas recusadas/);
  });

  it('409 não é falha: o passo se cala e NÃO vira pendência', async () => {
    const saida = await perguntar('s\na@b.dev\nsenha\nsenha\n\n', 409, '{"message":"já há usuário"}');
    expect(saida.stdout).toContain('VEREDITO=parou');
    expect(saida.stdout).toContain('JÁ tem usuário');
    expect(saida.stdout).toContain('pendencias=');
    expect(saida.stdout).not.toMatch(/pendencias=./);
  });

  it('recusar a criação não deixa nada para trás, e diz como fazer depois', async () => {
    const saida = await perguntar('n\n', 201, '{}');
    expect(saida.stdout).toContain('VEREDITO=parou');
    expect(recebido).toHaveLength(0);
    expect(saida.stdout).toMatch(/pendencias=a primeira conta \(recusada aqui\)/);
  });
});

describe('install.sh — a chave desta máquina, e o serviço', () => {
  interface Recebido {
    corpo: string;
  }

  let servidor: Server;
  let base = '';
  const recebido: Recebido[] = [];
  let resposta = { codigo: 201, corpo: '{"id":"dk_1","userId":"u1"}' };

  beforeAll(async () => {
    servidor = createServer((req, res) => {
      let corpo = '';
      req.on('data', (pedaco) => {
        corpo += String(pedaco);
      });
      req.on('end', () => {
        recebido.push({ corpo });
        res.writeHead(resposta.codigo, { 'content-type': 'application/json' });
        res.end(resposta.corpo);
      });
    });
    await new Promise<void>((resolver) => {
      servidor.listen(0, '127.0.0.1', resolver);
    });
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolver) => {
      servidor.close(() => resolver());
    });
  });

  /**
   * Um `brabo-runner` de mentira que respeita o contrato de saída da RN-551 —
   * stdout com UM valor, stderr para humano — e registra em que ordem foi
   * chamado. É esse contrato que faz `$(brabo-runner device-key create)`
   * funcionar, e é ele que este dublê existe para exercitar.
   */
  function dubleDoRunner(opcoes: {
    pasta: string;
    chaveFalha?: boolean;
    servicoFalha?: boolean;
  }): { dir: string; caminho: string; trilha: string } {
    const trilha = path.join(opcoes.pasta, 'trilha.txt');
    const corpo = `#!/bin/sh
printf '%s\\n' "$*" >> '${trilha}'
case "$1 $2" in
  'device-key create')
    ${opcoes.chaveFalha ? "echo 'já existe uma chave' >&2; exit 2" : ''}
    echo 'gerado aqui' >&2
    printf '%s\\n' '{"kty":"OKP","crv":"Ed25519","x":"abc"}'
    ;;
  'device-key finish')
    printf '%s\\n' '${opcoes.pasta}/brabo-runner-device-key.jwk.json'
    ;;
  'service install')
    ${
      opcoes.servicoFalha
        ? `echo 'Há 1 unit(s) por PROJETO instalada(s) nesta máquina' >&2
    echo '  brabo-runner service uninstall --project p1' >&2
    exit 2`
        : "echo 'Unit escrita: ~/.config/systemd/user/brabo-runner.service'"
    }
    ;;
  *) echo "subcomando inesperado: $*" >&2; exit 9 ;;
esac
`;
    const bin = comBinario('brabo-runner', corpo);
    return { ...bin, trilha };
  }

  async function parear(opcoes: { chaveFalha?: boolean; servicoFalha?: boolean } = {}) {
    const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'brabo-cfg-'));
    const duble = dubleDoRunner({ pasta, ...opcoes });
    recebido.length = 0;
    const saida = await rodar(
      `RUNNER_BIN='${duble.caminho}'\nPASTA_DE_CONFIG='${pasta}'\n` +
        `parear_esta_maquina '${base}' && echo PAREOU=sim || echo PAREOU=nao\n` +
        `printf 'chave=%s\\n' "$CAMINHO_DA_CHAVE"\n` +
        `if [ -n "$CAMINHO_DA_CHAVE" ]; then subir_o_agente_como_servico '${base}' && echo SERVICO=sim || echo SERVICO=nao; fi\n` +
        `if [ -z "$PENDENCIAS" ]; then echo SEM-PENDENCIA; else printf 'PENDENCIA: %s' "$PENDENCIAS"; fi`,
      { env: { BRABO_SERVICE_TOKEN: 'tok' } },
    );
    const trilha = fs.existsSync(duble.trilha) ? fs.readFileSync(duble.trilha, 'utf8') : '';
    fs.rmSync(duble.dir, { recursive: true, force: true });
    fs.rmSync(pasta, { recursive: true, force: true });
    return { ...saida, trilha, pasta };
  }

  it('a ordem é create → registrar → finish → service install, e o id é o do registro', async () => {
    resposta = { codigo: 201, corpo: '{"id":"dk_registrada","userId":"u1"}' };
    const r = await parear();
    expect(r.stdout).toContain('PAREOU=sim');
    expect(r.stdout).toContain('SERVICO=sim');
    // O `--id` é o `id` que a api devolveu — a cadeia inteira só o REPASSA
    // (RN-475), e é isso que esta linha prova.
    expect(r.trilha.split('\n').filter(Boolean)).toEqual([
      'device-key create',
      'device-key finish --id dk_registrada',
      expect.stringContaining('service install --machine --dir'),
    ]);
    // A pública é o que sobe; o corpo nunca carrega a metade privada.
    const corpo = JSON.parse(recebido[0].corpo) as { publicKeyJwk: string };
    expect(JSON.parse(corpo.publicKeyJwk)).not.toHaveProperty('d');
    expect(r.stdout).toContain('SEM-PENDENCIA');
  });

  // A `--dir` do serviço sai do CAMINHO que o `finish` imprimiu, não de uma
  // segunda conta deste script sobre onde a pasta de configuração fica.
  it('o --dir do serviço é a pasta do arquivo que o finish escreveu', async () => {
    const r = await parear();
    expect(r.trilha).toContain(`service install --machine --dir ${r.pasta} --api-url ${base}`);
  });

  // A recusa que numa máquina de desenvolvedor é o caso COMUM, não a borda:
  // `install --machine` recusa com unit por projeto instalada (RN-545), e não
  // há `--force`. Ela tem de chegar a quem instalou com as PALAVRAS dela — é a
  // mensagem que nomeia o `uninstall` de cada unit encontrada.
  it('a recusa do service install é repassada inteira e vira pendência', async () => {
    const r = await parear({ servicoFalha: true });
    expect(r.stdout).toContain('PAREOU=sim');
    expect(r.stdout).toContain('SERVICO=nao');
    expect(r.stderr).toContain('Há 1 unit(s) por PROJETO instalada(s) nesta máquina');
    expect(r.stderr).toContain('brabo-runner service uninstall --project p1');
    // E a pendência carrega o comando exato para repetir depois — a chave JÁ
    // está registrada, então o passo que falta é só este.
    expect(r.stdout).toMatch(/PENDENCIA: o serviço do agente local:[\s\S]*service install --machine --dir/);
  });

  it('quando o registro falha, o .parcial FICA e é nomeado', async () => {
    // Apagá-lo destruiria a única metade privada de uma chave que pode já estar
    // pareada: um timeout depois de a api gravar é indistinguível de um antes.
    // Ele é inerte por construção — o runner não lê esse nome (RN-551).
    resposta = { codigo: 500, corpo: '{"message":"boom"}' };
    const r = await parear();
    expect(r.stdout).toContain('PAREOU=nao');
    expect(r.stdout).not.toContain('SERVICO=');
    expect(r.stderr).toContain('.parcial');
    expect(r.stderr).toContain('NÃO foi apagada');
    expect(r.stdout).toMatch(/PENDENCIA: a chave desta máquina: a api respondeu 500/);
  });

  it('se o create recusa, nada é registrado na api', async () => {
    resposta = { codigo: 201, corpo: '{"id":"x"}' };
    const r = await parear({ chaveFalha: true });
    expect(r.stdout).toContain('PAREOU=nao');
    expect(recebido).toHaveLength(0);
    expect(r.stdout).toMatch(/PENDENCIA: .*`brabo-runner device-key create` recusou/);
  });

  it('sem binário do agente, o fechamento diz isso e não chama nada', async () => {
    // A Release pode não publicar o binário desta plataforma — `RUNNER_BIN`
    // fica vazio, e o passo é relatado em vez de chamar um comando inexistente.
    const saida = await rodar(
      `RUNNER_BIN=''\nCONTA_EMAIL='a@b.dev'\n` +
        `perguntar_e_criar_a_conta() { return 0; }\n` +
        `fechar_a_instalacao '${base}'; echo SAIU=$?\nprintf '%s' "$PENDENCIAS"`,
      { env: { BRABO_SERVICE_TOKEN: 'tok' } },
    );
    // Nunca sai diferente de 0: o compose já está de pé, e derrubar a
    // instalação por causa do último passo trocaria meia instalação por nenhuma.
    expect(saida.stdout).toContain('SAIU=0');
    expect(saida.stdout).toContain('o binário do agente local não foi instalado');
  });
});
