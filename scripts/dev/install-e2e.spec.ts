import fs from 'node:fs';
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
 * O workflow responde a eles por um arquivo, em ordem, e um prompt novo
 * desalinha TODAS as respostas seguintes: a base viraria a senha, e a
 * instalação falharia por um motivo que não tem nada a ver com o que se quer
 * medir. Não dá para derivar quais deles disparam numa máquina limpa (depende
 * de estado em runtime), mas dá para saber que o CONJUNTO mudou — e isso basta
 * para mandar alguém olhar o arquivo de respostas.
 */
const PROMPTS_INTERATIVOS = 8;

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

  it('roda o instalador BAIXADO da Release, nunca o do checkout', () => {
    const texto = workflow();
    expect(texto).toContain("gh release download \"$TAG\"");
    expect(texto).toContain("--pattern 'install.sh'");
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
    expect(instalacao).toContain("printf 's\\n%s/projetos-brabo\\n");
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

  it('declara que traz à mão os arquivos que o instalador não baixa', () => {
    // O achado da sessão 8: `docker/docker-compose.install.yml` não é asset da
    // Release, não entra no `checksums.txt` assinado, e o `install.sh` não o
    // baixa. Enquanto for assim, o passo tem de existir E dizer por quê — um
    // `curl` mudo aqui viraria, em pouco tempo, "sempre foi assim".
    const achado = passo('achado declarado');
    expect(comandos(achado)).toContain('docker/docker-compose.install.yml');
    expect(comandos(achado)).toContain('docker/postgres/init.sql');

    // E a outra metade do achado, medida: o instalador USA o compose e nunca o
    // BAIXA. No dia em que ele baixar, este teste reprova — e o certo então é
    // apagar o passo de cima, não relaxar aqui.
    expect(instalador()).toContain("COMPOSE_DE_INSTALACAO='docker/docker-compose.install.yml'");
    const descargas = instalador()
      .split('\n')
      .filter((linha) => /curl -fsSL -o/.test(linha))
      .join('\n');
    expect(descargas).not.toContain('docker-compose.install.yml');
  });
});
