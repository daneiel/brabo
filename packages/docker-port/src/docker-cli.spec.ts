import { describe, expect, it } from 'vitest';
import {
  ComandoDeDockerFalhouError,
  DockerCliAusenteError,
  DockerViaCli,
  rodarDockerDeVerdade,
  type ResultadoDoCli,
  type RodarDocker,
} from './docker-cli.ts';
import {
  ContainerAusenteError,
  ContainerNaoGerenciadoError,
  DockerIndisponivelError,
  raizDeProjetoValidada,
  ROTULO_GERENCIADO,
  type EspecificacaoDeContainer,
} from './docker-port.ts';

/**
 * Nenhum `docker` roda aqui: o duplo é a função `RodarDocker`, que é o ÚNICO
 * ponto de contato do adaptador com o mundo. O que ele exercita, então, é o
 * que dá para errar sem um daemon — quais argumentos são montados (é ali que
 * mora a contenção: `--cap-drop ALL`, um bind só, rede de dois valores) e como
 * cada falha é CLASSIFICADA.
 *
 * O caminho contra um daemon de verdade é o `--self-test-docker` dos smokes
 * (`pnpm --filter runner smoke` / `smoke:bin`), que roda o artefato
 * empacotado. Esta suíte não o substitui, e a divisão é a de sempre no
 * repositório: unidade prova a decisão, smoke prova o artefato.
 */

const SPEC: EspecificacaoDeContainer = {
  workspaceDirName: 'exp002-f52be111',
  projectId: 'f52be111-0000-0000-0000-000000000000',
  projectSlug: 'exp002',
  workspaceId: 'aaaa1111-0000-0000-0000-000000000000',
  imagem: 'node:24-bookworm',
  imagemVersao: '3',
  rede: 'egress',
  raizDoProjeto: raizDeProjetoValidada('/home/alguem/dev/exp002'),
  cpus: 2,
  memoriaMb: 2048,
  pidsLimit: 512,
};

const OK: ResultadoDoCli = { exitCode: 0, stdout: '', stderr: '', timedOut: false };

function comSaida(stdout: string): ResultadoDoCli {
  return { ...OK, stdout };
}

function linhaDePs(nome: string, estado: string, id = 'c0ffee'): string {
  return JSON.stringify({ ID: id, Names: `/${nome}`, State: estado });
}

/**
 * Duplo com ROTEIRO por prefixo de argumentos: cada chamada é registrada e a
 * resposta vem da primeira regra que casa. Roteiro por prefixo, e não por
 * ordem, porque a ordem das chamadas internas (`ps` gerenciado, `ps` homônimo,
 * ação) é detalhe de implementação — um teste preso a ela reprovaria numa
 * refatoração que não muda comportamento nenhum.
 */
function duplo(
  regras: Array<{ quando: readonly string[]; entao: ResultadoDoCli }>,
): { rodar: RodarDocker; chamadas: string[][] } {
  const chamadas: string[][] = [];
  const rodar: RodarDocker = async (args) => {
    chamadas.push([...args]);
    const regra = regras.find((r) => r.quando.every((parte, i) => args[i] === parte));
    // Sem regra que case, o duplo responde SUCESSO VAZIO — o padrão certo aqui
    // é o que não inventa falha: cada teste declara só a chamada que ele
    // exercita, e uma falha inesperada apareceria como asserção quebrada, não
    // como erro de um comando que o teste nem pretendia cobrir.
    return regra?.entao ?? OK;
  };
  return { rodar, chamadas };
}

