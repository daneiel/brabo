import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOME_ARQUIVO_CHAVE, NOME_ARQUIVO_CONFIG } from './device-key.ts';
import {
  ALVO_DE_MAQUINA,
  alvoDeProjeto,
  CODIGO_POR_ESTADO,
  consultarStatus,
  desinstalar,
  ehSubcomandoConhecido,
  instalar,
  projectIdValidoParaServico,
  status,
  type BaseParaServico,
  type ContextoDoServico,
  type ResultadoDeComando,
  type SistemaDeServico,
} from './servico.ts';

/**
 * ADR 0147 ponto 5 / RN-518 — `brabo-runner service install|uninstall|status`.
 *
 * NADA aqui toca o `systemd`/`launchd` da máquina que roda a suíte: disco e
 * execução de comando entram pela fronteira injetada (`SistemaDeServico`), do
 * mesmo jeito que `index-handlers.spec.ts` injeta a `DockerPort`. É o que
 * permite provar as QUATRO respostas de `status` — inclusive "não consegui
 * perguntar", que numa máquina real exigiria arrancar o `systemctl` do PATH.
 */

const PROJETO = '11111111-2222-3333-4444-555555555555';
const HOME = '/home/dev';
const PASTA = `${HOME}/projetos/meu-app`;

class SistemaFalso implements SistemaDeServico {
  arquivos = new Map<string, string>();
  pastasCriadas: string[] = [];
  comandos: string[] = [];
  /** Resposta por comando; o default é sucesso silencioso. */
  respostas = new Map<string, ResultadoDeComando>();

  lerArquivo(caminho: string): string | null {
    return this.arquivos.get(caminho) ?? null;
  }
  criarPasta(caminho: string): void {
    this.pastasCriadas.push(caminho);
  }
  escreverArquivo(caminho: string, conteudo: string): void {
    this.arquivos.set(caminho, conteudo);
  }
  apagarArquivo(caminho: string): boolean {
    return this.arquivos.delete(caminho);
  }
  existeArquivo(caminho: string): boolean {
    return this.arquivos.has(caminho);
  }
  listarPasta(caminho: string): string[] {
    // O mapa de arquivos É o disco falso: a pasta de um caminho é o `dirname`
    // dele, e ausência de pasta é lista vazia — como no adaptador real.
    return [...this.arquivos.keys()]
      .filter((arquivo) => dirname(arquivo) === caminho)
      .map((arquivo) => arquivo.slice(caminho.length + 1));
  }
  rodar(comando: string, args: string[]): ResultadoDeComando {
    const linha = `${comando} ${args.join(' ')}`;
    this.comandos.push(linha);
    return this.respostas.get(linha) ?? { estado: 'executou', codigo: 0, saida: '' };
  }
}

function contexto(parcial: Partial<ContextoDoServico> = {}): ContextoDoServico {
  return {
    argv: ['node', '/opt/brabo/index.cjs', 'service', 'status'],
    cwd: PASTA,
    plataforma: 'linux',
    home: HOME,
    xdgConfigHome: null,
    uid: 1000,
    comandoDoRunner: ['/usr/bin/node', '/opt/brabo/index.cjs'],
    path: '/usr/local/bin:/usr/bin:/bin',
    apiUrlDoAmbiente: null,
    sistema: new SistemaFalso(),
    ...parcial,
  };
}

const BASE = `${HOME}/projetos`;

const depsInstalar = (
  comConfig = true,
  comChave = true,
  base: BaseParaServico = { estado: 'ok', base: BASE },
) => ({
  lerConfig: () =>
    comConfig ? { projectId: PROJETO, apiUrl: 'https://brabo.example' } : null,
  lerChave: () => (comChave ? { deviceKeyId: 'chave-123' } : null),
  resolverDir: (bruto: string, cwd: string) => resolve(cwd, bruto),
  validarDir: () => {},
  resolverBase: () => base,
});

const depsSimples = (comConfig = true) => ({
  lerConfig: () => (comConfig ? { projectId: PROJETO } : null),
  resolverDir: (bruto: string, cwd: string) => resolve(cwd, bruto),
});

const UNIT_LINUX = `${HOME}/.config/systemd/user/brabo-runner-${PROJETO}.service`;
const PLIST_MAC = `${HOME}/Library/LaunchAgents/dev.brabo.runner.${PROJETO}.plist`;

// ------------------------------------------------------------------ install

