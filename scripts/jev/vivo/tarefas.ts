/**
 * As tarefas do teste ao vivo da AT-239: cinco tasks de dev agent num projeto
 * Node mínimo (sem dependência, `node --test`), cada uma com os arquivos de
 * partida e uma VERIFICAÇÃO feita DEPOIS da execução, fora do laço.
 *
 * A verificação restaura os testes originais (e acrescenta os ocultos) antes de
 * rodar a suite: um agente que "passa" editando o teste não conta como
 * sucesso. É o critério de qualidade que o replay da AT-237 não tinha — ele só
 * comparava uma escolha com outra gravada; aqui se pergunta se o trabalho saiu.
 *
 * As tasks cobrem os ritmos que o replay mostrou (ler → escrever → rodar; achar
 * a causa noutro arquivo; criar do zero; mexer em vários arquivos), e são
 * pequenas de propósito: o que se compara são os dois braços, não a dificuldade.
 */
export interface Tarefa {
  id: string;
  modulo: string;
  titulo: string;
  historia: string;
  /** Arquivos de partida, caminho relativo → conteúdo. */
  arquivos: Record<string, string>;
  /** Arquivos repostos (os de teste originais) e acrescentados (ocultos) antes da verificação. */
  verificacao: Record<string, string>;
  /** Texto que NÃO pode sobrar em `src/` depois (renomeação). */
  proibidoEmSrc?: string;
}

const PACOTE = JSON.stringify({ name: 'loja', private: true, type: 'commonjs', scripts: { test: 'node --test' } }, null, 2) + '\n';

const TESTE_MEDIA = `const test = require('node:test');
const assert = require('node:assert');
const { soma, media } = require('../src/estatistica');

test('soma', () => assert.strictEqual(soma([1, 2, 3]), 6));
test('media de notas', () => assert.strictEqual(media([2, 4, 6]), 4));
test('media de lista vazia lança RangeError', () => assert.throws(() => media([]), RangeError));
`;

const TESTE_MOEDA = `const test = require('node:test');
const assert = require('node:assert');
const { formatarMoeda } = require('../src/moeda');

test('centavos', () => assert.strictEqual(formatarMoeda(3.5), 'R$ 3,50'));
test('milhar', () => assert.strictEqual(formatarMoeda(1234.5), 'R$ 1.234,50'));
test('milhão', () => assert.strictEqual(formatarMoeda(1234567.891), 'R$ 1.234.567,89'));
`;

const TESTE_CARRINHO = `const test = require('node:test');
const assert = require('node:assert');
const { Carrinho } = require('../src/carrinho');

test('aceita até 5 itens', () => {
  const c = new Carrinho();
  for (let i = 0; i < 5; i++) c.adicionar({ sku: 'x' + i });
  assert.strictEqual(c.itens.length, 5);
});
test('recusa o sexto item', () => {
  const c = new Carrinho();
  for (let i = 0; i < 5; i++) c.adicionar({ sku: 'x' + i });
  assert.throws(() => c.adicionar({ sku: 'y' }), /limite/);
});
`;

const TESTE_SLUG_OCULTO = `const test = require('node:test');
const assert = require('node:assert');
const { slugify } = require('../src/slug');

test('acentos e pontuação', () => assert.strictEqual(slugify('Olá, Mundo!'), 'ola-mundo'));
test('espaços repetidos e bordas', () => assert.strictEqual(slugify('  Café   com  Leite  '), 'cafe-com-leite'));
test('já é slug', () => assert.strictEqual(slugify('pedido-123'), 'pedido-123'));
`;

const TESTE_ENVIO = `const test = require('node:test');
const assert = require('node:assert');
const { calcularEnvio } = require('../src/frete');
const { totalDoPedido } = require('../src/pedido');

test('envio por peso', () => assert.strictEqual(calcularEnvio(2), 20));
test('total soma o envio', () => assert.strictEqual(totalDoPedido({ subtotal: 100, pesoKg: 1 }), 110));
`;

