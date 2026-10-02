import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

// AT-351 e AT-358 no `install.sh`: a pergunta dos modelos locais (profile
// `llm`), a porta do Ollama MEDIDA antes de gravar, a linha única de
// `COMPOSE_PROFILES`, a detecção que não confunde o compose de DEV com uma
// instalação, e a reinstalação DO ZERO depois do backup provado.
//
// As funções rodam de verdade (o script carregado por `source`, menos a
// chamada de `main` — o molde de install-broker.spec.ts), sem terminal: stdin
// é um pipe, que é o que deixa `read` responder sem `[ -t 0 ]` no caminho.

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(RAIZ, 'install.sh');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brabo-install-llm-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function carregavel(): string {
  const texto = fs.readFileSync(SCRIPT, 'utf8');
  const corpo = texto.replace(/\nmain\s+"\$@"\s*$/, '\n');
  if (corpo === texto) throw new Error('não achei a chamada de main para recortar de install.sh');
  const caminho = path.join(tmp, 'install-sem-main.sh');
  fs.writeFileSync(caminho, corpo);
  return caminho;
}

function rodar(corpo: string, opcoes: { entrada?: string; path?: string } = {}) {
  const r = spawnSync('bash', ['-c', `source "$BRABO_ALVO"\n${corpo}`], {
    encoding: 'utf8',
    input: opcoes.entrada ?? '',
    env: {
      ...process.env,
      NO_COLOR: '1',
      BRABO_ALVO: carregavel(),
      PATH: `${opcoes.path ? `${opcoes.path}:` : ''}${process.env.PATH ?? ''}`,
    },
  });
  return { saida: (r.stdout ?? '') + (r.stderr ?? ''), codigo: r.status ?? -1 };
}

/** `porta_em_uso` trocada por uma lista: as portas citadas estão ocupadas. */
const ocupadas = (...portas: number[]) =>
  `porta_em_uso() { case " ${portas.join(' ')} " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }`;

describe('install.sh — os modelos locais (AT-351)', () => {
  it('o plano declara a pergunta, com default NÃO e a porta medida', () => {
    const plano = spawnSync('bash', [SCRIPT, '--print-plan'], { encoding: 'utf8' }).stdout;
    expect(plano).toMatch(/^ligar-modelos-locais\tpergunta\tdefault NÃO; sim MEDE a porta/m);
  });

  it('sem terminal: diz o custo e o que se perde, e fica DESLIGADO', () => {
    const r = rodar(`consentir_llm\nprintf 'ESTADO=%s\\n' "$LLM_LIGADO"`);
    expect(r.codigo).toBe(0);
    expect(r.saida).toContain('checagem SEMÂNTICA de duplicata');
    expect(r.saida).toContain('ollama-model-loader');
    expect(r.saida).toContain('os modelos locais ficam DESLIGADOS');
    expect(r.saida).toContain('ESTADO=nao');
  });

  it('11434 livre: é ela', () => {
    const r = rodar(`${ocupadas()}\nescolher_porta_do_ollama; printf 'P=%s\\n' "$OLLAMA_PORTA_ESCOLHIDA"`);
    expect(r.saida).toContain('P=11434');
  });

  it('11434 ocupada (um Ollama nativo): mede e escolhe a próxima livre', () => {
    const r = rodar(`${ocupadas(11434, 11435)}\nescolher_porta_do_ollama; printf 'P=%s\\n' "$OLLAMA_PORTA_ESCOLHIDA"`);
    expect(r.saida).toContain('P=11436');
  });

  it('a faixa inteira ocupada: falha, e nenhuma porta é escolhida', () => {
    const todas = Array.from({ length: 10 }, (_, i) => 11434 + i);
    const r = rodar(`${ocupadas(...todas)}\nif escolher_porta_do_ollama; then echo ESCOLHEU; else echo FALHOU; fi\nprintf 'P=[%s]\\n' "$OLLAMA_PORTA_ESCOLHIDA"`);
    expect(r.saida).toContain('FALHOU');
    expect(r.saida).toContain('P=[]');
  });

  it('porta_em_uso mede de verdade: um servidor escutando é "em uso"', async () => {
    const net = await import('node:net');
    const servidor = net.createServer();
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', () => ok()));
    const porta = (servidor.address() as { port: number }).port;
    try {
      const r = rodar(`if porta_em_uso ${porta}; then echo OCUPADA; else echo LIVRE; fi`);
      expect(r.saida).toContain('OCUPADA');
    } finally {
      servidor.close();
    }
  });

  const gerar = (broker: boolean, llm: boolean) => {
    const arquivo = path.join(tmp, `env-${broker}-${llm}`);
    const r = rodar(
      `for i in API ENGINE WEB BACKUP BROKER; do eval "BRABO_\${i}_IMAGE=img-\$i"; done
BASE_DE_PROJETOS='${tmp}/projetos'
BROKER_LIGADO=${broker ? 'sim' : 'nao'}; DOCKER_GID_MEDIDO=984; RAIZ_GERENCIADA_NO_HOST=/r
LLM_LIGADO=${llm ? 'sim' : 'nao'}; OLLAMA_PORTA_ESCOLHIDA=11436
gerar_segredos '${arquivo}'
escrever_env '${arquivo}'`,
    );
    expect(r.codigo, r.saida).toBe(0);
    return fs.readFileSync(arquivo, 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));
  };

  it('broker e modelos ligados: UMA linha de profiles com os dois, e a porta medida', () => {
    const l = gerar(true, true);
    expect(l.filter((x) => x.startsWith('COMPOSE_PROFILES='))).toEqual(['COMPOSE_PROFILES=container-broker,llm']);
    expect(l).toContain('OLLAMA_PORT=11436');
  });

  it('só os modelos: o profile é llm, sem o do broker', () => {
    const l = gerar(false, true);
    expect(l.filter((x) => x.startsWith('COMPOSE_PROFILES='))).toEqual(['COMPOSE_PROFILES=llm']);
  });

  it('nada ligado: nem profile nem porta', () => {
    const l = gerar(false, false);
    expect(l.some((x) => x.startsWith('COMPOSE_PROFILES='))).toBe(false);
    expect(l.some((x) => x.startsWith('OLLAMA_PORT='))).toBe(false);
  });
});

