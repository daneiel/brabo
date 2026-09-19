import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// O E2E do instalador numa MÁQUINA LIMPA (RN-549, sessão 8 da FASE 30) mora em
// `.github/workflows/install-e2e.yml`, e ele NÃO roda em `pull_request` — o
// instalador verifica a própria origem contra o `checksums.txt` assinado de uma
// Release (RN-526), que só existe depois de uma tag final, e a única forma de
// fazê-lo rodar em PR seria dar-lhe uma porta para PULAR a verificação: a porta
// que o ADR 0150 recusa.
//
// Disso decorre ESTE arquivo. Um workflow que só roda em tag é um workflow cujo
// erro aparece na tag — quando o release já está saindo, e quando ninguém está
// olhando para o PR que o quebrou. Estes testes são a única coisa da sessão 8
// que roda em PR, e por isso eles medem exatamente as duas maneiras conhecidas
// de esse E2E apodrecer em silêncio:
//
//   1. alguém AFROUXA o gate — põe `pull_request` no gatilho, ou passa ao
//      script uma flag de pular verificação — para "ver o E2E rodar";
//   2. alguém REESCREVE uma frase do `install.sh`, e todo `grep` do workflow
//      passa a não casar nada. As asserções não falham: elas somem, e o job
//      segue verde provando menos do que na véspera.
//
// O que eles NÃO fazem, e é preciso dizer: não rodam o instalador, não sobem
// compose e não provam integração nenhuma. Isso é o workflow, e só a tag o
// executa.

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WORKFLOW = path.join(RAIZ, '.github/workflows/install-e2e.yml');
const INSTALADOR = path.join(RAIZ, 'install.sh');

const workflow = () => fs.readFileSync(WORKFLOW, 'utf8');
const instalador = () => fs.readFileSync(INSTALADOR, 'utf8');

/**
 * Os `run:` do job, sem os comentários do YAML ao redor. A distinção importa:
 * quase toda decisão deste workflow está escrita num comentário, e um teste que
 * procurasse no TEXTO INTEIRO passaria por causa da prosa que explica por que
 * algo NÃO é feito — que é exatamente o contrário do que ele quer medir.
 */
function passos(): ReadonlyArray<{ name: string; run: string }> {
  const doc = parse(workflow()) as {
    jobs: Record<string, { steps?: ReadonlyArray<{ name?: string; run?: string }> }>;
  };
  return Object.values(doc.jobs)
    .flatMap((job) => job.steps ?? [])
    .filter((passo): passo is { name: string; run: string } =>
      typeof passo.run === 'string' && typeof passo.name === 'string',
    );
}

function passo(trecho: string): { name: string; run: string } {
  const achado = passos().find((p) => p.name.includes(trecho));
  if (!achado) throw new Error(`não achei o passo cujo nome contém ${JSON.stringify(trecho)}`);
  return achado;
}