describe('DockerViaCli.start', () => {
  it('cria o container com rótulo gerenciado, UM bind e as capabilities derrubadas', async () => {
    const { rodar, chamadas } = duplo([
      { quando: ['ps'], entao: comSaida('') },
      { quando: ['run'], entao: comSaida('c0ffeebabe\n') },
    ]);

    const iniciado = await new DockerViaCli(rodar).start(SPEC);

    expect(iniciado).toEqual({
      containerId: 'c0ffeebabe',
      nome: 'brabo-exp002-f52be111',
      jaEstavaDePe: false,
    });

    const run = chamadas.find((c) => c[0] === 'run');
    expect(run).toBeDefined();
    const args = run as string[];
    expect(args).toContain('--detach');
    expect(args.join(' ')).toContain(`--label ${ROTULO_GERENCIADO}=true`);
    // UM volume, destino constante. Se um dia aparecer um segundo `--volume`,
    // este número é o que reprova.
    expect(args.filter((a) => a === '--volume')).toHaveLength(1);
    expect(args).toContain('/home/alguem/dev/exp002:/work:rw');
    expect(args.join(' ')).toContain('--cap-drop ALL');
    expect(args.join(' ')).toContain('--network bridge');
    expect(args.join(' ')).toContain('--cpus 2');
    expect(args.join(' ')).toContain('--memory 2048m');
    // Fork bomb é shell puro e não precisa de comando reconhecível — o teto de
    // processos é a contenção que não depende de reconhecer nada (ADR 0130).
    expect(args.join(' ')).toContain('--pids-limit 512');
    // Nada disto pode aparecer — e como o TIPO não deixa escrevê-los, este
    // teste tranca a única forma que sobra de eles entrarem: alguém somar a
    // opção à mão aqui dentro.
    expect(args).not.toContain('--privileged');
    expect(args).not.toContain('--cap-add');
    expect(args.join(' ')).not.toContain('--network host');
  });

  it('rede `none` vira `--network none`', async () => {
    const { rodar, chamadas } = duplo([
      { quando: ['ps'], entao: comSaida('') },
      { quando: ['run'], entao: comSaida('c0ffee\n') },
    ]);

    await new DockerViaCli(rodar).start({ ...SPEC, rede: 'none' });

    const run = chamadas.find((c) => c[0] === 'run') as string[];
    expect(run.join(' ')).toContain('--network none');
  });

  it('container já de pé não é recriado, e o chamador sabe que não subiu nada', async () => {
    const { rodar, chamadas } = duplo([
      { quando: ['ps'], entao: comSaida(linhaDePs('brabo-exp002-f52be111', 'running')) },
    ]);

    const iniciado = await new DockerViaCli(rodar).start(SPEC);

    expect(iniciado.jaEstavaDePe).toBe(true);
    expect(chamadas.some((c) => c[0] === 'run')).toBe(false);
  });

  it('container parado com o mesmo nome é RELIGADO, nunca recriado', async () => {
    const { rodar, chamadas } = duplo([
      { quando: ['ps'], entao: comSaida(linhaDePs('brabo-exp002-f52be111', 'exited')) },
    ]);

    const iniciado = await new DockerViaCli(rodar).start(SPEC);

    expect(iniciado.jaEstavaDePe).toBe(false);
    expect(chamadas.some((c) => c[0] === 'start')).toBe(true);
    expect(chamadas.some((c) => c[0] === 'run')).toBe(false);
  });
});

describe('DockerViaCli — o rótulo brabo.managed é a fronteira', () => {
  it('recusa agir sobre container homônimo SEM o rótulo, em vez de tratá-lo como ausente', async () => {
    // O primeiro `ps` (filtrado por rótulo) não acha nada; o segundo (só por
    // nome) acha — é exatamente o container de outra pessoa.
    let chamadasDePs = 0;
    const rodar: RodarDocker = async (args) => {
      if (args[0] === 'ps') {
        chamadasDePs += 1;
        return chamadasDePs === 1
          ? comSaida('')
          : comSaida(linhaDePs('brabo-exp002-f52be111', 'running', 'alheio'));
      }
      return OK;
    };

    await expect(new DockerViaCli(rodar).stop('exp002-f52be111')).rejects.toThrowError(
      ContainerNaoGerenciadoError,
    );
  });

  it('a busca do container SEMPRE filtra pelo rótulo', async () => {
    const { rodar, chamadas } = duplo([{ quando: ['ps'], entao: comSaida('') }]);

    await new DockerViaCli(rodar).stop('exp002-f52be111');

    const primeiroPs = chamadas.find((c) => c[0] === 'ps') as string[];
    expect(primeiroPs.join(' ')).toContain(`--filter label=${ROTULO_GERENCIADO}=true`);
    expect(primeiroPs.join(' ')).toContain('--filter name=^/brabo-exp002-f52be111$');
  });

  it('parar o que não existe é no-op, não erro', async () => {
    const { rodar, chamadas } = duplo([{ quando: ['ps'], entao: comSaida('') }]);

    await expect(new DockerViaCli(rodar).stop('exp002-f52be111')).resolves.toBeUndefined();
    expect(chamadas.some((c) => c[0] === 'stop')).toBe(false);
  });
});