describe('install.sh — o compose de dev não é instalação, e reinstalar do zero (AT-358)', () => {
  const dockerQueLista = (nomes: string[]) => {
    const dir = fs.mkdtempSync(path.join(tmp, 'bin-'));
    const json = nomes.map((n) => `{"Name":"${n}","Status":"running(3)"}`).join(',');
    fs.writeFileSync(
      path.join(dir, 'docker'),
      `#!/usr/bin/env bash\ncase "$*" in *"compose ls"*) printf '%s\\n' '[${json}]' ;; *) exit 0 ;; esac\n`,
    );
    fs.chmodSync(path.join(dir, 'docker'), 0o755);
    return dir;
  };

  it('`brabo-dev` (o compose de DEV, ADR 0170) não conta como instalação anterior', () => {
    const r = rodar('detectar_por_sinais', { path: dockerQueLista(['brabo-dev', 'outro']) });
    expect(r.saida).not.toContain('compose:');
  });

  it('`brabo` conta, e só ele', () => {
    const r = rodar('detectar_por_sinais', { path: dockerQueLista(['brabo-dev', 'brabo']) });
    expect(r.saida).toContain('compose:brabo');
    expect(r.saida).not.toContain('brabo-dev');
  });

  const migrar = (resposta: string) => {
    const dir = dockerQueLista([]);
    const prova = path.join(tmp, 'prova-ok.sh');
    fs.writeFileSync(prova, 'exit 0\n');
    return rodar(
      `materializar_os_arquivos_da_instalacao() { :; }
COMPOSE_DE_INSTALACAO=/dev/null; PROVA_DE_RESTAURACAO='${prova}'
migrar_instalacao_anterior '${tmp}/backup'
printf 'MIGRAR_DE=[%s]\\n' "$MIGRAR_DE"`,
      { entrada: `${resposta}\n`, path: dir },
    );
  };

  it('"z" apaga DEPOIS da prova e não restaura: MIGRAR_DE fica vazio, e o backup é nomeado', () => {
    const r = migrar('z');
    expect(r.codigo, r.saida).toBe(0);
    expect(r.saida.indexOf('backup provado')).toBeGreaterThan(-1);
    expect(r.saida.indexOf('backup provado')).toBeLessThan(r.saida.indexOf('volumes removidos'));
    expect(r.saida).toContain('reinstalação do zero: nada será restaurado');
    expect(r.saida).toContain('MIGRAR_DE=[]');
  });

  it('"s" segue restaurando, como antes', () => {
    const r = migrar('s');
    expect(r.saida).toContain(`MIGRAR_DE=[${tmp}/backup]`);
  });

  it('Enter não apaga nada', () => {
    const r = migrar('');
    expect(r.saida).toContain('Nada foi apagado');
    expect(r.saida).not.toContain('volumes removidos');
  });

  it('o fechamento não promete mais o pareamento pela tela do projeto (ADR 0203)', () => {
    expect(fs.readFileSync(SCRIPT, 'utf8')).not.toContain('continua existindo (ADR 0118)');
  });
});