describe('service install (RN-518)', () => {
  it('grava a unit de systemd --user e a ativa — caminho feliz no Linux', () => {
    const sistema = new SistemaFalso();
    const ctx = contexto({ sistema, argv: ['node', 'x', 'service', 'install'] });

    const resposta = instalar(ctx, depsInstalar());

    expect(resposta.codigo).toBe(0);
    expect(resposta.fluxo).toBe('saida');

    const unit = sistema.arquivos.get(UNIT_LINUX);
    expect(unit).toBeDefined();
    // A pasta e o projeto vão para dentro do arquivo, e o `WorkingDirectory` é
    // o registro que `uninstall` lê de volta.
    expect(unit).toContain(`WorkingDirectory="${PASTA}"`);
    expect(unit).toContain(`"--project" "${PROJETO}"`);
    expect(unit).toContain(`"--dir" "${PASTA}"`);
    expect(unit).toContain('"--api-url" "https://brabo.example"');
    expect(unit).toContain('Environment=PATH=/usr/local/bin:/usr/bin:/bin');
    // Alvo de SESSÃO, nunca `multi-user.target` (que é do gerenciador de sistema).
    expect(unit).toContain('WantedBy=default.target');
    // `on-abnormal` e nunca `on-failure`: exit 1 do runner é recusa fatal
    // (RN-514) e reiniciá-la seria o laço que o CLI recusa fazer sozinho.
    expect(unit).toContain('Restart=on-abnormal');
    expect(unit).not.toContain('Restart=on-failure');

    expect(sistema.comandos).toEqual([
      'systemctl --user daemon-reload',
      `systemctl --user enable --now brabo-runner-${PROJETO}.service`,
    ]);
  });

  it('grava o LaunchAgent e o carrega — caminho feliz no macOS', () => {
    const sistema = new SistemaFalso();
    const ctx = contexto({
      sistema,
      plataforma: 'darwin',
      argv: ['node', 'x', 'service', 'install'],
    });

    const resposta = instalar(ctx, depsInstalar());

    expect(resposta.codigo).toBe(0);
    const plist = sistema.arquivos.get(PLIST_MAC);
    expect(plist).toBeDefined();
    expect(plist).toContain(`<string>dev.brabo.runner.${PROJETO}</string>`);
    expect(plist).toContain(`<key>WorkingDirectory</key>`);
    expect(plist).toContain(`<string>${PASTA}</string>`);
    // `Crashed` é o equivalente de `Restart=on-abnormal`; `SuccessfulExit`
    // relançaria um join recusado em laço.
    expect(plist).toContain('<key>Crashed</key>');
    expect(plist).not.toContain('SuccessfulExit');
    expect(sistema.comandos).toEqual([
      `launchctl bootstrap gui/1000 ${PLIST_MAC}`,
    ]);
  });

  it('RECUSA rodar como root, sem escrever nada e sem rodar comando nenhum', () => {
    const sistema = new SistemaFalso();
    const ctx = contexto({ sistema, uid: 0, argv: ['node', 'x', 'service', 'install'] });

    const resposta = instalar(ctx, depsInstalar());

    expect(resposta.fluxo).toBe('erro');
    expect(resposta.linhas.join('\n')).toContain('RECUSA rodar como root');
    expect(sistema.arquivos.size).toBe(0);
    expect(sistema.comandos).toEqual([]);
  });

  it('RECUSA no Windows nomeando a plataforma, e diz o que continua funcionando', () => {
    const sistema = new SistemaFalso();
    const ctx = contexto({
      sistema,
      plataforma: 'win32',
      uid: null,
      argv: ['node', 'x', 'service', 'install'],
    });

    const resposta = instalar(ctx, depsInstalar());

    const texto = resposta.linhas.join('\n');
    expect(resposta.fluxo).toBe('erro');
    expect(texto).toContain('win32');
    expect(texto).toContain('FORA DE ESCOPO');
    expect(texto).toContain('primeiro plano');
    expect(sistema.arquivos.size).toBe(0);
  });

  it('RECUSA sem chave de dispositivo na pasta — um serviço nunca carrega token', () => {
    const sistema = new SistemaFalso();
    const ctx = contexto({ sistema, argv: ['node', 'x', 'service', 'install'] });

    const resposta = instalar(ctx, depsInstalar(true, false));

    const texto = resposta.linhas.join('\n');
    expect(resposta.fluxo).toBe('erro');
    expect(texto).toContain(NOME_ARQUIVO_CHAVE);
    expect(texto).toContain('nunca por token');
    expect(sistema.arquivos.size).toBe(0);
  });

  it('RECUSA projectId que viraria caminho — ele é NOME DE ARQUIVO da unit', () => {
    const sistema = new SistemaFalso();
    const ctx = contexto({
      sistema,
      argv: ['node', 'x', 'service', 'install', '--project', '../../etc/systemd'],
    });

    const resposta = instalar(ctx, depsInstalar());

    expect(resposta.fluxo).toBe('erro');
    expect(resposta.linhas.join('\n')).toContain('projectId recusado');
    expect(sistema.arquivos.size).toBe(0);
  });

  it('sem systemctl no PATH: o ARQUIVO fica, e a resposta diz que não ativou', () => {
    const sistema = new SistemaFalso();
    sistema.respostas.set('systemctl --user daemon-reload', {
      estado: 'nao-consegui',
      motivo: 'ENOENT',
    });
    const ctx = contexto({ sistema, argv: ['node', 'x', 'service', 'install'] });

    const resposta = instalar(ctx, depsInstalar());

    // Nem "instalado" nem "não aconteceu nada": o arquivo existe e a ativação
    // não aconteceu, e as duas metades são ditas.
    expect(resposta.codigo).toBe(5);
    expect(resposta.fluxo).toBe('erro');
    expect(sistema.arquivos.has(UNIT_LINUX)).toBe(true);
    const texto = resposta.linhas.join('\n');
    expect(texto).toContain('NÃO foi possível ativá-lo');
    expect(texto).toContain('ENOENT');
    expect(texto).toContain('continua no lugar');
  });

  it('respeita XDG_CONFIG_HOME — o systemd procura a unit lá, e escrever em ~/.config seria escrever onde ninguém olha', () => {
    const sistema = new SistemaFalso();
    const ctx = contexto({
      sistema,
      xdgConfigHome: '/home/dev/.cfg',
      argv: ['node', 'x', 'service', 'install'],
    });

    instalar(ctx, depsInstalar());

    const esperado = `/home/dev/.cfg/systemd/user/brabo-runner-${PROJETO}.service`;
    expect(sistema.arquivos.has(esperado)).toBe(true);
    expect(sistema.arquivos.has(UNIT_LINUX)).toBe(false);
    // E `status` alcança exatamente a mesma unit, pela mesma derivação.
    expect(consultarStatus(ctx, alvoDeProjeto(PROJETO))?.caminho).toBe(esperado);
  });

  it('repassa a recusa da RN-434 (--dir fora do $HOME no Linux) sem escrever', () => {
    const sistema = new SistemaFalso();
    const ctx = contexto({ sistema, argv: ['node', 'x', 'service', 'install'] });

    const resposta = instalar(ctx, {
      ...depsInstalar(),
      validarDir: () => {
        throw new Error('--dir precisa estar dentro do seu diretório de usuário (/home/dev)');
      },
    });

    expect(resposta.fluxo).toBe('erro');
    expect(resposta.linhas[0]).toContain('dentro do seu diretório de usuário');
    expect(sistema.arquivos.size).toBe(0);
  });
});

