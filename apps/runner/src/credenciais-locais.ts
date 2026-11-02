/**
 * AT-611 (L1): leitores PUROS das chaves de LLM que as ferramentas locais já
 * guardam. Sem rede, sem subcomando, sem escrita. `home`/`env` são INJETADOS
 * (teste usa fixture sintética). O valor só existe em `valor` de candidato
 * `chave-de-api`; `origem` é caminho ou NOME de variável, nunca o valor.
 * OAuth de assinatura nunca é importável (termos dos fornecedores): sem valor.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Ferramenta = 'claude-code' | 'codex' | 'opencode' | 'kilo' | 'hermes';

// O runner não depende de @brabo/shared; a lista espelha LLM_PROVIDER_NAMES_COM_CREDENCIAL
// da api e o spec confere contra o arquivo dela.
export const PROVIDERS_COM_CREDENCIAL = [
  'anthropic',
  'openai',
  'openrouter',
  'nvidia-nim',
  'together',
  'deepinfra',
  'bitdeer',
  'vultr',
  '9router',
] as const;
export type Provider = (typeof PROVIDERS_COM_CREDENCIAL)[number];

export interface Candidato {
  ferramenta: Ferramenta;
  origem: string;
  provider: Provider | null;
  tipo: 'chave-de-api' | 'assinatura';
  valor?: string;
  final: string;
}
export interface Problema {
  ferramenta: Ferramenta;
  origem: string;
  motivo: string;
}
export interface Resultado {
  candidatos: Candidato[];
  problemas: Problema[];
}

/** Nome na ferramenta -> provider do Brabo (null = sem par). */
export const MAPA_DE_PROVIDERS: Record<string, Provider | null> = {
  anthropic: 'anthropic',
  openai: 'openai',
  openrouter: 'openrouter',
  togetherai: 'together',
  together: 'together',
  deepinfra: 'deepinfra',
  nvidia: 'nvidia-nim',
  // opencode-zen ainda não existe em LLMProviderName nesta base: sem par até nascer.
  opencode: null,
  'opencode-zen': null,
};

const VARIAVEIS_DO_HERMES: Record<string, string> = {
  OPENROUTER_API_KEY: 'openrouter',
  NVIDIA_API_KEY: 'nvidia',
  DEEPINFRA_API_KEY: 'deepinfra',
  ANTHROPIC_API_KEY: 'anthropic',
  OPENAI_API_KEY: 'openai',
  OPENCODE_ZEN_API_KEY: 'opencode-zen',
};