describe('DockerViaCli.inspect', () => {
  it('devolve o estado OBSERVADO do daemon', async () => {
    const { rodar } = duplo([
      { quando: ['ps'], entao: comSaida(linhaDePs('brabo-exp002-f52be111', 'running')) },
      {
        quando: ['inspect'],
        entao: comSaida(
          JSON.stringify({
            Id: 'c0ffee',
            Name: '/brabo-exp002-f52be111',
            Config: { Image: 'node:24-bookworm' },
            State: { Status: 'running', StartedAt: '2026-09-01T10:00:00.000Z' },
          }),
        ),
      },
    ]);

    await expect(new DockerViaCli(rodar).inspect('exp002-f52be111')).resolves.toEqual({
      containerId: 'c0ffee',
      nome: 'brabo-exp002-f52be111',
      estado: 'running',
      imagem: 'node:24-bookworm',
      iniciadoEm: '2026-09-01T10:00:00.000Z',
    });
  });

  it('ausência é `null`, e não um estado inventado', async () => {
    const { rodar } = duplo([{ quando: ['ps'], entao: comSaida('') }]);
    await expect(new DockerViaCli(rodar).inspect('exp002-f52be111')).resolves.toBeNull();
  });

  it('a data zero do daemon vira `null` — ano 1 numa tela é pior que ausência declarada', async () => {
    const { rodar } = duplo([
      { quando: ['ps'], entao: comSaida(linhaDePs('brabo-exp002-f52be111', 'created')) },
      {
        quando: ['inspect'],
        entao: comSaida(
          JSON.stringify({
            Id: 'c0ffee',
            Config: { Image: 'node:24-bookworm' },
            State: { Status: 'created', StartedAt: '0001-01-01T00:00:00Z' },
          }),
        ),
      },
    ]);

    const observado = await new DockerViaCli(rodar).inspect('exp002-f52be111');
    expect(observado?.iniciadoEm).toBeNull();
    expect(observado?.estado).toBe('created');
  });
});

describe('DockerViaCli.exec', () => {
  it('roda o comando como UM argumento de `sh -c`, com o workdir do bind', async () => {
    const { rodar, chamadas } = duplo([
      { quando: ['ps'], entao: comSaida(linhaDePs('brabo-exp002-f52be111', 'running')) },
      { quando: ['exec'], entao: { ...OK, stdout: 'ola brabo' } },
    ]);

    const resultado = await new DockerViaCli(rodar).exec('exp002-f52be111', {
      comando: 'echo -n "ola brabo" && exit 0',
    });

    expect(resultado).toEqual({ exitCode: 0, output: 'ola brabo', timedOut: false });
    const exec = chamadas.find((c) => c[0] === 'exec') as string[];
    expect(exec.slice(-3)).toEqual(['/bin/sh', '-c', 'echo -n "ola brabo" && exit 0']);
    expect(exec.join(' ')).toContain('--workdir /work');
  });

  it('combina stdout e stderr, como o executor da máquina faz', async () => {
    const { rodar } = duplo([
      { quando: ['ps'], entao: comSaida(linhaDePs('brabo-exp002-f52be111', 'running')) },
      { quando: ['exec'], entao: { exitCode: 3, stdout: 'out', stderr: 'err', timedOut: false } },
    ]);

    const resultado = await new DockerViaCli(rodar).exec('exp002-f52be111', { comando: 'x' });
    expect(resultado.output).toBe('outerr');
    expect(resultado.exitCode).toBe(3);
  });

  it('trunca a saída no teto, com marca que declara o tamanho REAL', async () => {
    const { rodar } = duplo([
      { quando: ['ps'], entao: comSaida(linhaDePs('brabo-exp002-f52be111', 'running')) },
      { quando: ['exec'], entao: comSaida('a'.repeat(500)) },
    ]);

    const resultado = await new DockerViaCli(rodar).exec('exp002-f52be111', {
      comando: 'x',
      maxBytes: 100,
    });

    expect(resultado.output.startsWith('a'.repeat(100))).toBe(true);
    expect(resultado.output).toContain('100 de 500 bytes');
  });

  it('timeout devolve o sentinela -1 e DIZ que o processo pode ter sobrevivido', async () => {
    const { rodar } = duplo([
      { quando: ['ps'], entao: comSaida(linhaDePs('brabo-exp002-f52be111', 'running')) },
      { quando: ['exec'], entao: { exitCode: -1, stdout: '', stderr: '', timedOut: true } },
    ]);

    const resultado = await new DockerViaCli(rodar).exec('exp002-f52be111', {
      comando: 'sleep 60',
      timeoutMs: 200,
    });

    expect(resultado.timedOut).toBe(true);
    expect(resultado.exitCode).toBe(-1);
    expect(resultado.output).toContain('pode continuar rodando DENTRO do container');
  });

  it('sem container de pé não há onde executar — lança em vez de devolver saída vazia', async () => {
    const { rodar } = duplo([
      { quando: ['ps'], entao: comSaida(linhaDePs('brabo-exp002-f52be111', 'exited')) },
    ]);

    await expect(
      new DockerViaCli(rodar).exec('exp002-f52be111', { comando: 'x' }),
    ).rejects.toThrowError(ContainerAusenteError);
  });
});