// ---------------------------------------------------------------- uninstall

describe('service uninstall (RN-518)', () => {
  function comUnitInstalada(): SistemaFalso {
    const sistema = new SistemaFalso();
    const ctx = contexto({ sistema, argv: ['node', 'x', 'service', 'install'] });
    instalar(ctx, depsInstalar());
    sistema.comandos.length = 0;
    sistema.arquivos.set(join(PASTA, NOME_ARQUIVO_CONFIG), '{}');
    sistema.arquivos.set(join(PASTA, NOME_ARQUIVO_CHAVE), '{}');
    return sistema;
  }

  it('remove a unit e os DOIS arquivos, lendo a pasta da própria unit', () => {
    const sistema = comUnitInstalada();
    // Rodando de OUTRA pasta de propósito: o `cwd` não pode decidir o que se
    // apaga; a unit é o registro do que foi instalado.
    const ctx = contexto({
      sistema,
      cwd: '/home/dev/outra-pasta',
      argv: ['node', 'x', 'service', 'uninstall', '--project', PROJETO],
    });

    const resposta = desinstalar(ctx, depsSimples());

    expect(resposta.codigo).toBe(0);
    expect(sistema.arquivos.has(UNIT_LINUX)).toBe(false);
    expect(sistema.arquivos.has(join(PASTA, NOME_ARQUIVO_CONFIG))).toBe(false);
    expect(sistema.arquivos.has(join(PASTA, NOME_ARQUIVO_CHAVE))).toBe(false);
    expect(sistema.comandos).toContain(
      `systemctl --user disable --now brabo-runner-${PROJETO}.service`,
    );
    // A chave saiu do disco e NÃO foi revogada no servidor — dizer o contrário
    // seria pior que não remover.
    expect(resposta.linhas.join('\n')).toContain('NÃO foi revogada no servidor');
  });

  it('sem unit e sem --dir: responde NÃO INSTALADO e não toca em arquivo nenhum', () => {
    const sistema = new SistemaFalso();
    sistema.arquivos.set(join(PASTA, NOME_ARQUIVO_CHAVE), '{}');
    const ctx = contexto({
      sistema,
      argv: ['node', 'x', 'service', 'uninstall', '--project', PROJETO],
    });

    const resposta = desinstalar(ctx, depsSimples());

    expect(resposta.codigo).toBe(CODIGO_POR_ESTADO['nao-instalado']);
    // A chave de OUTRO projeto continua onde estava: adivinhar pela pasta
    // corrente é exatamente o que a recusa evita.
    expect(sistema.arquivos.has(join(PASTA, NOME_ARQUIVO_CHAVE))).toBe(true);
    expect(resposta.linhas.join('\n')).toContain('NÃO foram tocados');
  });

  it('sem unit mas com --dir: remove os dois arquivos daquela pasta', () => {
    const sistema = new SistemaFalso();
    sistema.arquivos.set(join(PASTA, NOME_ARQUIVO_CONFIG), '{}');
    sistema.arquivos.set(join(PASTA, NOME_ARQUIVO_CHAVE), '{}');
    const ctx = contexto({
      sistema,
      cwd: '/home/dev',
      argv: ['node', 'x', 'service', 'uninstall', '--project', PROJETO, '--dir', PASTA],
    });

    const resposta = desinstalar(ctx, depsSimples());

    expect(sistema.arquivos.has(join(PASTA, NOME_ARQUIVO_CONFIG))).toBe(false);
    expect(sistema.arquivos.has(join(PASTA, NOME_ARQUIVO_CHAVE))).toBe(false);
    expect(resposta.linhas.join('\n')).toContain('removido:');
  });

  it('systemctl que recusa o disable vira AVISO — o arquivo é removido assim mesmo', () => {
    const sistema = comUnitInstalada();
    sistema.respostas.set(
      `systemctl --user disable --now brabo-runner-${PROJETO}.service`,
      { estado: 'executou', codigo: 1, saida: 'Failed to disable unit' },
    );
    const ctx = contexto({
      sistema,
      argv: ['node', 'x', 'service', 'uninstall', '--project', PROJETO],
    });

    const resposta = desinstalar(ctx, depsSimples());

    expect(resposta.linhas.join('\n')).toContain('aviso:');
    expect(sistema.arquivos.has(UNIT_LINUX)).toBe(false);
  });

  it('RECUSA no Windows, como os outros dois', () => {
    const ctx = contexto({
      plataforma: 'win32',
      uid: null,
      argv: ['node', 'x', 'service', 'uninstall', '--project', PROJETO],
    });
    expect(desinstalar(ctx, depsSimples()).fluxo).toBe('erro');
  });

  it('sem espécie resolvível, RECUSA em vez de adivinhar — e diz o que existe', () => {
    const ctx = contexto({ argv: ['node', 'x', 'service', 'uninstall'] });
    const resposta = desinstalar(ctx, depsSimples(false));
    expect(resposta.fluxo).toBe('erro');
    const texto = resposta.linhas.join('\n');
    expect(texto).toContain('precisa saber O QUE remover');
    expect(texto).toContain('Não há unit nenhuma instalada');
  });
});

