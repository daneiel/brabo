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

  it('só apaga volume com confirmação', () => {
    expect(por('apagar-volumes')?.valor).toBe('so-com-confirmacao');
  });

  // A proibição própria da sessão 3 (documento da FASE 29): este instalador
  // ainda não sobe nada. O teste existe para que "subir" não entre de carona
  // numa sessão que declarou não fazê-lo.
  it.each(['subir-compose', 'gerar-segredos', 'instalar-runner'])(
    '%s ainda não acontece nesta versão',
    (chave) => {
      expect(por(chave)?.valor).toBe('nao-nesta-versao');
    },
  );

  it('verifica a própria origem antes de qualquer coisa', () => {
    expect(por('verificar-origem')?.valor).toBe('faz');
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
});
