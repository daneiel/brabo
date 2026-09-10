import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// O `install.sh` roda na máquina de quem instala, e a parte que erra na prática
// não é o download: é a DECISÃO — o que ele achou, e o que ele apagaria. Os
// modos `--print-state` e `--print-plan` existem para que essa metade se prove
// sem TTY, sem rede e sem efeito, exatamente como o `--print-commands` do
// `bootstrap.sh` (ver `bootstrap.spec.ts`, o precedente deste arquivo).
//
// O que estes testes NÃO cobrem, e é preciso dizer: o fluxo principal verifica
// a própria origem contra o `checksums.txt` assinado de uma Release, e nenhuma
// Release tem esse asset até a próxima tag final. Esse caminho só se prova em
// CI, na sessão de E2E da FASE 29.
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(RAIZ, 'install.sh');

type Linha = { chave: string; valor: string; nota?: string };

function imprimir(modo: '--print-state' | '--print-plan', env: NodeJS.ProcessEnv = {}): Linha[] {
  const saida = execFileSync('bash', [SCRIPT, modo], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', ...env },
  });
  return saida
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => {
      const [chave, valor, nota] = l.split('\t');
      return { chave, valor, nota };
    });
}

const fonte = () => fs.readFileSync(SCRIPT, 'utf8');

describe('install.sh — o plano', () => {
  const plano = imprimir('--print-plan');
  const por = (chave: string) => plano.find((l) => l.chave === chave);

  // A garantia que mais importa, e a razão de o plano ser imprimível: pasta de
  // usuário é acúmulo, não estado do produto. A mesma régua do espelho
  // (RN-516), aplicada a quem tem permissão para apagar volumes.
  it('nunca apaga a base de projetos nem a pasta de espelho', () => {
    expect(por('apagar-base-de-projetos')?.valor).toBe('nunca');
    expect(por('apagar-pasta-de-espelho')?.valor).toBe('nunca');
  });

  // A garantia que dá ao instalador o direito de apagar: ele só apaga depois
  // de PROVAR que o backup restaura. Um backup que ninguém tentou restaurar é
  // um arquivo, e a hora de descobrir isso não é depois do `down -v`.
  it('nunca apaga sem backup provado', () => {
    expect(por('apagar-sem-backup-provado')?.valor).toBe('nunca');
  });

  it('a prova de restauração acontece ANTES da deleção', () => {
    // Só linhas de CÓDIGO: `down -v` aparece antes em comentários, e eles são
    // justamente os que explicam por que a prova vem primeiro. Um teste que
    // lesse o arquivo cru reprovaria a explicação junto com o código — foi o
    // que aconteceu na primeira versão deste teste.
    const codigo = fonte()
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('#'))
      .join('\n');
    const prova = codigo.indexOf('test-restore-compose.sh');
    const delecao = codigo.indexOf('down -v');
    expect(prova).toBeGreaterThan(-1);
    expect(delecao).toBeGreaterThan(prova);
  });

  it('só apaga volume com confirmação', () => {
    expect(por('apagar-volumes')?.valor).toBe('so-com-confirmacao');
  });

  // A proibição própria da sessão 4: subir sim, instalar runner e migrar não.
  // O teste existe para que nenhum dos dois entre de carona numa sessão que
  // declarou não fazê-los — foi assim que a lista começou, na sessão 3, com
  // `subir-compose` do lado de cá.
  it.each(['escolher-fonte', 'gerar-segredos', 'subir-compose', 'conferir-saude', 'migrar-instalacao-anterior',
    'consentir-base', 'instalar-runner'])(
    '%s já acontece',
    (chave) => {
      expect(por(chave)?.valor).toBe('faz');
    },
  );

  // Perguntar antes de afirmar: `up --wait` espera o healthcheck, mas quem
  // anuncia "instalado" tem de ter perguntado. É a régua que o
  // `reset-total.sh` aprendeu na marra (BRB-033).
  it('confere /health antes de dizer que instalou', () => {
    const texto = fonte();
    expect(texto).toContain('/health');
    expect(texto).toMatch(/a api subiu mas não respondeu em \/health/);
  });

  it('verifica a própria origem antes de qualquer coisa', () => {
    expect(por('verificar-origem')?.valor).toBe('faz');
  });

  // BRB-031: o `chmod +x` manual do fluxo do navegador (a File System Access
  // API não preserva o bit de execução). Um script preserva — e é por isso que
  // este item fecha aqui, e não fechou na FASE 28, onde a instalação como
  // serviço não vinha de um artefato versionado.
  it('instala o runner com o bit de execução, sem chmod manual', () => {
    const texto = fonte();
    // `install -m 0755` põe o bit no mesmo ato que copia. O que BRB-031 pede
    // é que o USUÁRIO não precise de `chmod` — o script fazendo é o oposto
    // disso, e por isso o `chmod +x` do cosign (que o script baixa) não conta.
    expect(texto).toContain('install -m 0755');
    // O que não pode voltar é a INSTRUÇÃO de chmod dirigida a quem instala.
    expect(texto).not.toMatch(/chmod \+x \.\/brabo-runner/);
  });

  // O binário passa pela MESMA verificação do resto (RN-524), contra o
  // manifesto que o próprio script já verificou para conferir a si mesmo.
  it('confere o binário do runner contra o manifesto assinado', () => {
    const texto = fonte();
    expect(texto).toMatch(/o manifesto assinado não cobre/);
    expect(texto).toMatch(/o binário do runner NÃO bate com o manifesto assinado/);
  });
});

