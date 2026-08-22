// Brabo — barra lateral compartilhada.
// Menu: Projetos (expansível, com nº de últimas iterações) + Atividades (agrupadas por agente).
// Estado (colapso, projetos abertos, projeto ativo) persiste em localStorage.
(function () {
  const K_COL = 'brabo.sidebar.collapsed';
  const K_OPEN = 'brabo.sidebar.open';
  const K_PROJ = 'brabo.project';
  const K_AG = 'brabo.sidebar.agents';
  const K_TAB = 'brabo.tab';
  const K_THEME = 'brabo.theme';

  const readTheme = () => { try { return localStorage.getItem(K_THEME) === 'light' ? 'light' : 'dark'; } catch (e) { return 'dark'; } };
  const applyTheme = th => {
    document.documentElement.setAttribute('data-theme', th);
    document.documentElement.style.colorScheme = th;
  };
  applyTheme(readTheme());

  const I = {
    spark: '<path d="M12 3v4M12 17v4M4.5 7.5 7 10M17 14l2.5 2.5M3 12h4M17 12h4M4.5 16.5 7 14M17 10l2.5-2.5"/>',
    code: '<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>',
    chat: '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4L3 21l1.1-3.6A8.4 8.4 0 1 1 21 11.5z"/>',
    money: '<path d="M12 3v18M8 7h6a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h6"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 13a7.8 7.8 0 0 0 .1-2l2-1.6-2-3.4-2.4 1a7.8 7.8 0 0 0-1.7-1l-.4-2.5H9.9l-.4 2.5a7.8 7.8 0 0 0-1.7 1l-2.4-1-2 3.4L3.5 11a7.8 7.8 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.8 7.8 0 0 0 1.7 1l.4 2.5h4.2l.4-2.5a7.8 7.8 0 0 0 1.7-1l2.4 1 2-3.4z"/>',
    folder: '<path d="M3 7h6l2 2h10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    bell: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
    chevron: '<path d="M9 6l6 6-6 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z"/>',
  };
  const svg = (n, s, w) => '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (w || 1.6) + '" stroke-linecap="round" stroke-linejoin="round">' + I[n] + '</svg>';

  // abas por projeto
  const TABS = [
    { id: 'criativo', label: 'Criativo', href: 'Brabo%20Criativo.dc.html', icon: 'spark' },
    { id: 'code', label: 'Código', href: 'Brabo%20Code.dc.html', icon: 'code' },
    { id: 'chat', label: 'Chat RAG', href: 'Brabo%20Chat.dc.html', icon: 'chat' },
    { id: 'gastos', label: 'Gastos', href: 'Brabo%20Gastos.dc.html', icon: 'money' },
    { id: 'approvals', label: 'Aprovações', href: 'Brabo%20Approvals.dc.html', icon: 'check' },
    { id: 'settings', label: 'Configurações', href: 'Brabo%20Settings.dc.html', icon: 'gear' },
  ];

  const PROJECTS = [
    { id: 'brabo-api', name: 'brabo-api', iters: 128, tone: '#D6633A' },
    { id: 'mobile-app', name: 'mobile-app', iters: 74, tone: '#E05A3E' },
    { id: 'payments-svc', name: 'payments-svc', iters: 51, tone: '#37B3A4' },
    { id: 'web-dashboard', name: 'web-dashboard', iters: 33, tone: '#37B3A4' },
    { id: 'infra-core', name: 'infra-core', iters: 22, tone: '#E0982F' },
    { id: 'ml-pipeline', name: 'ml-pipeline', iters: 9, tone: '#6E8A94' },
  ];

  // últimas 5 notificações gerais
  const FEED = [
    { agent: 'Dev Backend', tone: '#37B3A4', text: 'PR #241 aberta · auth OAuth', time: '12min' },
    { agent: 'Arquiteto', tone: '#D6633A', text: 'Migração 006 aguarda aprovação', time: '38min' },
    { agent: 'QA', tone: '#E0982F', text: 'test:e2e falhou em mobile-app', time: '1h' },
    { agent: 'PO', tone: '#9C7BE0', text: '3 histórias criadas no épico #241', time: '2h' },
    { agent: 'Psicólogo', tone: '#9C7BE0', text: 'Hipótese de latência registrada', time: '3h' },
  ];

  // atividades agrupadas por agente (agentes com várias instâncias têm 2 níveis)
  const AGENTS = [
    { id: 'dev', name: 'Dev Backend', tone: '#37B3A4', instances: [
      { id: 'dev-01', name: 'dev-backend-01', events: [
        { text: 'PR #241 aberta · auth OAuth', time: '12min' },
        { text: 'git push origin feature/refresh-grace', time: '26min' },
        { text: 'Índice composto aplicado em Payment', time: '1h' } ] },
      { id: 'dev-02', name: 'dev-backend-02', events: [
        { text: 'Migração 006 preparada', time: '38min' },
        { text: 'pytest tests/test_session.py · 3 passed', time: '2h' } ] } ] },
    { id: 'arq', name: 'Arquiteto', tone: '#D6633A', instances: [
      { id: 'arq-01', name: 'arquiteto-01', events: [
        { text: 'Migração 006 aguarda aprovação', time: '38min' },
        { text: 'ADR-014 publicada · latência checkout', time: '3h' } ] } ] },
    { id: 'qa', name: 'QA', tone: '#E0982F', instances: [
      { id: 'qa-01', name: 'qa-01', events: [
        { text: 'test:e2e falhou em mobile-app', time: '1h' },
        { text: 'Release rc aprovada em web-dashboard', time: '5h' } ] },
      { id: 'qa-02', name: 'qa-02', events: [
        { text: 'Suite de regressão agendada', time: '6h' } ] } ] },
    { id: 'po', name: 'PO', tone: '#9C7BE0', instances: [
      { id: 'po-01', name: 'po-01', events: [
        { text: '3 histórias criadas no épico #241', time: '2h' },
        { text: 'Critérios de aceite revisados', time: '4h' } ] } ] },
    { id: 'psi', name: 'Psicólogo', tone: '#9C7BE0', instances: [
      { id: 'psi-01', name: 'psicologo-01', events: [
        { text: 'Hipótese de latência registrada', time: '3h' } ] } ] },
    { id: 'dsg', name: 'Design Review', tone: '#AEC6CE', instances: [
      { id: 'dsg-01', name: 'design-review-01', events: [
        { text: 'Revisão do fluxo de pagamento', time: '1d' } ] } ] },
  ];
  const countOf = a => a.instances.reduce((n, i) => n + i.events.length, 0);

  const initials = n => n.split(/[\s-]/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();

  class BraboSidebar extends HTMLElement {
    static get observedAttributes() { return ['active', 'project']; }

    wantsAutoCollapse() { return this.hasAttribute('auto-collapse') || this.hasAttribute('autocollapse') || this.hasAttribute('autoCollapse'); }

    connectedCallback() {
      try {
        if (localStorage.getItem(K_COL) === '1') this.setAttribute('collapsed', '');
        this.open = JSON.parse(localStorage.getItem(K_OPEN) || 'null') || [this.currentProject()];
        this.openAgents = JSON.parse(localStorage.getItem(K_AG) || 'null') || ['dev'];
      } catch (e) { this.open = [this.currentProject()]; this.openAgents = ['dev']; }
      if (this.wantsAutoCollapse()) this.setAttribute('collapsed', '');
      this.render();
    }

    attributeChangedCallback() { if (this.shadowRoot) this.render(); }

    currentProject() {
      let saved = null;
      try { saved = localStorage.getItem(K_PROJ); } catch (e) { }
      return this.getAttribute('project') || saved || 'brabo-api';
    }

    toggleCollapsed() {
      const next = !this.hasAttribute('collapsed');
      if (next) this.setAttribute('collapsed', ''); else this.removeAttribute('collapsed');
      try { localStorage.setItem(K_COL, next ? '1' : '0'); } catch (e) { }
      this.render();
    }

    toggleTheme() {
      const next = readTheme() === 'light' ? 'dark' : 'light';
      try { localStorage.setItem(K_THEME, next); } catch (e) { }
      applyTheme(next);
      this.render();
    }

    toggleAgent(id) {
      this.openAgents = this.openAgents.includes(id) ? this.openAgents.filter(x => x !== id) : this.openAgents.concat(id);
      try { localStorage.setItem(K_AG, JSON.stringify(this.openAgents)); } catch (e) { }
      this.render();
    }

    toggleProject(id) {
      this.open = this.open.includes(id) ? this.open.filter(x => x !== id) : this.open.concat(id);
      try { localStorage.setItem(K_OPEN, JSON.stringify(this.open)); localStorage.setItem(K_PROJ, id); } catch (e) { }
      this.render();
    }

    render() {
      const root = this.shadowRoot || this.attachShadow({ mode: 'open' });
      const collapsed = this.hasAttribute('collapsed');
      const theme = readTheme();
      const active = this.getAttribute('active') || '';
      const proj = this.currentProject();
      const user = this.getAttribute('user') || 'Rafael Souza';
      const role = this.getAttribute('role') || 'sênior · owner';
      const ini = this.getAttribute('initials') || 'RS';

      const projectRows = PROJECTS.map(p => {
        const open = this.open.includes(p.id);
        const isCur = p.id === proj;
        const subs = TABS.map(t =>
          '<a class="sub' + (isCur && t.id === active ? ' on' : '') + '" data-tab="' + t.id + '" href="' + t.href + '" title="' + t.label + '">' +
            '<span class="ico">' + svg(t.icon, 14) + '</span><span class="lbl">' + t.label + '</span></a>').join('');
        return '<div class="proj">' +
          '<button class="item prow' + (isCur ? ' cur' : '') + '" type="button" data-proj="' + p.id + '" title="' + p.name + '">' +
            '<span class="chev' + (open ? ' open' : '') + '">' + svg('chevron', 12, 2) + '</span>' +
            '<span class="dot" style="background:' + p.tone + '"></span>' +
            '<span class="lbl mono">' + p.name + '</span>' +
            '<span class="badge" title="últimas iterações">' + p.iters + '</span>' +
          '</button>' +
          (open ? '<div class="subs">' + subs + '</div>' : '') +
        '</div>';
      }).join('');

      const feed = FEED.map(e =>
        '<div class="ev">' +
          '<span class="av" style="background:color-mix(in srgb,' + e.tone + ' 18%,transparent);border-color:color-mix(in srgb,' + e.tone + ' 50%,transparent);color:' + e.tone + '">' + initials(e.agent) + '</span>' +
          '<span class="evtxt"><span class="evline">' + e.text + '</span><span class="evmeta">' + e.agent + ' · ' + e.time + '</span></span>' +
        '</div>').join('');

      const evRow = (tone, agent, e) =>
        '<div class="ev"><span class="av" style="background:color-mix(in srgb,' + tone + ' 18%,transparent);border-color:color-mix(in srgb,' + tone + ' 50%,transparent);color:' + tone + '">' + initials(agent) + '</span>' +
        '<span class="evtxt"><span class="evline">' + e.text + '</span><span class="evmeta">' + agent + ' · ' + e.time + '</span></span></div>';

      const agents = AGENTS.map(a => {
        const open = this.openAgents.includes(a.id);
        const multi = a.instances.length > 1;
        let inner = '';
        if (open) {
          inner = multi
            ? a.instances.map(inst => {
                const io = this.openAgents.includes(a.id + '/' + inst.id);
                return '<div><button class="item irow" type="button" data-agent="' + a.id + '/' + inst.id + '" title="' + inst.name + '">' +
                  '<span class="chev' + (io ? ' open' : '') + '">' + svg('chevron', 11, 2) + '</span>' +
                  '<span class="lbl mono">' + inst.name + '</span>' +
                  '<span class="badge">' + inst.events.length + '</span></button>' +
                  (io ? '<div class="evs">' + inst.events.map(e => evRow(a.tone, inst.name, e)).join('') + '</div>' : '') + '</div>';
              }).join('')
            : a.instances[0].events.map(e => evRow(a.tone, a.instances[0].name, e)).join('');
          inner = '<div class="subs">' + inner + '</div>';
        }
        return '<div>' +
          '<button class="item arow" type="button" data-agent="' + a.id + '" title="' + a.name + ' · ' + countOf(a) + ' interações">' +
            '<span class="chev' + (open ? ' open' : '') + '">' + svg('chevron', 12, 2) + '</span>' +
            '<span class="dot" style="background:' + a.tone + '"></span>' +
            '<span class="lbl">' + a.name + '</span>' +
            (multi ? '<span class="badge" title="instâncias">' + a.instances.length + '×</span>' : '') +
            '<span class="badge">' + countOf(a) + '</span>' +
          '</button>' + inner + '</div>';
      }).join('');

      const railProjects = PROJECTS.map(p =>
        '<button class="rail' + (p.id === proj ? ' cur' : '') + '" type="button" data-proj="' + p.id + '" title="' + p.name + ' · ' + p.iters + ' iterações">' +
          '<span class="sq" style="border-color:' + p.tone + '">' + initials(p.name) + '</span></button>').join('');

      root.innerHTML =
        '<style>' +
        ':host{display:flex;flex-direction:column;height:100vh;width:264px;flex-shrink:0;background:var(--surface-1,#0A2E3D);border-right:1px solid var(--border,#1C4A5A);font-family:Archivo,sans-serif;transition:width .18s ease;overflow:hidden;}' +
        ':host([collapsed]){width:62px;}' +
        '.brand{text-decoration:none;cursor:pointer;display:flex;align-items:center;gap:11px;padding:16px 15px;border-bottom:1px solid var(--border,#1C4A5A);flex-shrink:0;}' +
        '.mark{width:32px;height:32px;border-radius:9px;background:var(--accent,#D6633A);display:grid;place-items:center;flex-shrink:0;}' +
        '.word{font-family:"Space Grotesk",sans-serif;font-weight:700;font-size:17px;letter-spacing:-.02em;color:var(--text-primary,#F5EDE0);white-space:nowrap;}' +
        '.body{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;}' +
        '.body::-webkit-scrollbar{width:8px;}.body::-webkit-scrollbar-thumb{background:var(--border-strong,#2E6072);border-radius:6px;border:2px solid var(--surface-1,#0A2E3D);}' +
        '.sect{display:flex;align-items:center;gap:8px;padding:15px 14px 7px;font-family:"IBM Plex Mono",monospace;font-size:10px;font-weight:600;letter-spacing:.1em;color:var(--text-muted,#6E8A94);text-transform:uppercase;white-space:nowrap;}' +
        '.sect .grow{flex:1;}' +
        '.sect button{background:none;border:none;color:var(--text-muted,#6E8A94);cursor:pointer;padding:0;display:grid;place-items:center;}' +
        '.sect button:hover{color:var(--accent,#D6633A);}' +
        '.group{padding:0 8px;display:flex;flex-direction:column;gap:2px;}' +
        '.item{display:flex;align-items:center;gap:9px;width:100%;padding:8px 10px;border:none;border-radius:8px;background:transparent;color:var(--text-secondary,#AEC6CE);font-family:Archivo,sans-serif;font-size:13px;font-weight:500;text-decoration:none;white-space:nowrap;cursor:pointer;text-align:left;}' +
        '.item:hover{background:var(--surface-2,#123F4E);color:var(--text-primary,#F5EDE0);}' +
        '.item.cur{background:var(--surface-2,#123F4E);color:var(--text-primary,#F5EDE0);}' +
        '.mono{font-family:"IBM Plex Mono",monospace;font-size:12.5px;}' +
        '.lbl{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;}' +
        '.chev{display:grid;place-items:center;width:12px;height:12px;flex-shrink:0;color:var(--text-muted,#6E8A94);transition:transform .15s;}' +
        '.chev.open{transform:rotate(90deg);color:var(--accent,#D6633A);}' +
        '.dot{width:8px;height:8px;border-radius:2px;flex-shrink:0;}' +
        '.badge{min-width:20px;height:18px;padding:0 6px;border-radius:9px;background:var(--surface-2,#123F4E);color:var(--text-secondary,#AEC6CE);font-family:"IBM Plex Mono",monospace;font-size:10px;font-weight:600;display:grid;place-items:center;flex-shrink:0;}' +
        '.prow.cur .badge{background:color-mix(in srgb,var(--accent,#D6633A) 18%,transparent);color:var(--accent,#D6633A);}' +
        '.subs{display:flex;flex-direction:column;gap:1px;margin:2px 0 6px 19px;padding-left:9px;border-left:1px solid var(--border,#1C4A5A);}' +
        '.sub{display:flex;align-items:center;gap:9px;padding:6px 9px;border-radius:7px;color:var(--text-muted,#6E8A94);font-size:12.5px;text-decoration:none;white-space:nowrap;}' +
        '.sub:hover{background:var(--surface-2,#123F4E);color:var(--text-primary,#F5EDE0);}' +
        '.sub.on{background:var(--surface-2,#123F4E);color:var(--text-primary,#F5EDE0);font-weight:600;}' +
        '.sub.on .ico{color:var(--accent,#D6633A);}' +
        '.ico{display:grid;place-items:center;flex-shrink:0;}' +
        '.ev{display:flex;gap:9px;align-items:flex-start;padding:7px 10px;border-radius:8px;}' +
        '.ev:hover{background:var(--surface-2,#123F4E);}' +
        '.av{width:22px;height:22px;border-radius:6px;border:1px solid;display:grid;place-items:center;font-family:"IBM Plex Mono",monospace;font-size:9px;font-weight:600;flex-shrink:0;}' +
        '.irow{padding:6px 9px;}' +
        '.evs{margin-left:14px;padding-left:8px;border-left:1px solid var(--border,#1C4A5A);}' +
        '.evtxt{display:flex;flex-direction:column;min-width:0;}' +
        '.evline{font-size:12px;color:var(--text-secondary,#AEC6CE);line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
        '.evmeta{font-family:"IBM Plex Mono",monospace;font-size:10px;color:var(--text-muted,#6E8A94);}' +
        '.subhead{padding:12px 14px 6px;font-family:"IBM Plex Mono",monospace;font-size:10px;color:var(--text-muted,#6E8A94);white-space:nowrap;}' +
        '.rails{display:none;flex-direction:column;align-items:center;gap:4px;padding:10px 0;}' +
        '.rail{width:40px;height:40px;border:none;background:transparent;border-radius:9px;display:grid;place-items:center;cursor:pointer;}' +
        '.rail:hover{background:var(--surface-2,#123F4E);}' +
        '.rail.cur{background:var(--surface-2,#123F4E);}' +
        '.sq{width:28px;height:28px;border-radius:7px;border:1px solid;display:grid;place-items:center;font-family:"IBM Plex Mono",monospace;font-size:10px;font-weight:600;color:var(--text-secondary,#AEC6CE);}' +
        '.foot{border-top:1px solid var(--border,#1C4A5A);padding:8px;flex-shrink:0;}' +
        '.theme{width:100%;display:flex;align-items:center;gap:10px;padding:8px 10px;border:none;border-radius:8px;background:transparent;color:var(--text-muted,#6E8A94);font-family:"IBM Plex Mono",monospace;font-size:11px;cursor:pointer;text-align:left;}' +
        '.theme:hover{background:var(--surface-2,#123F4E);color:var(--text-primary,#F5EDE0);}' +
        '.theme .tlbl{flex:1;}' +
        '.tstate{font-family:"IBM Plex Mono",monospace;font-size:10px;color:var(--text-muted,#6E8A94);border:1px solid var(--border,#1C4A5A);border-radius:5px;padding:1px 6px;}' +
        ':host([collapsed]) .theme{justify-content:center;padding:9px 0;}' +
        ':host([collapsed]) .tstate{display:none;}' +
        '.toggle{width:100%;display:flex;align-items:center;gap:10px;padding:8px 10px;border:none;border-radius:8px;background:transparent;color:var(--text-muted,#6E8A94);font-family:"IBM Plex Mono",monospace;font-size:11px;cursor:pointer;text-align:left;}' +
        '.toggle:hover{background:var(--surface-2,#123F4E);color:var(--text-primary,#F5EDE0);}' +
        '.user{display:flex;align-items:center;gap:11px;padding:12px;border-top:1px solid var(--border,#1C4A5A);flex-shrink:0;}' +
        '.uav{width:34px;height:34px;border-radius:8px;background:linear-gradient(135deg,var(--accent,#D6633A),var(--warning,#E0982F));display:grid;place-items:center;font-family:"Space Grotesk",sans-serif;font-weight:700;font-size:13px;color:var(--on-accent,#F7EEE2);flex-shrink:0;}' +
        '.uinfo{flex:1;min-width:0;display:flex;flex-direction:column;}' +
        '.uname{font-size:13px;font-weight:600;color:var(--text-primary,#F5EDE0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
        '.urole{font-family:"IBM Plex Mono",monospace;font-size:11px;color:var(--text-muted,#6E8A94);white-space:nowrap;}' +
        ':host([collapsed]) .word,:host([collapsed]) .sect,:host([collapsed]) .group,:host([collapsed]) .subhead,:host([collapsed]) .uinfo,:host([collapsed]) .tlbl{display:none;}' +
        ':host([collapsed]) .rails{display:flex;}' +
        ':host([collapsed]) .brand{justify-content:center;padding:16px 0;}' +
        ':host([collapsed]) .toggle{justify-content:center;padding:9px 0;}' +
        ':host([collapsed]) .user{justify-content:center;padding:12px 0;}' +
        '</style>' +
        '<a class="brand" href="Brabo%20App.dc.html" title="Projetos"><span class="mark"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--on-accent,#F7EEE2)" stroke-linecap="round" stroke-linejoin="round"><path d="M5.4 3.6v16.8" stroke-width="3.4"/><path d="M10.4 4.6l5.6 3.8-5.6 3.8" stroke-width="2.8"/><path d="M10.4 12l5.6 3.8-5.6 3.8" stroke-width="2.8" opacity=".58"/></svg></span><span class="word">Brabo</span></a>' +
        '<div class="body">' +
          '<div class="rails">' + railProjects +
            '<button class="rail" type="button" title="Atividades · 5 novas"><span class="sq" style="border-color:var(--border-strong,#2E6072)">' + svg('bell', 14) + '</span></button>' +
          '</div>' +
          '<div class="sect"><span class="grow">Projetos</span><button type="button" title="Novo projeto">' + svg('plus', 14, 1.9) + '</button></div>' +
          '<div class="group">' + projectRows + '</div>' +
          '<div class="sect"><span class="grow">Atividades</span><span style="font-family:\'IBM Plex Mono\',monospace;color:var(--accent,#D6633A);">5 novas</span></div>' +
          '<div class="group">' + feed + '</div>' +
          '<div class="subhead">agrupadas por agente · clique para expandir</div>' +
          '<div class="group">' + agents + '</div>' +
        '</div>' +
        '<div class="foot">' +
          '<button class="theme" type="button" title="' + (theme === 'light' ? 'Modo escuro' : 'Modo claro') + '" aria-label="Alternar tema">' +
            '<span class="ico">' + svg(theme === 'light' ? 'moon' : 'sun', 16) + '</span>' +
            '<span class="tlbl">' + (theme === 'light' ? 'Modo escuro' : 'Modo claro') + '</span>' +
            '<span class="tstate">' + (theme === 'light' ? 'claro' : 'escuro') + '</span>' +
          '</button>' +
          '<button class="toggle" type="button" title="' + (collapsed ? 'Expandir menu' : 'Recolher menu') + '">' +
          '<span class="ico">' + (collapsed
            ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6M4 6v12"/></svg>'
            : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6M20 6v12"/></svg>') + '</span>' +
          '<span class="tlbl">Recolher menu</span></button></div>' +
        '<div class="user"><span class="uav">' + ini + '</span><span class="uinfo"><span class="uname">' + user + '</span><span class="urole">' + role + '</span></span></div>';

      root.querySelector('.toggle').addEventListener('click', () => this.toggleCollapsed());
      root.querySelector('.theme').addEventListener('click', () => this.toggleTheme());
      root.querySelectorAll('[data-agent]').forEach(b => b.addEventListener('click', () => this.toggleAgent(b.getAttribute('data-agent'))));
      root.querySelectorAll('.sub').forEach(a => a.addEventListener('click', () => { try { localStorage.setItem(K_TAB, a.getAttribute('data-tab') || ''); } catch (e) { } }));
      root.querySelectorAll('[data-proj]').forEach(b => b.addEventListener('click', () => {
        if (this.hasAttribute('collapsed')) { this.removeAttribute('collapsed'); try { localStorage.setItem(K_COL, '0'); } catch (e) { } }
        this.toggleProject(b.getAttribute('data-proj'));
      }));
    }
  }

  if (!customElements.get('brabo-sidebar')) customElements.define('brabo-sidebar', BraboSidebar);
})();