// ------------------------------------------------------------------- status

describe('service status: os QUATRO estados NÃO colapsam (RN-518/RN-088)', () => {
  function comUnit(sistema: SistemaFalso): SistemaFalso {
    sistema.arquivos.set(UNIT_LINUX, `WorkingDirectory="${PASTA}"\n`);
    return sistema;
  }

  it('não instalado: a resposta vem do DISCO e nem pergunta ao gerenciador', () => {
    const sistema = new SistemaFalso();
    const ctx = contexto({ sistema, argv: ['node', 'x', 'service', 'status'] });

    const resposta = status(ctx, depsSimples());

    expect(consultarStatus(ctx, alvoDeProjeto(PROJETO))?.estado).toBe('nao-instalado');
    expect(resposta.codigo).toBe(4);
    expect(resposta.linhas.join('\n')).toContain('NÃO INSTALADO');
    expect(sistema.comandos).toEqual([]);
  });

  it('instalado e rodando', () => {
    const sistema = comUnit(new SistemaFalso());
    sistema.respostas.set(`systemctl --user is-active brabo-runner-${PROJETO}.service`, {
      estado: 'executou',
      codigo: 0,
      saida: 'active\n',
    });
    const ctx = contexto({ sistema, argv: ['node', 'x', 'service', 'status'] });

    const resposta = status(ctx, depsSimples());
    expect(resposta.codigo).toBe(0);
    expect(resposta.linhas.join('\n')).toContain('INSTALADO E RODANDO');
  });

  it('instalado e parado — `failed` também é parado, e o detalhe diz qual é', () => {
    const sistema = comUnit(new SistemaFalso());
    sistema.respostas.set(`systemctl --user is-active brabo-runner-${PROJETO}.service`, {
      estado: 'executou',
      codigo: 3,
      saida: 'failed\n',
    });
    const ctx = contexto({ sistema, argv: ['node', 'x', 'service', 'status'] });

    const resposta = status(ctx, depsSimples());
    expect(resposta.codigo).toBe(3);
    const texto = resposta.linhas.join('\n');
    expect(texto).toContain('INSTALADO E PARADO');
    expect(texto).toContain('failed');
  });

  it('instalado e NÃO CONSEGUI PERGUNTAR: sem systemctl, nunca vira "parado"', () => {
    const sistema = comUnit(new SistemaFalso());
    sistema.respostas.set(`systemctl --user is-active brabo-runner-${PROJETO}.service`, {
      estado: 'nao-consegui',
      motivo: 'ENOENT',
    });
    const ctx = contexto({ sistema, argv: ['node', 'x', 'service', 'status'] });

    const resposta = status(ctx, depsSimples());
    expect(resposta.codigo).toBe(5);
    const texto = resposta.linhas.join('\n');
    expect(texto).toContain('NÃO CONSEGUI PERGUNTAR');
    expect(texto).toContain('NÃO quer dizer que está parado');
  });

  it('palavra que este CLI não conhece cai em "não consegui perguntar", não em "parado"', () => {
    const sistema = comUnit(new SistemaFalso());
    sistema.respostas.set(`systemctl --user is-active brabo-runner-${PROJETO}.service`, {
      estado: 'executou',
      codigo: 0,
      saida: 'transmogrifying\n',
    });
    const ctx = contexto({ sistema, argv: ['node', 'x', 'service', 'status'] });

    expect(consultarStatus(ctx, alvoDeProjeto(PROJETO))?.estado).toBe('nao-consegui-perguntar');
  });

  it('macOS: com PID é rodando; carregado sem PID e não carregado são parado', () => {
    const sistema = new SistemaFalso();
    sistema.arquivos.set(PLIST_MAC, '<key>WorkingDirectory</key><string>/x</string>');
    const ctx = contexto({
      sistema,
      plataforma: 'darwin',
      argv: ['node', 'x', 'service', 'status'],
    });
    const chave = `launchctl list dev.brabo.runner.${PROJETO}`;

    sistema.respostas.set(chave, { estado: 'executou', codigo: 0, saida: '{ "PID" = 4242; }' });
    expect(consultarStatus(ctx, alvoDeProjeto(PROJETO))?.estado).toBe('rodando');

    sistema.respostas.set(chave, { estado: 'executou', codigo: 0, saida: '{ "LastExitStatus" = 0; }' });
    expect(consultarStatus(ctx, alvoDeProjeto(PROJETO))?.estado).toBe('parado');

    sistema.respostas.set(chave, { estado: 'executou', codigo: 113, saida: 'Could not find service' });
    expect(consultarStatus(ctx, alvoDeProjeto(PROJETO))?.estado).toBe('parado');
  });

  it('os quatro códigos de saída são distintos — nenhum estado empresta o do outro', () => {
    const codigos = Object.values(CODIGO_POR_ESTADO);
    expect(new Set(codigos).size).toBe(codigos.length);
    // 1 e 2 já significam falha genérica e erro de uso neste CLI.
    expect(codigos).not.toContain(1);
    expect(codigos).not.toContain(2);
  });

  it('RECUSA no Windows, como os outros dois', () => {
    const ctx = contexto({
      plataforma: 'win32',
      uid: null,
      argv: ['node', 'x', 'service', 'status'],
    });
    const resposta = status(ctx, depsSimples());
    expect(resposta.fluxo).toBe('erro');
    expect(resposta.linhas.join('\n')).toContain('win32');
  });
});