describe('install.sh — o estado', () => {
  it('responde sem TTY, sem efeito e com sucesso', () => {
    const estado = imprimir('--print-state');
    expect(estado.find((l) => l.chave === 'plataforma')?.valor).toMatch(
      /^(linux|darwin)-(amd64|arm64)$/,
    );
    expect(estado.find((l) => l.chave === 'marcador')?.valor).toContain('install-state.json');
  });

  // `--print-state` é leitura. Se ele gravasse, a primeira execução de alguém
  // curioso mudaria o que a segunda encontra — e o marcador existe justamente
  // para a segunda ser um diff confiável.
  it('não cria o marcador', () => {
    const estadoTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brabo-install-'));
    try {
      const estado = imprimir('--print-state', { XDG_STATE_HOME: estadoTmp });
      expect(estado.find((l) => l.chave === 'marcador-existe')?.valor).toBe('nao');
      expect(fs.existsSync(path.join(estadoTmp, 'brabo'))).toBe(false);
    } finally {
      fs.rmSync(estadoTmp, { recursive: true, force: true });
    }
  });

  // O marcador segue o XDG, e não `~/.brabo/` — que é onde o runner guarda
  // coisa POR PROJETO. Juntar os dois faria a remoção de um apagar o outro.
  it('honra XDG_STATE_HOME', () => {
    const estado = imprimir('--print-state', { XDG_STATE_HOME: '/tmp/xdg-de-teste' });
    expect(estado.find((l) => l.chave === 'marcador')?.valor).toBe(
      '/tmp/xdg-de-teste/brabo/install-state.json',
    );
  });
});

// O manifesto que o instalador lê é JSON **indentado**, e `grep` trabalha
// linha a linha. A primeira versão do parser usava um padrão `[^}]*` sobre o
// arquivo cru e devolvia VAZIO para os três alvos — o instalador teria subido
// sem imagem nenhuma. Só apareceu rodando contra o `images.json` real da
// Release, e este teste existe para que não volte.
describe('install.sh — o parser do manifesto de imagens', () => {
  const MANIFESTO_REAL = `{
  "versao": "5.0.0",
  "commit": "1538fdbbcd30",
  "imagens": [
    {
      "alvo": "api",
      "repositorio": "ghcr.io/daneiel/brabo-api",
      "digest": "sha256:d99bf7226aab80685ce245decc9f7297b9ad6f8a771433f8e5ff444bb94369f2",
      "tags": ["5.0.0", "1538fdbbcd30"]
    },
    {
      "alvo": "engine",
      "repositorio": "ghcr.io/daneiel/brabo-engine",
      "digest": "sha256:47c79bddf6369589c30fc21992b994648b664d37beafaaaa8ff371f091782af5",
      "tags": ["5.0.0", "1538fdbbcd30"]
    }
  ]
}`;

  // Reproduz o pipeline do script — compactar em uma linha e casar a ENTRADA
  // inteira antes de extrair os campos.
  function extrair(json: string, alvo: string) {
    const compacto = json.replace(/\n/g, '').replace(/ {2,}/g, ' ');
    const entrada = compacto.match(new RegExp(`\\{[^{}]*"alvo": *"${alvo}"[^{}]*\\}`))?.[0] ?? '';
    return {
      repositorio: entrada.match(/"repositorio": *"([^"]*)"/)?.[1] ?? '',
      digest: entrada.match(/"digest": *"([^"]*)"/)?.[1] ?? '',
    };
  }

  it('extrai repositório e digest de um manifesto indentado', () => {
    const api = extrair(MANIFESTO_REAL, 'api');
    expect(api.repositorio).toBe('ghcr.io/daneiel/brabo-api');
    expect(api.digest).toMatch(/^sha256:[0-9a-f]{64}$/);

    const engine = extrair(MANIFESTO_REAL, 'engine');
    expect(engine.repositorio).toBe('ghcr.io/daneiel/brabo-engine');
    expect(engine.digest).not.toBe(api.digest);
  });

  it('devolve vazio para alvo ausente, em vez de casar o errado', () => {
    expect(extrair(MANIFESTO_REAL, 'web').digest).toBe('');
  });

  it('o script compacta antes de casar', () => {
    // A garantia real está no shell, não neste helper: se alguém remover a
    // compactação, o script volta a devolver vazio e nada aqui perceberia.
    expect(fonte()).toMatch(/tr -d '\\n' < "\$json"/);
  });
});