export const TAREFAS: readonly Tarefa[] = [
  {
    id: 'T1-media',
    modulo: 'relatorios',
    titulo: 'Implementar a função media em src/estatistica.js',
    historia: 'Relatório de notas da turma',
    arquivos: {
      'package.json': PACOTE,
      'src/estatistica.js': `function soma(valores) {\n  return valores.reduce((a, b) => a + b, 0);\n}\n\nmodule.exports = { soma };\n`,
      'test/estatistica.test.js': TESTE_MEDIA,
    },
    verificacao: { 'test/estatistica.test.js': TESTE_MEDIA },
  },
  {
    id: 'T2-moeda',
    modulo: 'checkout',
    titulo: 'Corrigir formatarMoeda: falta o separador de milhar',
    historia: 'Preços legíveis no checkout',
    arquivos: {
      'package.json': PACOTE,
      'src/moeda.js': `function formatarMoeda(valor) {\n  return 'R$ ' + valor.toFixed(2).replace('.', ',');\n}\n\nmodule.exports = { formatarMoeda };\n`,
      'test/moeda.test.js': TESTE_MOEDA,
    },
    verificacao: { 'test/moeda.test.js': TESTE_MOEDA },
  },
  {
    id: 'T3-limite',
    modulo: 'carrinho',
    titulo: 'O carrinho deve aceitar até 5 itens',
    historia: 'Compras maiores sem quebrar o carrinho',
    arquivos: {
      'package.json': PACOTE,
      'config/limites.js': `module.exports = {\n  MAX_ITENS_NO_CARRINHO: 3,\n  MAX_CUPONS: 1,\n};\n`,
      'src/carrinho.js': `const { MAX_ITENS_NO_CARRINHO } = require('../config/limites');\n\nclass Carrinho {\n  constructor() {\n    this.itens = [];\n  }\n\n  adicionar(item) {\n    if (this.itens.length >= MAX_ITENS_NO_CARRINHO) {\n      throw new Error('limite de itens atingido');\n    }\n    this.itens.push(item);\n  }\n}\n\nmodule.exports = { Carrinho };\n`,
      'test/carrinho.test.js': TESTE_CARRINHO,
    },
    verificacao: { 'test/carrinho.test.js': TESTE_CARRINHO },
  },
  {
    id: 'T4-slug',
    modulo: 'catalogo',
    titulo: 'Criar src/slug.js com slugify(texto), com testes',
    historia: 'URLs amigáveis para os produtos',
    arquivos: {
      'package.json': PACOTE,
      'src/produto.js': `function nomeDoProduto(p) {\n  return p.nome.trim();\n}\n\nmodule.exports = { nomeDoProduto };\n`,
      'test/produto.test.js': `const test = require('node:test');\nconst assert = require('node:assert');\nconst { nomeDoProduto } = require('../src/produto');\n\ntest('nome sem espaços nas bordas', () => assert.strictEqual(nomeDoProduto({ nome: ' Mesa ' }), 'Mesa'));\n`,
    },
    verificacao: { 'test/slug-oculto.test.js': TESTE_SLUG_OCULTO },
  },
  {
    id: 'T5-renomear',
    modulo: 'frete',
    titulo: 'Renomear calcularFrete para calcularEnvio em todo o projeto',
    historia: 'Vocabulário único de envio',
    arquivos: {
      'package.json': PACOTE,
      'src/frete.js': `function calcularFrete(pesoKg) {\n  return pesoKg * 10;\n}\n\nmodule.exports = { calcularFrete };\n`,
      'src/pedido.js': `const { calcularFrete } = require('./frete');\n\nfunction totalDoPedido({ subtotal, pesoKg }) {\n  return subtotal + calcularFrete(pesoKg);\n}\n\nmodule.exports = { totalDoPedido };\n`,
      'test/envio.test.js': TESTE_ENVIO,
    },
    verificacao: { 'test/envio.test.js': TESTE_ENVIO },
    proibidoEmSrc: 'calcularFrete',
  },
];

export function tarefaPorId(id: string): Tarefa {
  const t = TAREFAS.find((x) => x.id === id);
  if (!t) throw new Error(`tarefa desconhecida: ${id} (há ${TAREFAS.map((x) => x.id).join(', ')})`);
  return t;
}