/** O `run:` inteiro, menos as linhas de comentário de shell. */
function comandos(p: { run: string }): string {
  return p.run
    .split('\n')
    .filter((linha) => !/^\s*#/.test(linha))
    .join('\n');
}

/**
 * As frases do `install.sh` que o workflow procura na saída, e o elo que cada
 * uma prova. Elas são o CONTRATO entre os dois arquivos: o workflow afirma a
 * instalação inteira por meio delas, e uma frase reescrita de um lado sem o
 * outro transforma cada asserção num `grep` que nunca casa.
 *
 * A lista é escrita aqui, e não derivada do workflow, de propósito: derivar
 * faria o teste concordar com o workflow por construção — inclusive quando o
 * workflow tivesse PERDIDO uma asserção. Escrita, ela cobra os dois lados.
 */
const ELOS_DO_FECHAMENTO: ReadonlyArray<{ elo: string; frase: string }> = [
  { elo: 'RN-546 — a primeira conta nasce verificada', frase: 'conta criada e já verificada' },
  { elo: 'RN-551 — o par Ed25519 nasce na máquina', frase: 'par Ed25519 gerado nesta máquina' },
  { elo: 'RN-552 — só a pública viaja, e a api devolve o id', frase: 'chave registrada na api (id ' },
  { elo: 'RN-551 — o id vira o kid da privada', frase: 'chave completa em ' },
  {
    elo: 'RN-545 — a unit por MÁQUINA',
    frase: 'agente local instalado como serviço desta máquina',
  },
];

/** As outras frases do instalador de que o workflow depende, pelo mesmo motivo. */
const OUTRAS_FRASES_ASSERIDAS: readonly string[] = [
  // FASE 29, já provadas antes desta sessão.
  'assinatura do manifesto confere',
  'este arquivo é o que a Release publicou',
  'Sem terminal interativo',
  // AT-083: o relato sem TTY ensina BAIXAR e rodar com bash.
  'curl -fsSLO',
  // RN-570: os arquivos da instalação vêm da Release, conferidos, e é o próprio
  // instalador que os grava.
  'arquivos da instalação verificados contra o manifesto assinado',
  'arquivos da instalação gravados em ',
  // ADR 0162: o broker ligado com consentimento, medido, e alcançado pela api.
  'grupo do socket, visto de dentro de um container: ',
  'broker de container: ligado',
  'a api alcança o broker pela rede interna',
  'a raiz da pasta gerenciada confere com o volume',
  // A prova NEGATIVA da RN-547: nenhuma pendência é o que afirma que os cinco
  // elos fecharam, inclusive os que o workflow não sabe nomear.
  'O que ficou pendente',
];

/**
 * As linhas que o AGENTE escreve no journal, e que o workflow espera para
 * afirmar as duas coisas que só elas provam: que ele ficou de pé esperando
 * (RN-550) e que pegou o primeiro projeto que apareceu.
 *
 * Elas são do `apps/runner`, não do `install.sh` — e é por isso que o teste as
 * procura lá. Mudar o texto dessas duas linhas é mudar o que o E2E consegue
 * medir, e nada mais no repositório diria isso.
 */
const INDEX_DO_RUNNER = path.join(RAIZ, 'apps/runner/src/index.ts');
const ESPERA_DO_RUNNER = path.join(RAIZ, 'apps/runner/src/espera-de-projetos.ts');

/**
 * Prompts interativos do `install.sh` — `read -r` que NÃO é `while IFS= read`.
 * O driver de TTY do workflow responde a eles por uma LISTA, em ordem, esperando
 * o trecho de cada pergunta; um prompt novo no meio faz o driver esperar até o
 * teto por uma pergunta que já passou, e a instalação falharia por um motivo que
 * não tem nada a ver com o que se quer medir. Não dá para derivar quais deles disparam numa máquina limpa (depende
 * de estado em runtime), mas dá para saber que o CONJUNTO mudou — e isso basta
 * para mandar alguém olhar o arquivo de respostas.
 */
const PROMPTS_INTERATIVOS = 9;

describe('o E2E do instalador não pode ser afrouxado para passar', () => {
  it('NÃO roda em `pull_request` — a porta de pular a verificação é a que o ADR 0150 recusa', () => {
    // Lido do DOCUMENTO e não do texto: `on` é chave, e procurar
    // "pull_request" no arquivo inteiro casaria com o comentário que explica
    // por que ele não está lá.
    const doc = parse(workflow()) as Record<string, unknown>;
    const gatilhos = (doc.on ?? doc.true) as Record<string, unknown>;

    expect(Object.keys(gatilhos)).not.toContain('pull_request');
    expect(Object.keys(gatilhos).sort()).toEqual(['push', 'workflow_dispatch']);
    expect((gatilhos.push as { tags: string[] }).tags).toBeTruthy();
  });

  it('não passa ao instalador nenhuma flag que pule a verificação de origem', () => {
    const texto = workflow();
    // O instalador não tem essas flags; o teste existe para que continuar sem
    // elas seja uma decisão medida, e não um acidente que alguém desfaz num PR
    // que "só queria ver o E2E rodar".
    for (const porta of [
      '--skip-verify',
      '--no-verify',
      '--insecure',
      'SKIP_VERIFY',
      'BRABO_SKIP_VERIFY',
    ]) {
      expect(texto).not.toContain(porta);
      expect(instalador()).not.toContain(porta);
    }
  });

  it('roda o instalador BAIXADO da Release, nunca o do checkout — e pela forma que o runbook manda', () => {
    // AT-083: a forma documentada passou a ser BAIXAR um arquivo e rodá-lo com
    // `bash` (`curl -fsSLO … && bash install.sh`). O E2E exercita a MESMA forma
    // — `curl -fsSLO` da Release da tag, e `bash install.sh` em todo passo —,
    // porque uma prova que roda o instalador de outro jeito prova outra coisa.
    const baixar = comandos(passo('Baixar o instalador publicado'));
    expect(baixar).toContain('curl -fsSLO "https://github.com/${GITHUB_REPOSITORY}/releases/download/${TAG}/install.sh"');
    expect(baixar).not.toContain('chmod +x');

    for (const p of passos()) {
      const texto = comandos(p);
      expect(texto, p.name).not.toContain('./install.sh');
      expect(texto, p.name).not.toMatch(/sh -c "\$\(curl/);
    }
    expect(comandos(passo('O plano e o estado'))).toContain('bash install.sh --print-state');
    expect(comandos(passo('Sem TTY'))).toContain('bash install.sh < /dev/null');
    expect(comandos(passo('Instalação completa'))).toContain('bash install.sh --source=ghcr');
  });
});

describe('as frases de que o E2E depende continuam existindo', () => {
  it.each(ELOS_DO_FECHAMENTO)(
    'o elo "$elo" é asserido pelo workflow E dito pelo instalador',
    ({ frase }) => {
      expect(instalador()).toContain(frase);
      expect(workflow()).toContain(frase);
    },
  );

  it.each(OUTRAS_FRASES_ASSERIDAS)('a frase %s ainda existe nos dois lados', (frase) => {
    expect(instalador()).toContain(frase);
    expect(workflow()).toContain(frase);
  });

  it('a linha que prova o agente ESPERANDO é a do runner, e o workflow espera por ela', () => {
    // Só existe depois de o agente ter lido a chave de máquina, tirado ticket,
    // falado com a api e recebido lista VAZIA: ela prova pareamento e espera de
    // uma vez, e é um fato gravado — nunca uma amostragem de estado, que é o
    // que faria `systemctl is-active` ser uma corrida.
    expect(fs.readFileSync(INDEX_DO_RUNNER, 'utf8')).toContain('FICA DE PÉ');
    expect(workflow()).toContain('FICA DE PÉ');
  });

  it('a linha que prova o agente PEGANDO o primeiro projeto é a da espera', () => {
    expect(fs.readFileSync(ESPERA_DO_RUNNER, 'utf8')).toContain('a espera ACABA');
    expect(workflow()).toContain('a espera ACABA');
  });
});

describe('as respostas do TTY simulado acompanham os prompts do instalador', () => {
  it('o conjunto de prompts interativos não mudou sem o arquivo de respostas mudar', () => {
    const prompts = instalador()
      .split('\n')
      .filter((linha) => linha.includes('read -r') && !linha.includes('while IFS= read'));

    expect(
      prompts.length,
      'o `install.sh` ganhou ou perdeu um prompt interativo. As respostas do E2E vão por ' +
        'ARQUIVO, em ordem, e um prompt a mais desalinha todas as seguintes — a base viraria ' +
        'a senha. Reveja o `printf` do passo "Instalação completa" em ' +
        '.github/workflows/install-e2e.yml e atualize PROMPTS_INTERATIVOS aqui.',
    ).toBe(PROMPTS_INTERATIVOS);
  });

  it('a primeira resposta é a do MARCADOR, que é o primeiro `read` de uma máquina limpa', () => {
    // A pergunta de MIGRAÇÃO está sob `if [ -n "$marcador" ] || [ -n "$sinais" ]`,
    // e numa máquina limpa os dois são vazios: ela não acontece. O arquivo de
    // respostas começava por `nao-migrar`, que caía na pergunta do marcador —
    // ela não casa `s|S|sim|SIM`, o script dizia "Nada foi gravado" e saía 0, e
    // a asserção do marcador teria reprovado. Nunca apareceu porque o workflow
    // só roda em tag e ainda não rodou nenhuma.
    const instalacao = comandos(passo('Instalação completa'));
    expect(instalacao).not.toContain('nao-migrar');
    const lista = respostasDoWorkflow();
    expect(lista[0]).toEqual({ espera: 'Gravar o marcador de instalação', resposta: '"s"', segredo: false });
    expect(lista[1]?.espera).toBe('Base [');
  });

  it('a pergunta do broker vem DEPOIS da base e o E2E responde SIM (ADR 0162)', () => {
    // Depois da base porque é na ordem dos `read` do script (`consentir_broker`
    // roda logo depois de `consentir_base`). SIM porque só assim o E2E exercita
    // o que a pergunta promete: a imagem publicada, o gid medido e a api
    // alcançando o broker — e o runner Linux da tag tem Docker para isso.
    const lista = respostasDoWorkflow();
    expect(lista[2]).toEqual({
      espera: 'Ligar o broker de container? [s/N] ',
      resposta: '"s"',
      segredo: false,
    });
    const texto = instalador();
    expect(texto.indexOf('\n  consentir_base\n')).toBeGreaterThan(0);
    expect(texto.indexOf('\n  consentir_broker\n')).toBeGreaterThan(
      texto.indexOf('\n  consentir_base\n'),
    );
  });

  it('cada pergunta que o driver espera EXISTE no install.sh, e as duas de senha são segredo', () => {
    // O driver espera o TRECHO da pergunta aparecer antes de responder. Um
    // trecho que o instalador deixou de imprimir não desalinha nada: ele faz o
    // driver esperar até o teto e parar com código 3, nomeando a pergunta — mas
    // só na tag. Aqui, em PR.
    const lista = respostasDoWorkflow();
    expect(lista).toHaveLength(8);
    for (const { espera } of lista) {
      expect(instalador(), `o install.sh não imprime mais: ${espera}`).toContain(espera);
    }
    expect(lista.filter((r) => r.segredo).map((r) => r.espera)).toEqual([
      'Senha (não aparece na tela): ',
      'Repita a senha: ',
    ]);
    // A senha chega pelo AMBIENTE, nunca por argv.
    expect(lista.filter((r) => r.segredo).every((r) => r.resposta === 'env.E2E_SENHA')).toBe(true);
    expect(comandos(passo('Instalação completa'))).not.toContain('--arg senha');
  });
});

describe('o E2E prova o agente, e diz o que ele NÃO prova', () => {
  it('mede a unit de MÁQUINA e recusa unit por projeto', () => {
    const dePe = comandos(passo('está DE PÉ'));
    expect(dePe).toContain('brabo-runner.service');
    expect(dePe).toContain('brabo-runner-*.service');
  });

  it('confere `service status --machine` DEPOIS da linha do journal, não no lugar dela', () => {
    // A ordem É a asserção: `perguntarEstado` mapeia `activating` para
    // `rodando`, então perguntar ao gerenciador ANTES de o processo ter dito
    // qualquer coisa dá verde a quem vai morrer em dois segundos.
    const dePe = comandos(passo('está DE PÉ'));
    expect(dePe.indexOf('FICA DE PÉ')).toBeGreaterThanOrEqual(0);
    expect(dePe.indexOf('FICA DE PÉ')).toBeLessThan(dePe.indexOf('service status --machine'));
  });

  it('cria o primeiro projeto em modo runner pela api do próprio dono', () => {
    const primeiro = comandos(passo('primeiro projeto em modo Runner'));
    expect(primeiro).toContain('executionMode: "runner"');
    expect(primeiro).toContain('/workspaces/${ws}/projects');
    // A senha nunca em `argv` — nem no `curl`, nem no `jq`: o instalador tem
    // essa régua (RN-547) e o E2E que o mede não pode ser mais frouxo que ele.
    expect(primeiro).toContain('env.E2E_SENHA');
    expect(primeiro).not.toContain('--arg senha');
  });

  it('não traz mais à mão os arquivos da instalação — e afirma que o instalador os trouxe', () => {
    // O achado da sessão 8 (RN-549): o compose de instalação e os dois arquivos
    // que ele monta não viajavam com o `install.sh`, e o workflow os trazia da
    // tag num passo "achado declarado". Este teste cobrava as DUAS metades —
    // o passo existir E o instalador não baixar — para o contorno não virar o
    // normal. Desde a RN-570 (ADR 0160) o instalador os baixa e confere contra
    // o manifesto assinado, e a cobrança se INVERTE: o contorno não pode voltar.
    const nomes = passos().map((p) => p.name);
    expect(nomes.some((n) => n.includes('achado declarado'))).toBe(false);
    for (const p of passos()) {
      expect(comandos(p), p.name).not.toContain('raw.githubusercontent.com');
    }

    // A pasta começa SEM `docker/` — o job não tem checkout —, e o passo que
    // afirma isso vem antes de qualquer execução do instalador.
    const limpa = comandos(passo('Nenhum arquivo da instalação trazido à mão'));
    expect(limpa).toContain('test ! -e docker');
    const ordem = passos().map((p) => p.name);
    expect(ordem.indexOf('Nenhum arquivo da instalação trazido à mão')).toBeLessThan(
      ordem.findIndex((n) => n.includes('Sem TTY')),
    );

    // Sem TTY, nas duas plataformas: verificou, e não gravou nada na pasta.
    const semTty = comandos(passo('Sem TTY'));
    expect(semTty).toContain('arquivos da instalação verificados contra o manifesto assinado');
    expect(semTty).toContain('test ! -e docker');

    // Com TTY: gravou, e o que gravou é byte a byte o que a Release assinou.
    const completa = comandos(passo('Instalação completa'));
    expect(completa).toContain('arquivos da instalação gravados em ');
    const conferencia = comandos(passo('são os que a Release assinou'));
    expect(conferencia).toContain('--pattern checksums.txt');
    expect(conferencia).toContain('sha256sum -c --strict');
    for (const asset of [
      'brabo-install-compose.yml',
      'brabo-install-postgres-init.sql',
      'brabo-install-ollama-pull-models.sh',
      'brabo-install-backup-test-restore.sh',
    ]) {
      expect(conferencia).toContain(asset);
      // E do outro lado do contrato: o instalador baixa este nome.
      expect(instalador()).toContain(asset);
    }

    // O instalador não guarda mais caminho relativo de compose.
    expect(instalador()).not.toContain("COMPOSE_DE_INSTALACAO='docker/docker-compose.install.yml'");
  });

  it('o token que baixa o manifesto não está no ambiente do instalador', () => {
    // A conferência precisa de `GH_TOKEN`; o instalador não. Por isso ela é um
    // passo à parte, e o passo que roda o instalador não declara `env:`.
    const doc = parse(workflow()) as {
      jobs: Record<string, { steps: ReadonlyArray<{ name?: string; env?: Record<string, string> }> }>;
    };
    const instalacao = Object.values(doc.jobs)
      .flatMap((j) => j.steps)
      .find((p) => p.name?.includes('Instalação completa'));
    expect(instalacao?.env).toBeUndefined();
  });
});

/**
 * A lista de respostas do driver, lida do `jq -n` do passo — o TRECHO de
 * pergunta que cada uma espera, a expressão que a produz e se é segredo.
 */
function respostasDoWorkflow(): ReadonlyArray<{ espera: string; resposta: string; segredo: boolean }> {
  const run = passo('Instalação completa').run;
  const itens = [...run.matchAll(/\{espera: "([^"]*)", resposta: ([^,}]+)(, segredo: true)?\}/g)];
  return itens.map((m) => ({ espera: m[1]!, resposta: m[2]!.trim(), segredo: Boolean(m[3]) }));
}

/** O driver de PTY do passo, extraído do heredoc — do `run` CRU, com os comentários de Python. */
function driverDoWorkflow(): string {
  const run = passo('Instalação completa').run;
  const m = run.match(/<<'PY'\n([\s\S]*?)\nPY\n/);
  if (!m) throw new Error("não achei o heredoc <<'PY' do driver de TTY no passo 'Instalação completa'");
  return m[1]!;
}

const python = spawnSync('python3', ['--version']).status === 0;
const temScript = spawnSync('script', ['--version']).status === 0;

describe('o TTY do E2E é um TTY para o INSTALADOR (AT-083)', () => {
  // O passo "Instalação completa" rodava `script -qec "… < respostas"`: o `<`
  // ficava DENTRO do `script`, o stdin do instalador era o arquivo, e
  // `[ -t 0 ]` era sempre falso — o fluxo interativo nunca foi exercitado.
  // O workflow não roda em PR, então o driver que o substitui é EXERCITADO
  // aqui: extraído do próprio workflow e rodado contra um instalador de
  // mentira que faz as mesmas coisas que o de verdade — `[ -t 0 ]`, `read -r`
  // e `stty -echo` para as senhas.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brabo-tty-e2e-'));

  const falso = (corpo: string): string => {
    const caminho = path.join(tmp, `falso-${Math.random().toString(36).slice(2)}.sh`);
    fs.writeFileSync(caminho, `#!/usr/bin/env bash\nset -euo pipefail\n${corpo}\n`);
    return caminho;
  };

  const INSTALADOR_FALSO = `
[ -t 0 ] || { echo 'SEM-TTY'; exit 0; }
printf 'Gravar o marcador de instalação em /x? [s/N] '; read -r a; echo "R1=[$a]"
printf 'Base [/home/x]: '; read -r b; echo "R2=[$b]"
printf 'Criar a primeira conta agora? [S/n] '; read -r c; echo "R3=[$c]"
printf 'E-mail: '; read -r e; echo "R4=[$e]"
printf 'Senha (não aparece na tela): '; antigo="$(stty -g)"; stty -echo; read -r s1; stty "$antigo"; printf '\\n'
printf 'Repita a senha: '; antigo="$(stty -g)"; stty -echo; read -r s2; stty "$antigo"; printf '\\n'
printf 'Nome (opcional, Enter para pular): '; read -r n; echo "R7=[$n]"
[ "$s1" = "$s2" ] && echo "SENHAS-IGUAIS tamanho=\${#s1}"
exit 7`;

  const SENHA = 'Xy7-segredo-do-teste-01';
  const respostas = (senhaSemEco = true): string => {
    const arquivo = path.join(tmp, `respostas-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(
      arquivo,
      JSON.stringify([
        { espera: 'Gravar o marcador de instalação', resposta: 's' },
        { espera: 'Base [', resposta: '/home/e2e/projetos-brabo' },
        { espera: 'Criar a primeira conta agora?', resposta: 's' },
        { espera: 'E-mail: ', resposta: 'e2e@example.com' },
        { espera: 'Senha (não aparece na tela): ', resposta: SENHA, segredo: senhaSemEco },
        { espera: 'Repita a senha: ', resposta: SENHA, segredo: senhaSemEco },
        { espera: 'Nome (opcional, Enter para pular): ', resposta: '' },
      ]),
    );
    return arquivo;
  };

  const rodarDriver = (arquivoDeRespostas: string, instalador: string, env: NodeJS.ProcessEnv = {}) => {
    const driver = path.join(tmp, 'terminal-do-e2e.py');
    fs.writeFileSync(driver, driverDoWorkflow());
    const r = spawnSync('python3', ['-I', driver, arquivoDeRespostas, 'bash', instalador], {
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1', ...env },
      timeout: 30_000,
    });
    return { codigo: r.status ?? -1, saida: r.stdout ?? '' };
  };

  it('o instalador vê um terminal, recebe as sete respostas em ordem, e o código de saída dele volta', (ctx) => {
    if (!python) ctx.skip('sem python3 nesta máquina — o driver é Python, e é o mesmo do workflow');
    const r = rodarDriver(respostas(), falso(INSTALADOR_FALSO));
    expect(r.saida).not.toContain('SEM-TTY');
    expect(r.saida).toContain('R1=[s]');
    expect(r.saida).toContain('R2=[/home/e2e/projetos-brabo]');
    expect(r.saida).toContain('R3=[s]');
    expect(r.saida).toContain('R4=[e2e@example.com]');
    expect(r.saida).toContain('R7=[]');
    expect(r.saida).toContain(`SENHAS-IGUAIS tamanho=${SENHA.length}`);
    expect(r.codigo).toBe(7);
  });

  it('a senha NÃO aparece na saída — o driver espera o eco desligar antes de escrevê-la', (ctx) => {
    if (!python) ctx.skip('sem python3 nesta máquina');
    const r = rodarDriver(respostas(), falso(INSTALADOR_FALSO));
    expect(r.saida).not.toContain(SENHA);
  });

  it('pergunta secreta com o eco LIGADO faz o driver parar com 4, sem escrever a senha', (ctx) => {
    if (!python) ctx.skip('sem python3 nesta máquina');
    // O instalador que "esqueceu" o `stty -echo`: o driver é quem recusa, e a
    // senha não chega a ser digitada.
    const semStty = INSTALADOR_FALSO.replace(/stty -echo; /g, '');
    const r = rodarDriver(respostas(), falso(semStty), { TETO_DO_ECO: '1' });
    expect(r.codigo).toBe(4);
    expect(r.saida).toContain('o eco seguia LIGADO');
    expect(r.saida).not.toContain(SENHA);
  });

  it('pergunta que não chega faz o driver parar com 3, NOMEANDO a pergunta', (ctx) => {
    if (!python) ctx.skip('sem python3 nesta máquina');
    const curto = falso(`[ -t 0 ] || exit 0
printf 'Gravar o marcador de instalação em /x? [s/N] '; read -r a
echo 'Nada foi gravado.'`);
    const r = rodarDriver(respostas(), curto, { TETO_POR_PERGUNTA: '5' });
    expect(r.codigo).toBe(3);
    expect(r.saida).toContain('Base [');
  });

  it('a forma ANTIGA — o `<` dentro do `script -qec` — NÃO dava terminal ao instalador', (ctx) => {
    if (!temScript) ctx.skip('sem `script` (util-linux) nesta máquina');
    // A mutação fixada: é o que o passo fazia, e o instalador de mentira diz
    // SEM-TTY. O comentário do workflow afirmava o contrário.
    const arquivo = path.join(tmp, 'respostas.txt');
    fs.writeFileSync(arquivo, 's\n/home/x\ns\ne@x\nsenha\nsenha\n\n');
    const r = spawnSync('script', ['-qec', `bash ${falso(INSTALADOR_FALSO)} < ${arquivo}`, '/dev/null'], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(r.stdout).toContain('SEM-TTY');

    // E o passo de hoje não a usa mais.
    expect(comandos(passo('Instalação completa'))).not.toContain('script -qec');
    expect(comandos(passo('Instalação completa'))).toContain('python3 -I "${RUNNER_TEMP}/terminal-do-e2e.py"');
  });

  it('o passo reprova quando o instalador diz que não viu terminal', () => {
    // A asserção que teria pegado a AT-083 na primeira tag: sem ela, o passo
    // reprovaria adiante, em "elo 1", por um motivo que não diz nada.
    const completa = comandos(passo('Instalação completa'));
    expect(completa).toContain("grep -qF 'Sem terminal interativo' completa.txt");
  });
});