// -------------------------------------------------------------- subcomando

describe('vocabulário do subcomando', () => {
  it('conhece exatamente os três, e nada mais', () => {
    expect(ehSubcomandoConhecido('install')).toBe(true);
    expect(ehSubcomandoConhecido('uninstall')).toBe(true);
    expect(ehSubcomandoConhecido('status')).toBe(true);
    expect(ehSubcomandoConhecido('start')).toBe(false);
    expect(ehSubcomandoConhecido(undefined)).toBe(false);
  });

  it('aceita UUID como projectId e recusa caminho, espaço e vazio', () => {
    expect(projectIdValidoParaServico(PROJETO)).toBe(true);
    expect(projectIdValidoParaServico('../etc')).toBe(false);
    expect(projectIdValidoParaServico('a b')).toBe(false);
    expect(projectIdValidoParaServico('')).toBe(false);
    expect(projectIdValidoParaServico('/absoluto')).toBe(false);
  });
});

// ------------------------------------------------- unit de máquina (RN-545)

const UNIT_MAQUINA_LINUX = `${HOME}/.config/systemd/user/brabo-runner.service`;
const PLIST_MAQUINA_MAC = `${HOME}/Library/LaunchAgents/dev.brabo.runner.plist`;

/** Pasta SEM `brabo-runner.config.json` — a do agente de máquina. */
const PASTA_DA_MAQUINA = `${HOME}/.config/brabo`;

const depsDeMaquina = (
  comChave = true,
  base: BaseParaServico = { estado: 'ok', base: BASE },
) => ({
  // Chave SEM config: o config é por PROJETO, e a pasta da máquina não o tem.
  lerConfig: () => null,
  lerChave: () => (comChave ? { deviceKeyId: 'chave-da-maquina' } : null),
  resolverDir: (bruto: string, cwd: string) => resolve(cwd, bruto),
  validarDir: () => {},
  resolverBase: () => base,
});

