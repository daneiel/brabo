import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOME_ARQUIVO_CHAVE, NOME_ARQUIVO_CONFIG } from './device-key.ts';
import {
  CODIGO_POR_ESTADO,
  consultarStatus,
  desinstalar,
  ehSubcomandoConhecido,
  instalar,
  projectIdValidoParaServico,
  status,
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
    sistema: new SistemaFalso(),
    ...parcial,
  };
}

const depsInstalar = (comConfig = true, comChave = true) => ({
  lerConfig: () =>
    comConfig ? { projectId: PROJETO, apiUrl: 'https://brabo.example' } : null,
  lerChave: () => (comChave ? { deviceKeyId: 'chave-123' } : null),
  resolverDir: (bruto: string, cwd: string) => resolve(cwd, bruto),
  validarDir: () => {},
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
    expect(consultarStatus(ctx, PROJETO)?.caminho).toBe(esperado);
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

  it('sem projeto resolvível, RECUSA em vez de adivinhar', () => {
    const ctx = contexto({ argv: ['node', 'x', 'service', 'uninstall'] });
    const resposta = desinstalar(ctx, depsSimples(false));
    expect(resposta.fluxo).toBe('erro');
    expect(resposta.linhas.join('\n')).toContain('QUAL projeto remover');
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

    expect(consultarStatus(ctx, PROJETO)?.estado).toBe('nao-instalado');
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

    expect(consultarStatus(ctx, PROJETO)?.estado).toBe('nao-consegui-perguntar');
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
    expect(consultarStatus(ctx, PROJETO)?.estado).toBe('rodando');

    sistema.respostas.set(chave, { estado: 'executou', codigo: 0, saida: '{ "LastExitStatus" = 0; }' });
    expect(consultarStatus(ctx, PROJETO)?.estado).toBe('parado');

    sistema.respostas.set(chave, { estado: 'executou', codigo: 113, saida: 'Could not find service' });
    expect(consultarStatus(ctx, PROJETO)?.estado).toBe('parado');
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