describe('install.sh — invariantes do arquivo', () => {
  // Mesmo gênero de teste que `actions-pinadas.ts`: há garantias que só se
  // verificam lendo o script, porque exercitá-las exigiria a rede e uma
  // Release publicada.
  it('pina o cosign por versão e por hash de 64 hex, nas quatro plataformas', () => {
    const texto = fonte();
    expect(texto).toMatch(/^COSIGN_VERSAO='v\d+\.\d+\.\d+'$/m);
    for (const alvo of ['linux-amd64', 'linux-arm64', 'darwin-amd64', 'darwin-arm64']) {
      expect(texto).toMatch(new RegExp(`^\\s*${alvo}\\)\\s+echo '[0-9a-f]{64}' ;;$`, 'm'));
    }
  });

  // Sem as duas flags de identidade, `cosign verify-blob` aceita uma assinatura
  // válida DE QUALQUER UM — o que anula a verificação inteira sem nunca falhar.
  it('exige identidade e emissor ao verificar a assinatura', () => {
    const texto = fonte();
    expect(texto).toContain('--certificate-identity-regexp');
    expect(texto).toContain('--certificate-oidc-issuer');
    expect(texto).toContain('token.actions.githubusercontent.com');
  });

  it('recusa Windows nomeando a plataforma, em vez de falhar genericamente', () => {
    const texto = fonte();
    expect(texto).toMatch(/MINGW\*\|MSYS\*\|CYGWIN\*\|Windows_NT/);
    expect(texto).toMatch(/Windows está fora de escopo por decisão declarada/);
  });

  // O próprio uso que o script documenta é `sh -c "$(curl …)"`. Se algum dia
  // alguém o "simplificar" para o pipe, o consentimento morre junto — o stdin
  // do processo passa a ser o download.
  it('não instrui a forma que ele mesmo recusa', () => {
    const texto = fonte();
    expect(texto).toContain('sh -c "$(curl -fsSL');

    // Só linhas de CÓDIGO. O cabeçalho MENCIONA `curl … | sh` de propósito —
    // é onde ele explica por que aquela forma mata o consentimento —, e um
    // teste que proibisse a menção proibiria a explicação junto.
    const codigo = texto
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('#'))
      .join('\n');
    expect(codigo).not.toMatch(/curl[^\n|]*\|\s*(ba)?sh\b/);
  });

  // Duas mensagens deste script anunciaram a quem instalava que ele NÃO migrava
  // e NÃO instalava o runner, meses depois de as duas funções existirem e serem
  // chamadas: eram o texto da sessão que as declarou pendentes, sobrevivendo às
  // sessões que as fizeram. O plano imprimível já dizia `faz` nas duas linhas —
  // o que faltava era alguém cobrar o TEXTO. A régua é do destinatário: quem
  // roda isto não sabe o que é uma sessão de fase, e uma pendência de plano
  // nunca é notícia para ele. Comentário segue livre — é onde a decisão mora.
  it('não fala de sessões de fase para quem instala', () => {
    const codigo = fonte()
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('#'))
      .join('\n');
    expect(codigo).not.toMatch(/sess(ão|ao)\s+\d/i);
    expect(codigo).not.toMatch(/\bFASE\s+\d/i);
  });
});