describe('service install --machine (RN-545)', () => {
  function ctxDeMaquina(sistema: SistemaFalso, extra: string[] = []): ContextoDoServico {
    return contexto({
      sistema,
      cwd: PASTA_DA_MAQUINA,
      argv: ['node', 'x', 'service', 'install', '--machine', ...extra],
    });
  }

  it('grava a unit SEM --project e SEM --dir — é a ausência de --project que põe o processo no modo de máquina', () => {
    const sistema = new SistemaFalso();
    const resposta = instalar(ctxDeMaquina(sistema), depsDeMaquina());

    expect(resposta.codigo).toBe(0);
    const unit = sistema.arquivos.get(UNIT_MAQUINA_LINUX);
    expect(unit).toBeDefined();
    expect(unit).not.toContain('"--project"');
    expect(unit).not.toContain('"--dir"');
    // O `WorkingDirectory` é onde a CREDENCIAL está: é de lá que
    // `lerArgumentos` lê a chave de dispositivo sob systemd/launchd.
    expect(unit).toContain(`WorkingDirectory="${PASTA_DA_MAQUINA}"`);
    // `Restart=on-abnormal` fica byte a byte — lista vazia sai com 0 (RN-544),
    // e `on-failure` reergueria uma recusa fatal de join em laço.
    expect(unit).toContain('Restart=on-abnormal');
    expect(unit).not.toContain('Restart=on-failure');
    // A unit por projeto NÃO foi tocada nem criada.
    expect(sistema.arquivos.has(UNIT_LINUX)).toBe(false);
    expect(sistema.comandos).toEqual([
      'systemctl --user daemon-reload',
      'systemctl --user enable --now brabo-runner.service',
    ]);
  });

  it('o nome da unit de máquina NÃO pode colidir com projectId nenhum válido', () => {
    const sistema = new SistemaFalso();
    instalar(ctxDeMaquina(sistema), depsDeMaquina());
    instalar(
      contexto({ sistema, argv: ['node', 'x', 'service', 'install', '--project', PROJETO] }),
      depsInstalar(),
    );

    // Só falha se um dos dois sobrescrever o outro. Ambos existem, com nomes
    // distintos, e o de máquina não termina em `-<id>.service`.
    expect(sistema.arquivos.has(UNIT_MAQUINA_LINUX)).toBe(true);
    expect(UNIT_MAQUINA_LINUX).not.toBe(UNIT_LINUX);
    // O caractere que separa as duas espécies: `-` no projeto, `.` na máquina.
    // Um projectId vazio produziria a colisão, e `PROJECT_ID_VALIDO` o recusa.
    expect(projectIdValidoParaServico('')).toBe(false);
    expect(`brabo-runner-${'a'}.service`).not.toBe('brabo-runner.service');
  });

  it('congela XDG_CONFIG_HOME na unit — é ela que decide onde a base mora, e systemd não repassa o ambiente do shell', () => {
    const sistema = new SistemaFalso();
    const ctx = contexto({
      sistema,
      cwd: PASTA_DA_MAQUINA,
      xdgConfigHome: '/home/dev/.cfg',
      argv: ['node', 'x', 'service', 'install', '--machine'],
    });

    instalar(ctx, depsDeMaquina());

    const unit = sistema.arquivos.get('/home/dev/.cfg/systemd/user/brabo-runner.service');
    expect(unit).toContain('Environment=XDG_CONFIG_HOME=/home/dev/.cfg');
    // O VALOR da base NÃO vai para a unit: trocá-la é editar o arquivo e
    // reiniciar, nunca reinstalar.
    expect(unit).not.toContain('"--base"');
  });

  it('macOS: o Label não leva projectId, e o log perde o sufixo', () => {
    const sistema = new SistemaFalso();
    const ctx = contexto({
      sistema,
      plataforma: 'darwin',
      cwd: PASTA_DA_MAQUINA,
      argv: ['node', 'x', 'service', 'install', '--machine'],
    });

    expect(instalar(ctx, depsDeMaquina()).codigo).toBe(0);
    const plist = sistema.arquivos.get(PLIST_MAQUINA_MAC);
    expect(plist).toContain('<string>dev.brabo.runner</string>');
    expect(plist).toContain(`<string>${HOME}/Library/Logs/brabo-runner.log</string>`);
    expect(plist).toContain('<key>Crashed</key>');
  });

  it('usa BRABO_API_URL do ambiente quando não há --api-url — não há config de projeto que responda por ela', () => {
    const sistema = new SistemaFalso();
    const ctx = contexto({
      sistema,
      cwd: PASTA_DA_MAQUINA,
      apiUrlDoAmbiente: 'https://brabo.interno',
      argv: ['node', 'x', 'service', 'install', '--machine'],
    });

    instalar(ctx, depsDeMaquina());

    expect(sistema.arquivos.get(UNIT_MAQUINA_LINUX)).toContain(
      '"--api-url" "https://brabo.interno"',
    );
  });

  it('RECUSA quando a pasta tem brabo-runner.config.json — o serviço subiria em modo de PROJETO, em silêncio', () => {
    const sistema = new SistemaFalso();
    const resposta = instalar(ctxDeMaquina(sistema), {
      ...depsDeMaquina(),
      lerConfig: () => ({ projectId: PROJETO, apiUrl: 'https://brabo.example' }),
    });

    expect(resposta.fluxo).toBe('erro');
    const texto = resposta.linhas.join('\n');
    expect(texto).toContain(NOME_ARQUIVO_CONFIG);
    expect(texto).toContain('modo de projeto');
    expect(sistema.arquivos.size).toBe(0);
  });

  it('RECUSA sem base consentida — instalar um serviço que sai no primeiro boot é pior que não instalar', () => {
    const sistema = new SistemaFalso();
    const resposta = instalar(
      ctxDeMaquina(sistema),
      depsDeMaquina(true, { estado: 'ausente' }),
    );

    expect(resposta.fluxo).toBe('erro');
    expect(resposta.linhas.join('\n')).toContain('BASE de projetos consentida');
    expect(sistema.arquivos.size).toBe(0);
  });

  it('RECUSA base inválida repassando a mensagem de base-guard, sem gravar', () => {
    const sistema = new SistemaFalso();
    const resposta = instalar(
      ctxDeMaquina(sistema),
      depsDeMaquina(true, { estado: 'recusada', mensagem: 'base precisa ser absoluta' }),
    );

    expect(resposta.fluxo).toBe('erro');
    expect(resposta.linhas[0]).toBe('base precisa ser absoluta');
    expect(sistema.arquivos.size).toBe(0);
  });

  it('RECUSA sem chave de dispositivo — um serviço nunca carrega token, nem o de máquina', () => {
    const sistema = new SistemaFalso();
    const resposta = instalar(ctxDeMaquina(sistema), depsDeMaquina(false));

    expect(resposta.fluxo).toBe('erro');
    expect(resposta.linhas.join('\n')).toContain('nunca por token');
    expect(sistema.arquivos.size).toBe(0);
  });

  it('RECUSA --machine junto de --project: são as duas espécies, e pedir as duas não é um pedido', () => {
    const sistema = new SistemaFalso();
    const resposta = instalar(ctxDeMaquina(sistema, ['--project', PROJETO]), depsDeMaquina());

    expect(resposta.fluxo).toBe('erro');
    expect(resposta.linhas.join('\n')).toContain('DUAS espécies');
    expect(sistema.arquivos.size).toBe(0);
  });
});

