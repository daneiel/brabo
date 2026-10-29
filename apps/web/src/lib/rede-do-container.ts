import type { RedeDoContainer } from './api-types';

// Espelho da régua da api (RN-932). A api decide; isto só poupa a ida e volta.
const PORTAS_DA_INSTALACAO = [3000, 4000, 5173, 5432, 7474, 7687, 8088, 8090, 11434];
const RESERVADOS = ['localhost', 'host.docker.internal', 'api', 'engine', 'web', 'postgres', 'neo4j', 'broker', 'ollama'];
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6 = /^[0-9a-f:]+$/i;

export interface RedeEmTexto {
  ports: string; // uma por linha: "host:container"
  dns: string; // um IP por linha
  extraHosts: string; // um por linha: "nome ip"
}

/** `motivo` é uma chave de `containers:rede.erro.*`. */
export type RedeValidada =
  | { ok: true; rede: RedeDoContainer }
  | { ok: false; campo: string; motivo: string };

const linhas = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean);

export function textoDaRede(r: RedeDoContainer | null): RedeEmTexto {
  return {
    ports: (r?.ports ?? []).map((p) => `${p.host}:${p.container}`).join('\n'),
    dns: (r?.dns ?? []).join('\n'),
    extraHosts: (r?.extraHosts ?? []).map((h) => `${h.name} ${h.ip}`).join('\n'),
  };
}

export function validarRedeEmTexto(t: RedeEmTexto): RedeValidada {
  const ports: RedeDoContainer['ports'] = [];
  const l = linhas(t.ports);
  if (l.length > 10) return { ok: false, campo: 'ports', motivo: 'teto' };
  for (const [i, linha] of l.entries()) {
    const m = /^(\d+):(\d+)$/.exec(linha);
    const campo = `ports[${i}]`;
    if (!m) return { ok: false, campo, motivo: 'formatoPorta' };
    const host = Number(m[1]);
    const container = Number(m[2]);
    if (host < 1024 || host > 65535 || container < 1 || container > 65535) {
      return { ok: false, campo, motivo: 'faixaPorta' };
    }
    if (PORTAS_DA_INSTALACAO.includes(host)) return { ok: false, campo, motivo: 'portaDaInstalacao' };
    if (ports.some((p) => p.host === host)) return { ok: false, campo, motivo: 'portaRepetida' };
    ports.push({ host, container, protocol: 'tcp' });
  }
  const dns = linhas(t.dns);
  if (dns.length > 3) return { ok: false, campo: 'dns', motivo: 'teto' };
  for (const [i, ip] of dns.entries()) {
    if (!IPV4.test(ip) && !(ip.includes(':') && IPV6.test(ip))) {
      return { ok: false, campo: `dns[${i}]`, motivo: 'ipInvalido' };
    }
  }
  const hosts = linhas(t.extraHosts);
  if (hosts.length > 10) return { ok: false, campo: 'extraHosts', motivo: 'teto' };
  const extraHosts: RedeDoContainer['extraHosts'] = [];
  for (const [i, linha] of hosts.entries()) {
    const campo = `extraHosts[${i}]`;
    const m = /^([a-z0-9.-]+)\s+(\S+)$/.exec(linha);
    if (!m) return { ok: false, campo, motivo: 'formatoHost' };
    if (RESERVADOS.includes(m[1])) return { ok: false, campo, motivo: 'nomeReservado' };
    if (!IPV4.test(m[2])) return { ok: false, campo, motivo: 'ipInvalido' };
    extraHosts.push({ name: m[1], ip: m[2] });
  }
  return { ok: true, rede: { ports, dns, extraHosts } };
}