const final = (v: string) => `…${v.slice(-4)}`;
const texto = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const registro = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function acharCredenciaisLocais(o: {
  home: string;
  env: Record<string, string | undefined>;
  plataforma: NodeJS.Platform;
}): Resultado {
  const candidatos: Candidato[] = [];
  const problemas: Problema[] = [];

  const lerJson = (f: Ferramenta, caminho: string): Record<string, unknown> | null => {
    let bruto: string;
    try {
      bruto = readFileSync(caminho, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        problemas.push({ ferramenta: f, origem: caminho, motivo: 'arquivo ilegível' });
      }
      return null;
    }
    try {
      const j: unknown = JSON.parse(bruto);
      if (registro(j)) return j;
    } catch {
      // cai no problema abaixo
    }
    problemas.push({ ferramenta: f, origem: caminho, motivo: 'arquivo corrompido' });
    return null;
  };
  const chave = (f: Ferramenta, origem: string, nome: string, valor: string) =>
    candidatos.push({
      ferramenta: f,
      origem,
      provider: MAPA_DE_PROVIDERS[nome] ?? null,
      tipo: 'chave-de-api',
      valor,
      final: final(valor),
    });
  const assinatura = (f: Ferramenta, origem: string, nome: string | null) =>
    candidatos.push({
      ferramenta: f,
      origem,
      provider: nome ? (MAPA_DE_PROVIDERS[nome] ?? null) : null,
      tipo: 'assinatura',
      final: '',
    });

  // Claude Code
  if (texto(o.env.ANTHROPIC_API_KEY)) {
    chave('claude-code', 'ANTHROPIC_API_KEY', 'anthropic', o.env.ANTHROPIC_API_KEY);
  }
  const cj = join(o.home, '.claude.json');
  const c = lerJson('claude-code', cj);
  if (c) {
    if (texto(c.primaryApiKey)) chave('claude-code', `${cj}#primaryApiKey`, 'anthropic', c.primaryApiKey);
    if (texto(c.apiKeyHelper)) {
      problemas.push({ ferramenta: 'claude-code', origem: `${cj}#apiKeyHelper`, motivo: 'script, não executado' });
    }
  }
  const cc = join(o.home, '.claude', '.credentials.json');
  if (lerJson('claude-code', cc)?.claudeAiOauth) assinatura('claude-code', cc, 'anthropic');

  // Codex
  const ca = join(o.home, '.codex', 'auth.json');
  const x = lerJson('codex', ca);
  if (x) {
    if (texto(x.OPENAI_API_KEY)) chave('codex', `${ca}#OPENAI_API_KEY`, 'openai', x.OPENAI_API_KEY);
    if (x.tokens || x.auth_mode === 'chatgpt') assinatura('codex', ca, 'openai');
  }

  // OpenCode / Kilo (fork): auth.json legado. A pasta do Kilo NÃO foi medida (CLI não instalado aqui).
  for (const [f, pasta] of [
    ['opencode', 'opencode'],
    ['kilo', 'kilo'],
  ] as const) {
    const dir = join(o.home, '.local', 'share', pasta);
    const aj = join(dir, 'auth.json');
    for (const [id, e] of Object.entries(lerJson(f, aj) ?? {})) {
      if (!registro(e)) continue;
      if (e.type === 'api' && texto(e.key)) chave(f, `${aj}#${id}`, id, e.key);
      else if (e.type === 'oauth') assinatura(f, `${aj}#${id}`, id);
    }
    // shortcut: sem leitor SQLite (node:sqlite não é garantido sob o Bun do binário); medir antes de ligar.
    const db = join(dir, `${pasta}.db`);
    if (existsSync(db)) {
      problemas.push({ ferramenta: f, origem: db, motivo: 'banco SQLite não suportado nesta versão' });
    }
  }

  // Hermes (.env + pool), sem duplicata por valor
  const vistos = new Set<string>();
  const hermes = (origem: string, nome: string, valor: string) => {
    if (vistos.has(valor)) return;
    vistos.add(valor);
    chave('hermes', origem, nome, valor);
  };
  const he = join(o.home, '.hermes', '.env');
  try {
    for (const linha of readFileSync(he, 'utf8').split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(linha);
      const nome = m && VARIAVEIS_DO_HERMES[m[1]!];
      const valor = m?.[2]?.replace(/^(['"])(.*)\1$/, '$2');
      if (nome && valor) hermes(`${he}#${m![1]}`, nome, valor);
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      problemas.push({ ferramenta: 'hermes', origem: he, motivo: 'arquivo ilegível' });
    }
  }
  const hp = join(o.home, '.hermes', 'auth.json');
  const pool = lerJson('hermes', hp)?.credential_pool;
  for (const [nome, itens] of Object.entries(registro(pool) ? pool : {})) {
    for (const it of Array.isArray(itens) ? itens : []) {
      if (!registro(it)) continue;
      if (it.auth_type === 'api_key' && texto(it.access_token)) hermes(`${hp}#${nome}`, nome, it.access_token);
      else if (it.auth_type === 'oauth') assinatura('hermes', `${hp}#${nome}`, nome);
    }
  }

  void o.plataforma; // Keychain do macOS fica de fora nesta entrega (decisão do dono).
  return { candidatos, problemas };
}
