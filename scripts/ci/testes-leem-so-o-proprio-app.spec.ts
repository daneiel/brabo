/**
 * AT-692 (EP-033): teste de app que lê arquivo FORA do próprio app é acoplamento
 * que a separação em repositórios quebra. A régua: caminho montado a partir de
 * `__dirname`/`__DIR__`/`process.cwd()` com `../` que SAI de `apps/<app>/` só
 * passa se o arquivo estiver em `EXCECOES`, cada uma com o MOTIVO. Entrada nova
 * na lista é decisão a justificar no PR; entrada que não casa mais reprova.
 *
 * Grupos: `contrato` (lê `packages/`, que vira o brabo-contracts), `cruzada`
 * (aferir um app contra outro É o papel do teste; vai para o brabo-infra),
 * `docs` (aferir a documentação; vai para o brabo-docs), `propria-do-app`
 * (o arquivo muda de repositório junto com o app: `design/` com o web,
 * `prompts/` com o engine) e `repositorio` (aferir o repositório inteiro).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const EXCECOES: Record<string, string> = {
  'apps/api/test/contract/git-provider-contract-callers.spec.ts': 'contrato: lê packages/shared',
  'apps/api/test/domain/git/git-errors.spec.ts': 'contrato: lê packages/shared',
  'apps/api/test/domain/actions/path-scope.spec.ts': 'contrato: lê packages/docker-port',
  'apps/api/test/packages-shared-so-tipos.spec.ts': 'contrato: afere packages/shared',
  'apps/api/test/domain/gates/gate-registry.spec.ts': 'repositorio: validarLocalizadores confere os arquivos de prova no disco',
  'apps/api/test/domain/llm/tool-router-correcao-do-dev.spec.ts': 'cruzada: api x engine',
  'apps/api/test/domain/llm/tool-router-piso-dos-gates.spec.ts': 'cruzada: api x engine',
  'apps/api/test/runbook/sql-do-incidente-de-custo.spec.ts': 'docs: executa o SQL de deploy/docs/runbook.md',
  'apps/web/src/design-contraste.test.ts': 'propria-do-app: design/ vai com o web',
  'apps/web/src/lib/agents.test.ts': 'propria-do-app: design/ vai com o web',
  'apps/web/src/lib/contraste.test.ts': 'propria-do-app: design/ vai com o web',
  'apps/web/src/lib/tokens-padrao.test.ts': 'propria-do-app: design/ vai com o web',
  'apps/web/src/lib/activity-catalog.test.ts': 'docs: confere docs/reference/events.md (gerado)',
  'apps/engine/test/engine/harness/context_manager_test.exs': 'propria-do-app: prompts/ vai com o engine',
  'apps/engine/test/engine/harness/fluxo_do_time_test.exs': 'contrato: lê packages/contracts/fluxo.yml',
  'apps/engine/test/engine/gates/qa_automacao_agent_golden_test.exs': 'cruzada: roda o seed da api',
  'apps/engine/test/engine/rag/rag_golden_test.exs': 'cruzada: roda o seed da api',
  'apps/web/src/lib/aprovacoes.test.ts': 'cruzada: web x decide.ts da api',
  'apps/web/src/lib/sempre-permitir.test.ts': 'cruzada: web x sempre-permitir.ts da api',
  'apps/api/test/infrastructure/filesystem/project-workspaces-root.spec.ts': 'nao lê arquivo: passa o pai do cwd a um validador de caminho',
};

function saiDoApp(arquivo: string): boolean {
  const app = arquivo.split('/').slice(0, 2).join('/');
  const dir = path.posix.dirname(arquivo);
  const linhas = readFileSync(path.join(RAIZ, arquivo), 'utf8').split('\n');
  return linhas.some((linha) => {
    if (!/__dirname|__DIR__|process\.cwd\(\)/.test(linha)) return false;
    // junta `'..', '..'` em `'../..'` e pega o primeiro literal que começa por `..`
    const txt = linha.replace(/['"],\s*['"]/g, '/');
    const m = txt.match(/['"]((?:\.\.\/?)+)([^'"]*)['"]/);
    if (!m) return false;
    const base = linha.includes('process.cwd()') ? app : dir;
    const alvo = path.posix.normalize(path.posix.join(base, m[1] ?? "", m[2] ?? ""));
    return !alvo.startsWith(`${app}/`) && alvo !== app;
  });
}

describe('teste de app só lê o próprio app (AT-692)', () => {
  const testes = execFileSync('git', ['ls-files', 'apps/api/test', 'apps/web/src', 'apps/engine/test'], {
    cwd: RAIZ,
    encoding: 'utf8',
  })
    .split('\n')
    .filter((f) => /\.(spec|test)\.tsx?$|_test\.exs$/.test(f));
  const saem = testes.filter(saiDoApp);

  it('a varredura enxerga testes (senão o resultado seria cego)', () => {
    expect(testes.length).toBeGreaterThan(300);
    expect(saem).toContain('apps/web/src/lib/contraste.test.ts');
  });

  it('todo teste que sai do app está na lista de exceções, com motivo', () => {
    expect(saem.filter((f) => !EXCECOES[f])).toEqual([]);
  });

  it('toda exceção ainda sai do app (a lista não apodrece)', () => {
    expect(Object.keys(EXCECOES).filter((f) => !saem.includes(f))).toEqual([]);
  });
});
