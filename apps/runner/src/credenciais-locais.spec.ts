import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acharCredenciaisLocais, MAPA_DE_PROVIDERS, PROVIDERS_COM_CREDENCIAL } from './credenciais-locais.ts';

const dirs: string[] = [];
function casa(arquivos: Record<string, unknown>): string {
  const home = mkdtempSync(join(tmpdir(), 'cred-'));
  dirs.push(home);
  for (const [p, v] of Object.entries(arquivos)) {
    mkdirSync(dirname(join(home, p)), { recursive: true });
    writeFileSync(join(home, p), typeof v === 'string' ? v : JSON.stringify(v));
  }
  return home;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const achar = (home: string, env = {}) => acharCredenciaisLocais({ home, env, plataforma: 'linux' });

const SEG = ['sk-FIXT-aaaa1111', 'sk-FIXT-bbbb2222', 'sk-FIXT-cccc3333', 'sk-FIXT-dddd4444', 'sk-FIXT-eeee5555'];

describe('acharCredenciaisLocais', () => {
  it('Claude Code: env e primaryApiKey viram chave; OAuth vira assinatura sem valor; helper não roda', () => {
    const home = casa({
      '.claude.json': { primaryApiKey: SEG[1], apiKeyHelper: '/x/helper.sh' },
      '.claude/.credentials.json': { claudeAiOauth: { accessToken: 'tok-FIXT' } },
    });
    const r = achar(home, { ANTHROPIC_API_KEY: SEG[0] });
    expect(r.candidatos.filter((c) => c.tipo === 'chave-de-api').map((c) => c.valor)).toEqual([SEG[0], SEG[1]]);
    const a = r.candidatos.find((c) => c.tipo === 'assinatura')!;
    expect(a.valor).toBeUndefined();
    expect(JSON.stringify(r)).not.toContain('tok-FIXT');
    expect(r.problemas[0]!.motivo).toBe('script, não executado');
  });

  it('Codex: OPENAI_API_KEY e tokens chatgpt', () => {
    const r = achar(casa({ '.codex/auth.json': { OPENAI_API_KEY: SEG[0], tokens: { a: 1 } } }));
    expect(r.candidatos.map((c) => [c.provider, c.tipo])).toEqual([
      ['openai', 'chave-de-api'],
      ['openai', 'assinatura'],
    ]);
  });

  it('OpenCode e Kilo: auth.json legado, provider sem par vira null, SQLite vira problema', () => {
    const auth = {
      togetherai: { type: 'api', key: SEG[2] },
      exotico: { type: 'api', key: SEG[3] },
      anthropic: { type: 'oauth' },
    };
    const r = achar(
      casa({
        '.local/share/opencode/auth.json': auth,
        '.local/share/opencode/opencode.db': 'x',
        '.local/share/kilo/auth.json': auth,
      }),
    );
    expect(r.candidatos.filter((c) => c.ferramenta === 'opencode').map((c) => c.provider)).toEqual([
      'together',
      null,
      'anthropic',
    ]);
    expect(r.candidatos.some((c) => c.ferramenta === 'kilo')).toBe(true);
    expect(r.problemas.some((p) => p.motivo.includes('SQLite'))).toBe(true);
  });

  it('Hermes: .env + pool sem duplicata por valor; oauth do pool é assinatura', () => {
    const r = achar(
      casa({
        '.hermes/.env': `OPENROUTER_API_KEY="${SEG[4]}"\nNVIDIA_API_KEY=${SEG[0]}\n`,
        '.hermes/auth.json': {
          credential_pool: {
            openrouter: [{ auth_type: 'api_key', access_token: SEG[4] }],
            deepinfra: [{ auth_type: 'oauth' }],
          },
        },
      }),
    );
    expect(r.candidatos.filter((c) => c.tipo === 'chave-de-api').map((c) => c.provider)).toEqual([
      'openrouter',
      'nvidia-nim',
    ]);
    expect(r.candidatos.filter((c) => c.tipo === 'assinatura')).toHaveLength(1);
  });

  it('arquivo corrompido vira problema, não exceção', () => {
    const r = achar(casa({ '.codex/auth.json': '{nao json' }));
    expect(r.candidatos).toEqual([]);
    expect(r.problemas).toEqual([expect.objectContaining({ ferramenta: 'codex', motivo: 'arquivo corrompido' })]);
  });

  it('o texto do comando nunca contém o valor', () => {
    const home = casa({ '.codex/auth.json': { OPENAI_API_KEY: SEG[0] }, '.hermes/.env': `OPENAI_API_KEY=${SEG[1]}` });
    const saida = achar(home, { ANTHROPIC_API_KEY: SEG[2] })
      .candidatos.map((c) => [c.ferramenta, c.origem, c.provider, c.tipo, c.final].join(' '))
      .join('\n');
    for (const s of SEG) expect(saida).not.toContain(s);
    expect(saida).toContain('…1111');
  });
});

describe('MAPA_DE_PROVIDERS', () => {
  it('só aponta para providers que a api aceita com credencial', () => {
    const api = readFileSync(join(import.meta.dirname, '../../api/src/domain/llm/llm-provider-names.ts'), 'utf8');
    for (const p of PROVIDERS_COM_CREDENCIAL) expect(api).toContain(`'${p}'`);
    for (const v of Object.values(MAPA_DE_PROVIDERS)) if (v) expect(PROVIDERS_COM_CREDENCIAL).toContain(v);
  });
});
