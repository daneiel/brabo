import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lerFerramentas, lerOpcoes, ordemDosBracos, relatorio, sistemaDoDev } from './vivo.ts';
import { TAREFAS, tarefaPorId } from './tarefas.ts';

const RAIZ = join(import.meta.dirname, '..', '..', '..');

describe('ferramentas-dev.json (gerado de apps/engine por ferramentas-dev.exs)', () => {
  const ferramentas = lerFerramentas();
  const registro = readFileSync(join(RAIZ, 'apps/engine/lib/engine/dev/tools.ex'), 'utf8');
  const lista = /@registry \[([^\]]*)\]/.exec(registro)?.[1] ?? '';
  const modulos = lista.split(',').map((s) => s.trim()).filter(Boolean);

  it('tem uma definição por módulo do @registry do dev, na mesma ordem — regenere se divergir', () => {
    const snake = (m: string) => m.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
    expect(ferramentas.map((f) => f.name)).toEqual(modulos.map(snake));
  });

  it('cada descrição ainda está no .ex de origem (o começo dela), e há esquema de parâmetros', () => {
    const j = JSON.parse(readFileSync(join(import.meta.dirname, 'ferramentas-dev.json'), 'utf8')) as { ferramentas: { arquivo: string; description: string; parameters: { type?: string } }[] };
    for (const f of j.ferramentas) {
      const fonte = readFileSync(join(RAIZ, f.arquivo), 'utf8').replace(/"\s*<>\s*"/g, '').replace(/\s+/g, ' ');
      expect(fonte, f.arquivo).toContain(f.description.slice(0, 40).replace(/\s+/g, ' ').replace(/"/g, '\\"'));
      expect(f.parameters.type).toBe('object');
    }
  });
});

describe('lerOpcoes', () => {
  const env = { XDG_CACHE_HOME: '/tmp/cache-jev' };

  it('padrões, --preco e --tarefas', () => {
    const o = lerOpcoes(['--', '--preco', 'a/b=0.3/1.2', '--tarefas', 'T1-media,T3-limite', '--rodadas', '3'], env);
    expect(o).toMatchObject({ saida: '/tmp/cache-jev/brabo/jev-vivo', tetoUsd: 4.5, rodadas: 3, tarefas: ['T1-media', 'T3-limite'], precos: { 'a/b': { entrada: 0.3, saida: 1.2 } } });
  });

  it('recusa saída dentro do checkout, opção desconhecida, tarefa desconhecida e preço malformado', () => {
    expect(() => lerOpcoes(['--saida', join(RAIZ, 'tmp-saida')], env)).toThrow(/FORA do checkout/);
    expect(() => lerOpcoes(['--chave', 'x'], env)).toThrow(/opção desconhecida/);
    expect(() => lerOpcoes(['--tarefas', 'T9'], env)).toThrow(/tarefa desconhecida/);
    expect(() => lerOpcoes(['--preco', 'a=1'], env)).toThrow(/modelo=entrada\/saida/);
  });
});

describe('o ensaio', () => {
  it('a ordem dos braços alterna, e cada braço vai primeiro metade das vezes', () => {
    const primeiros = TAREFAS.flatMap((t) => [0, 1].map((r) => ordemDosBracos(t.id, r)[0]));
    expect(primeiros.filter((b) => b === 'ligado')).toHaveLength(primeiros.length / 2);
    expect(ordemDosBracos('T1-media', 0)).not.toEqual(ordemDosBracos('T1-media', 1));
  });

  it('o sistema é a identidade do dev do engine com o módulo da tarefa', () => {
    expect(sistemaDoDev(tarefaPorId('T3-limite'))).toMatch(/^Você é o agente dev-carrinho\./);
  });

  it('relatório de saída vazia não inventa veredito', () => {
    expect(relatorio([])).toContain('**amostra_insuficiente**');
  });
});
