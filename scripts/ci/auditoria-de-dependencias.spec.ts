import { describe, expect, it } from 'vitest';
import {
  classificarAudit,
  decidirDepoisDasTentativas,
  type VereditoDeAudit,
} from './auditoria-de-dependencias.ts';

// Saída REAL do run 33838507158 (PR #468, 2026-09-04). É a assinatura que
// motivou a decisão, então é ela que o teste usa — não uma paráfrase.
const TIMEOUT_REAL = `
[WARN] POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk error (23). Will retry in 10 seconds. 2 retries left.
[WARN] POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk error (503). Will retry in 1 minute. 1 retries left.
TimeoutError: The operation was aborted due to timeout
    at new DOMException (node:internal/per_context/domexception:76:18)
`;

const ACHADO_REAL = `
┌─────────────────────┬────────────────────────────────────────────────────┐
│ critical            │ Prototype Pollution in some-pkg                    │
├─────────────────────┼────────────────────────────────────────────────────┤
│ Vulnerable versions │ <4.17.21                                           │
├─────────────────────┼────────────────────────────────────────────────────┤
│ Patched in          │ >=4.17.21                                          │
└─────────────────────┴────────────────────────────────────────────────────┘
1 vulnerabilities found
`;

describe('classificarAudit', () => {
  it('código 0 é limpo', () => {
    expect(classificarAudit(0, 'nada aqui').tipo).toBe('limpo');
  });

  it('reconhece o timeout real do endpoint de advisories como infra', () => {
    const v = classificarAudit(1, TIMEOUT_REAL);
    expect(v.tipo).toBe('infra');
  });

  it('reconhece relatório de vulnerabilidade como achado', () => {
    expect(classificarAudit(1, ACHADO_REAL).tipo).toBe('achado');
  });

  // A PRECEDÊNCIA é a parte que sustenta a decisão inteira: um relatório que
  // por acaso mencione "timeout" (um pacote com esse nome, um CVE de
  // timeout) não pode virar "infra" e ser perdoado.
  it('achado vence infra quando as duas assinaturas aparecem', () => {
    const misturado = `${TIMEOUT_REAL}\n${ACHADO_REAL}`;
    expect(classificarAudit(1, misturado).tipo).toBe('achado');
  });

  it('achado com a palavra timeout no nome do pacote continua achado', () => {
    const saida = '1 vulnerabilities found\n│ critical │ ReDoS in timeout-parser │';
    expect(classificarAudit(1, saida).tipo).toBe('achado');
  });

  // Fail closed: não entender não é permissão para aprovar.
  it('saída desconhecida com código de erro vira achado, nunca infra', () => {
    const v = classificarAudit(7, 'algo completamente inesperado aconteceu');
    expect(v.tipo).toBe('achado');
    expect(v.motivo).toContain('nunca como infra');
  });

  it('cobre as outras assinaturas de rede', () => {
    for (const s of ['ECONNRESET', 'ENOTFOUND registry.npmjs.org', 'socket hang up']) {
      expect(classificarAudit(1, s).tipo).toBe('infra');
    }
  });
});

const infra = (): VereditoDeAudit => ({ tipo: 'infra', motivo: 'sem resposta' });
const achado = (): VereditoDeAudit => ({ tipo: 'achado', motivo: 'vuln crítica' });
const limpo = (): VereditoDeAudit => ({ tipo: 'limpo', motivo: 'passou' });

describe('decidirDepoisDasTentativas', () => {
  it('três infras viram RISCO ASSUMIDO — verde, mas declarado', () => {
    const d = decidirDepoisDasTentativas([infra(), infra(), infra()]);
    expect(d.ok).toBe(true);
    expect(d.assumido).toBe(true);
    expect(d.motivo).toContain('RISCO ASSUMIDO');
  });

  it('achado reprova mesmo cercado de infra', () => {
    expect(decidirDepoisDasTentativas([infra(), achado(), infra()]).ok).toBe(false);
  });

  it('um limpo em qualquer tentativa aprova sem marcar risco', () => {
    const d = decidirDepoisDasTentativas([infra(), limpo()]);
    expect(d.ok).toBe(true);
    expect(d.assumido).toBe(false);
  });

  // Zero tentativas é bug do chamador, e bug do chamador não vira verde.
  it('nenhuma tentativa reprova', () => {
    expect(decidirDepoisDasTentativas([]).ok).toBe(false);
  });
});
