import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dentroDaRaiz, executar, materializar, verificar } from './executor.ts';
import { TAREFAS, tarefaPorId } from './tarefas.ts';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jev-vivo-spec-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('executar (ferramentas na sandbox)', () => {
  it('escreve, lê e busca dentro da raiz', () => {
    expect(executar(dir, 'write_file', { path: 'src/a.js', content: 'const x = 1;' }, [])).toEqual({ conteudo: 'escrito: src/a.js', ok: true });
    expect(executar(dir, 'read_file', { path: 'src/a.js' }, []).conteudo).toBe('const x = 1;');
    expect(executar(dir, 'search_workspace', { query: 'x = 1' }, []).conteudo).toBe('1 resultado(s):\n- src/a.js');
  });

  it('recusa caminho fora da raiz e argumento ausente, com o texto do engine', () => {
    expect(dentroDaRaiz(dir, '../fora')).toBeNull();
    expect(executar(dir, 'read_file', { path: '../../etc/passwd' }, [])).toEqual({ conteudo: 'caminho fora do workspace: ../../etc/passwd', ok: false });
    expect(executar(dir, 'write_file', { path: 'a' }, []).ok).toBe(false);
    expect(executar(dir, 'inexistente', {}, [])).toEqual({ conteudo: 'ferramenta desconhecida: inexistente', ok: false });
  });

  it('terminal devolve "exit N" e a saída, sem herdar a chave do ambiente', () => {
    process.env.OPENROUTER_TEST_KEY_SPEC = 'segredo';
    const r = executar(dir, 'terminal', { command: 'echo oi; echo "[$OPENROUTER_TEST_KEY_SPEC]"; exit 3' }, []);
    delete process.env.OPENROUTER_TEST_KEY_SPEC;
    expect(r.conteudo).toBe('exit 3\noi\n[]\n');
  });

  it('report_done só com o último terminal em exit 0 (regra de ReportDone)', () => {
    const verde = [{ role: 'tool' as const, name: 'terminal', content: 'exit 0\nok' }];
    const vermelho = [...verde, { role: 'tool' as const, name: 'terminal', content: 'exit 1\nfalhou' }];
    expect(executar(dir, 'report_done', { summary: 's' }, verde).ok).toBe(true);
    expect(executar(dir, 'report_done', { summary: 's' }, vermelho).ok).toBe(false);
    expect(executar(dir, 'report_done', { summary: 's' }, []).ok).toBe(false);
  });
});

// Soluções de referência: provam que cada task é possível e que a verificação
// distingue feito de não feito.
const SOLUCOES: Record<string, Record<string, string>> = {
  'T1-media': {
    'src/estatistica.js':
      'function soma(v) { return v.reduce((a, b) => a + b, 0); }\nfunction media(v) { if (v.length === 0) throw new RangeError("vazia"); return soma(v) / v.length; }\nmodule.exports = { soma, media };\n',
  },
  'T2-moeda': {
    'src/moeda.js':
      'function formatarMoeda(v) { const [i, d] = v.toFixed(2).split("."); return "R$ " + i.replace(/\\B(?=(\\d{3})+(?!\\d))/g, ".") + "," + d; }\nmodule.exports = { formatarMoeda };\n',
  },
  'T3-limite': { 'config/limites.js': 'module.exports = { MAX_ITENS_NO_CARRINHO: 5, MAX_CUPONS: 1 };\n' },
  'T4-slug': {
    'src/slug.js':
      'function slugify(t) { return t.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }\nmodule.exports = { slugify };\n',
  },
  'T5-renomear': {
    'src/frete.js': 'function calcularEnvio(p) { return p * 10; }\nmodule.exports = { calcularEnvio };\n',
    'src/pedido.js': 'const { calcularEnvio } = require("./frete");\nfunction totalDoPedido({ subtotal, pesoKg }) { return subtotal + calcularEnvio(pesoKg); }\nmodule.exports = { totalDoPedido };\n',
  },
};

describe('tarefas e verificação', () => {
  it.each(TAREFAS.map((t) => t.id))('%s: o estado de partida NÃO passa, a solução de referência passa', (id) => {
    const t = tarefaPorId(id);
    materializar(dir, t.arquivos);
    expect(verificar(dir, t.verificacao, t.proibidoEmSrc).ok).toBe(false);
    materializar(dir, SOLUCOES[id]!);
    expect(verificar(dir, t.verificacao, t.proibidoEmSrc)).toEqual({ ok: true, motivo: 'suite verde' });
  });

  it('editar o teste para passar não conta: a verificação repõe o original', () => {
    const t = tarefaPorId('T1-media');
    materializar(dir, t.arquivos);
    materializar(dir, { 'test/estatistica.test.js': "require('node:test')('trapaça', () => {});\n" });
    expect(verificar(dir, t.verificacao).ok).toBe(false);
    expect(readFileSync(join(dir, 'test/estatistica.test.js'), 'utf8')).toContain('media de notas');
  });

  it('renomeação com resto do nome antigo em src/ não conta', () => {
    const t = tarefaPorId('T5-renomear');
    materializar(dir, { ...t.arquivos, ...SOLUCOES['T5-renomear']!, 'src/legado.js': '// calcularFrete\n' });
    expect(verificar(dir, t.verificacao, t.proibidoEmSrc)).toEqual({ ok: false, motivo: '"calcularFrete" ainda em src/legado.js' });
  });
});
