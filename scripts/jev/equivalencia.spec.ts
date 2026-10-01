import { describe, expect, it } from 'vitest';
import { TODAS_AS_CAMADAS, acertoDoPasso, classeDoComando, classificarChamada, serve } from './equivalencia.ts';

describe('classeDoComando', () => {
  it.each([
    ['ls -la', 'leitura'],
    ['cat package.json', 'leitura'],
    ['pwd', 'leitura'],
    ['find . -type f -not -path "./node_modules/*" | head -100', 'leitura'],
    ['grep -rn "foo" src | wc -l', 'leitura'],
    ['git status && git log --oneline -20', 'leitura'],
    ['cat .git; echo "---"; ls packages 2>/dev/null', 'leitura'],
    ['ls node_modules 2>&1 | head -5', 'leitura'],
    ['sed -n 1,20p a.ts', 'leitura'],
    ['cd /work && ls -a', 'leitura'],
  ])('leitura: %s', (cmd, esperado) => {
    expect(classeDoComando(cmd)).toBe(esperado);
  });

  it.each([
    ['npm install', 'execucao'],
    ['npm test 2>&1 | tail -60', 'execucao'],
    ['npx vitest run', 'execucao'],
    ['node script.js', 'execucao'],
    ['rm -rf node_modules', 'execucao'],
    ['mkdir -p a/b', 'execucao'],
    ['git commit -m x', 'execucao'],
    ['git branch -D velha', 'execucao'],
    ['find . -name "*.log" -delete', 'execucao'],
    ['find . -type f -exec rm {} \\;', 'execucao'],
    ['ls && npm run build', 'execucao'],
    ['cat lista | xargs rm', 'execucao'],
    ['timeout 60 npm view vitest version', 'execucao'],
  ])('execução: %s', (cmd, esperado) => {
    expect(classeDoComando(cmd)).toBe(esperado);
  });

  it.each([
    ['echo hi > a.txt', 'gravacao'],
    ['cat a >> b', 'gravacao'],
    ['cp a b', 'gravacao'],
    ['mv a b', 'gravacao'],
    ['touch x', 'gravacao'],
    ['sed -i s/a/b/ f', 'gravacao'],
    ['echo x | tee f', 'gravacao'],
    ["cat > /tmp/c.json <<'EOF'\n{ \"a\": 1 }\nEOF", 'gravacao'],
  ])('gravação: %s', (cmd, esperado) => {
    expect(classeDoComando(cmd)).toBe(esperado);
  });

  it('redirecionamento inerte (2>&1, >/dev/null) não vira gravação', () => {
    expect(classeDoComando('ls 2>&1')).toBe('leitura');
    expect(classeDoComando('cat x >/dev/null 2>&1')).toBe('leitura');
  });

  it('heredoc num programa é execução, não gravação (o texto do corpo não é comando)', () => {
    expect(classeDoComando("node - <<'EOF'\nrequire('fs').writeFileSync('a','b')\nEOF")).toBe('execucao');
  });

  it('`>` dentro de aspas não é redirecionamento', () => {
    expect(classeDoComando('echo "a > b"')).toBe('leitura');
    expect(classeDoComando("grep 'a>b' f")).toBe('leitura');
  });

  it('o segmento MAIS forte decide: execução > gravação > leitura', () => {
    expect(classeDoComando('ls; touch x')).toBe('gravacao');
    expect(classeDoComando('touch x; npm test')).toBe('execucao');
  });
});

describe('serve: as três camadas, assimétricas de propósito', () => {
  const termLeitura = classificarChamada('terminal', { command: 'ls -la' });
  const termExec = classificarChamada('terminal', { command: 'npm test' });
  const termGrava = classificarChamada('terminal', { command: 'echo a > b' });
  const read = classificarChamada('read_file', { path: 'a' });
  const search = classificarChamada('search_workspace', { query: 'a' });
  const write = classificarChamada('write_file', {});

  it('estrita: só o mesmo nome', () => {
    expect(serve('terminal', termLeitura)).toBe(true);
    expect(serve('read_file', termLeitura)).toBe(false);
    expect(serve('read_file', search)).toBe(false);
  });

  it('E1: ler serve a terminal de leitura, e a escolha `terminal` continua só servindo a terminal', () => {
    expect(serve('read_file', termLeitura, ['E1'])).toBe(true);
    expect(serve('search_workspace', termLeitura, ['E1'])).toBe(true);
    expect(serve('read_file', termExec, ['E1'])).toBe(false);
    expect(serve('read_file', termGrava, ['E1'])).toBe(false);
    expect(serve('terminal', read, TODAS_AS_CAMADAS)).toBe(false);
  });

  it('E2: read_file ≡ search_workspace, só entre elas', () => {
    expect(serve('read_file', search, ['E2'])).toBe(true);
    expect(serve('search_workspace', read, ['E2'])).toBe(true);
    expect(serve('write_file', read, ['E2'])).toBe(false);
    expect(serve('read_file', search, ['E1'])).toBe(false);
  });

  it('E3: write_file serve a terminal que grava, nunca a terminal que executa', () => {
    expect(serve('write_file', termGrava, ['E3'])).toBe(true);
    expect(serve('write_file', termExec, TODAS_AS_CAMADAS)).toBe(false);
    expect(serve('write_file', termLeitura, TODAS_AS_CAMADAS)).toBe(false);
    expect(serve('terminal', write, TODAS_AS_CAMADAS)).toBe(false);
  });
});

describe('acertoDoPasso', () => {
  const chamadas = [classificarChamada('terminal', { command: 'ls' }), classificarChamada('write_file', {})];

  it('passo com ferramenta: a escolha serve a QUALQUER chamada do passo', () => {
    expect(acertoDoPasso('write_file', chamadas)).toBe(true);
    expect(acertoDoPasso('read_file', chamadas)).toBe(false);
    expect(acertoDoPasso('read_file', chamadas, ['E1'])).toBe(true);
  });

  it('passo sem ferramenta: só `responder_sem_ferramenta` acerta; escolha nula nunca acerta', () => {
    expect(acertoDoPasso('responder_sem_ferramenta', [])).toBe(true);
    expect(acertoDoPasso('terminal', [])).toBe(false);
    expect(acertoDoPasso(null, chamadas)).toBe(false);
  });
});
