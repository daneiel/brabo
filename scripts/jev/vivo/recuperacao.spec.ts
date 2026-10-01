import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { recuperar } from './recuperacao.ts';

const RAIZ = join(import.meta.dirname, '..', '..', '..');
const FERRAMENTAS = ['write_file', 'read_file', 'terminal', 'emit_qa_verdict'];

// Os casos de `apps/engine/test/engine/harness/tool_call_recovery_test.exs`, um a um.
describe('recuperar (porta de ToolCallRecovery.from_content/2)', () => {
  it('bloco ```json com várias chamadas concatenadas', () => {
    const conteudo = [
      '```json',
      '{"name": "write_file", "arguments": {"path": "src/cliente.js", "content": "const TOKEN = \\"ghp_abc\\";\\nmodule.exports = { enviar };"}}',
      '{"name": "write_file", "arguments": {"path": "test/cliente.test.js", "content": "const test = require(\'node:test\');"}}',
      '{"name": "terminal", "arguments": {"command": "npm test"}}',
      '```',
    ].join('\n');
    const r = recuperar(conteudo, FERRAMENTAS);
    expect(r.map((c) => c.name)).toEqual(['write_file', 'write_file', 'terminal']);
    expect(r[0]?.arguments.content).toContain('const TOKEN = "ghp_abc"');
    expect(r[0]?.arguments.content).toContain('module.exports = { enviar };');
    expect(r[1]?.arguments.path).toBe('test/cliente.test.js');
    expect(r[2]?.arguments.command).toBe('npm test');
  });

  it('objeto solto, sem cerca; id nulo', () => {
    const [c] = recuperar('Vou rodar a suite: {"name": "terminal", "arguments": {"command": "npm test"}}', FERRAMENTAS);
    expect(c).toEqual({ name: 'terminal', arguments: { command: 'npm test' }, id: null });
  });

  it('argumentos aninhados preservam a estrutura', () => {
    const [c] = recuperar(
      '{"name": "emit_qa_verdict", "arguments": {"veredito": "approved", "coverageMatrix": [{"rule": "RF1", "covered": true}]}}',
      FERRAMENTAS,
    );
    expect(c?.arguments).toEqual({ veredito: 'approved', coverageMatrix: [{ rule: 'RF1', covered: true }] });
  });

  it('texto sem chamada, vazio e nulo: lista vazia', () => {
    expect(recuperar('Terminei a análise, está tudo certo.', FERRAMENTAS)).toEqual([]);
    expect(recuperar('', FERRAMENTAS)).toEqual([]);
    expect(recuperar(null, FERRAMENTAS)).toEqual([]);
  });

  it('`parameters` é sinônimo de `arguments`', () => {
    expect(recuperar('{"name": "terminal", "parameters": {"command": "npm test"}}', FERRAMENTAS)[0]?.arguments).toEqual({
      command: 'npm test',
    });
  });

  it('nome que não está no registro é ignorado — inclusive uma ferramenta FORA do menu, se o registro não a tem', () => {
    expect(recuperar('{"name": "enviar(payload)", "parameters": {"payload": "x"}}', FERRAMENTAS)).toEqual([]);
    expect(recuperar('{"name": "terminal", "arguments": {"command": "ls"}}', ['read_file'])).toEqual([]);
  });

  it('JSON que não é chamada, e JSON malformado, não derrubam nada', () => {
    expect(recuperar('{"resultado": "ok", "total": 3}', FERRAMENTAS)).toEqual([]);
    expect(recuperar('{"name": "terminal"}', FERRAMENTAS)).toEqual([]);
    expect(recuperar('{"name": "terminal", "arguments": "npm test"}', FERRAMENTAS)).toEqual([]);
    expect(recuperar('{"name": "", "arguments": {}}', FERRAMENTAS)).toEqual([]);
    expect(recuperar('{"name": "terminal", "arguments": {', FERRAMENTAS)).toEqual([]);
  });
});

describe('a regra do engine não mudou (trechos-âncora do .ex)', () => {
  const ex = readFileSync(join(RAIZ, 'apps/engine/lib/engine/harness/tool_call_recovery.ex'), 'utf8');
  const laco = readFileSync(join(RAIZ, 'apps/engine/lib/engine/harness/tool_loop.ex'), 'utf8');

  it('nome ancorado no registro e `parameters` como sinônimo', () => {
    expect(ex).toContain('do: name in tool_names');
    expect(ex).toContain('defp argumentos(%{"parameters" => args}) when is_map(args), do: args');
  });

  it('o ToolLoop consulta a recuperação só com toolCalls vazio, contra o REGISTRO inteiro (não o menu)', () => {
    expect(laco).toContain('[] -> ToolCallRecovery.from_content(Map.get(message, "content", ""), tool_names(ctx))');
    expect(laco).toContain('defp tool_names(ctx), do: Enum.map(ctx.tool_specs, & &1.name)');
  });
});