describe('DockerViaCli — falha classificada, nunca stack trace cru', () => {
  it('daemon fora vira DockerIndisponivelError, com origem infra e o que fazer', async () => {
    // `docker version` reprova: é ele quem responde "o cliente alcança o
    // servidor?", e é por ele que a classificação passa — nunca por substring
    // da mensagem de um comando qualquer.
    const rodar: RodarDocker = async () => ({
      exitCode: 1,
      stdout: '',
      stderr: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock.',
      timedOut: false,
    });

    const erro = await new DockerViaCli(rodar, '/var/run/docker.sock')
      .ping()
      .catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(DockerIndisponivelError);
    const indisponivel = erro as DockerIndisponivelError;
    expect(indisponivel.origem).toBe('infra');
    expect(indisponivel.name).toBe('DockerIndisponivelError');
    expect(indisponivel.endereco).toBe('/var/run/docker.sock');
    // A mensagem ENSINA — é lida por quem está na frente da própria máquina.
    expect(indisponivel.message).toContain('docker info');
    expect(indisponivel.message).toContain('grupo `docker`');
    expect(indisponivel.message).toContain('Nenhum container foi tocado');
  });

  it('daemon fora no meio de uma operação também vira o erro NOMEADO', async () => {
    // Toda chamada falha — inclusive o `version` de confirmação, que é como o
    // adaptador separa "daemon fora" de "daemon recusou este comando".
    const rodar: RodarDocker = async () => ({
      exitCode: 1,
      stdout: '',
      stderr: 'Cannot connect to the Docker daemon',
      timedOut: false,
    });

    await expect(new DockerViaCli(rodar).start(SPEC)).rejects.toThrowError(DockerIndisponivelError);
  });

  it('daemon VIVO que recusa o comando não vira falha de infra — o motivo dele é repassado', async () => {
    const rodar: RodarDocker = async (args) => {
      if (args[0] === 'version') return OK; // o daemon está lá
      if (args[0] === 'ps') return comSaida('');
      return {
        exitCode: 125,
        stdout: '',
        stderr: 'docker: Error response from daemon: No such image: node:24-bookworm',
        timedOut: false,
      };
    };

    const erro = await new DockerViaCli(rodar)
      .start(SPEC)
      .catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ComandoDeDockerFalhouError);
    const falha = erro as ComandoDeDockerFalhouError;
    expect(falha.exitCode).toBe(125);
    expect(falha.message).toContain('No such image');
    // Sem `origem`: classificar isto seria diagnóstico por eliminação, que é o
    // que o ADR 0020 registra como o defeito a não repetir.
    expect('origem' in falha).toBe(false);
  });

  it('o executável `docker` ausente é um erro PRÓPRIO, não "daemon fora"', async () => {
    // O ÚNICO teste desta suíte que executa `execFile` de verdade — e ele
    // existe porque os dois casos parecem o mesmo para quem lê "não consegui
    // falar com o Docker", e se consertam de formas diferentes: instalar o
    // Docker, ou subir o daemon. É a mesma lição da RN-475 (chave ausente vs.
    // chave recusada), aplicada um andar abaixo.
    //
    // `PATH` vazio é o que torna o caso REPRODUZÍVEL numa máquina que TEM
    // Docker instalado — sem ele, este teste só passaria onde não há docker,
    // que é justamente onde ninguém o roda.
    const pathOriginal = process.env.PATH;
    process.env.PATH = '';
    try {
      const erro = await rodarDockerDeVerdade(['version'], 5_000).catch((e: unknown) => e);
      expect(erro).toBeInstanceOf(DockerCliAusenteError);
      const ausente = erro as DockerCliAusenteError;
      expect(ausente.origem).toBe('infra');
      expect(ausente.message).toContain('não encontrei o executável `docker`');
      expect(ausente.message).toContain('Nenhum container foi tocado');
    } finally {
      process.env.PATH = pathOriginal;
    }
  });
});