describe('as duas espécies NÃO se sobrepõem (RN-545)', () => {
  it('install --machine RECUSA com unit por projeto no disco, sem remover nada', () => {
    const sistema = new SistemaFalso();
    instalar(
      contexto({ sistema, argv: ['node', 'x', 'service', 'install'] }),
      depsInstalar(),
    );
    sistema.comandos.length = 0;

    const resposta = instalar(
      contexto({
        sistema,
        cwd: PASTA_DA_MAQUINA,
        argv: ['node', 'x', 'service', 'install', '--machine'],
      }),
      depsDeMaquina(),
    );

    expect(resposta.fluxo).toBe('erro');
    const texto = resposta.linhas.join('\n');
    expect(texto).toContain(`uninstall --project ${PROJETO}`);
    expect(texto).toContain('Nada foi removido nem gravado');
    // A unit que já existia continua intacta, e nenhuma nova apareceu.
    expect(sistema.arquivos.has(UNIT_LINUX)).toBe(true);
    expect(sistema.arquivos.has(UNIT_MAQUINA_LINUX)).toBe(false);
    expect(sistema.comandos).toEqual([]);
  });

  it('install por projeto RECUSA com a unit de máquina no disco — o inverso, pelo mesmo motivo', () => {
    const sistema = new SistemaFalso();
    instalar(
      contexto({
        sistema,
        cwd: PASTA_DA_MAQUINA,
        argv: ['node', 'x', 'service', 'install', '--machine'],
      }),
      depsDeMaquina(),
    );
    sistema.comandos.length = 0;

    const resposta = instalar(
      contexto({ sistema, argv: ['node', 'x', 'service', 'install'] }),
      depsInstalar(),
    );

    expect(resposta.fluxo).toBe('erro');
    expect(resposta.linhas.join('\n')).toContain('uninstall --machine');
    expect(sistema.arquivos.has(UNIT_LINUX)).toBe(false);
    expect(sistema.arquivos.has(UNIT_MAQUINA_LINUX)).toBe(true);
    expect(sistema.comandos).toEqual([]);
  });

  it('status --machine DIZ que há units por projeto, e o código de saída NÃO as soma', () => {
    const sistema = new SistemaFalso();
    instalar(
      contexto({ sistema, argv: ['node', 'x', 'service', 'install'] }),
      depsInstalar(),
    );
    sistema.arquivos.set(UNIT_MAQUINA_LINUX, 'WorkingDirectory="/x"\n');
    sistema.comandos.length = 0;
    sistema.respostas.set('systemctl --user is-active brabo-runner.service', {
      estado: 'executou',
      codigo: 0,
      saida: 'active\n',
    });

    const resposta = status(
      contexto({ sistema, argv: ['node', 'x', 'service', 'status', '--machine'] }),
      depsSimples(),
    );

    // O código responde sobre a unit PERGUNTADA, e só ela.
    expect(resposta.codigo).toBe(CODIGO_POR_ESTADO.rodando);
    const texto = resposta.linhas.join('\n');
    expect(texto).toContain('agente de MÁQUINA');
    expect(texto).toContain('INSTALADO E RODANDO');
    expect(texto).toContain(`uninstall --project ${PROJETO}`);
    // Presença lida do disco, e a saída diz isso — nunca um estado inventado.
    expect(texto).toContain('não foi perguntado ao gerenciador');
    expect(sistema.comandos).toEqual(['systemctl --user is-active brabo-runner.service']);
  });

  it('status de um projeto DIZ que a unit de máquina existe, e não pergunta o estado dela', () => {
    const sistema = new SistemaFalso();
    sistema.arquivos.set(UNIT_MAQUINA_LINUX, 'WorkingDirectory="/x"\n');

    const resposta = status(
      contexto({ sistema, argv: ['node', 'x', 'service', 'status'] }),
      depsSimples(),
    );

    expect(resposta.codigo).toBe(CODIGO_POR_ESTADO['nao-instalado']);
    expect(resposta.linhas.join('\n')).toContain('unit de MÁQUINA instalada');
    expect(sistema.comandos).toEqual([]);
  });

  it('status sem projeto resolvível responde sobre a MÁQUINA, e nomeia --project para quem queria a outra', () => {
    const sistema = new SistemaFalso();
    const resposta = status(
      contexto({ sistema, argv: ['node', 'x', 'service', 'status'] }),
      depsSimples(false),
    );

    expect(resposta.codigo).toBe(CODIGO_POR_ESTADO['nao-instalado']);
    const texto = resposta.linhas.join('\n');
    expect(texto).toContain('agente de MÁQUINA');
    expect(texto).toContain('--project <projectId>');
  });

  it('uninstall --machine remove só a unit de máquina; a do projeto fica intacta', () => {
    const sistema = new SistemaFalso();
    instalar(
      contexto({ sistema, argv: ['node', 'x', 'service', 'install'] }),
      depsInstalar(),
    );
    sistema.arquivos.set(UNIT_MAQUINA_LINUX, `WorkingDirectory="${PASTA_DA_MAQUINA}"\n`);
    sistema.arquivos.set(join(PASTA_DA_MAQUINA, NOME_ARQUIVO_CHAVE), '{}');

    const resposta = desinstalar(
      contexto({ sistema, argv: ['node', 'x', 'service', 'uninstall', '--machine'] }),
      depsSimples(),
    );

    expect(resposta.codigo).toBe(0);
    expect(sistema.arquivos.has(UNIT_MAQUINA_LINUX)).toBe(false);
    expect(sistema.arquivos.has(join(PASTA_DA_MAQUINA, NOME_ARQUIVO_CHAVE))).toBe(false);
    // A unit por projeto NÃO é removida — é a garantia do ADR 0154 ponto 5.
    expect(sistema.arquivos.has(UNIT_LINUX)).toBe(true);
    expect(sistema.comandos).toContain(
      'systemctl --user disable --now brabo-runner.service',
    );
  });

  it('uninstall sem espécie nomeada RECUSA e LISTA as duas — remover a errada apaga a chave errada', () => {
    const sistema = new SistemaFalso();
    sistema.arquivos.set(UNIT_LINUX, 'WorkingDirectory="/x"\n');
    sistema.arquivos.set(UNIT_MAQUINA_LINUX, 'WorkingDirectory="/y"\n');

    const resposta = desinstalar(
      contexto({ sistema, argv: ['node', 'x', 'service', 'uninstall'] }),
      depsSimples(false),
    );

    expect(resposta.fluxo).toBe('erro');
    const texto = resposta.linhas.join('\n');
    expect(texto).toContain('--machine');
    expect(texto).toContain(`--project ${PROJETO}`);
    // NADA foi removido: a recusa é o comportamento, não um passo intermediário.
    expect(sistema.arquivos.has(UNIT_LINUX)).toBe(true);
    expect(sistema.arquivos.has(UNIT_MAQUINA_LINUX)).toBe(true);
  });

  it('consultarStatus aceita os DOIS alvos e alcança arquivos diferentes', () => {
    const sistema = new SistemaFalso();
    const ctx = contexto({ sistema, argv: ['node', 'x', 'service', 'status'] });

    expect(consultarStatus(ctx, ALVO_DE_MAQUINA)?.caminho).toBe(UNIT_MAQUINA_LINUX);
    expect(consultarStatus(ctx, alvoDeProjeto(PROJETO))?.caminho).toBe(UNIT_LINUX);
  });
});
