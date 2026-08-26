/**
 * Sonda o painel de transferências do SERPRO — diagnóstico, não integração.
 *
 * Por que existe: o ambiente onde este projeto é escrito não alcança gov.br, e
 * as tentativas de integrar às cegas produziram código que parecia funcionar e
 * não funcionava. Esta sonda roda no Cloud Shell, que alcança, e imprime o que
 * cada passo respondeu.
 *
 *   cd ~/applegis && git pull origin main
 *   node teste/sonda-painel.mjs
 *
 * Mande a saída inteira, sobretudo os erros.
 *
 * A primeira versão desta sonda imprimia "fetch failed" e parava. Essa é a
 * mensagem genérica do Node: a causa de verdade fica em `error.cause`, e sem
 * ela não há diagnóstico nenhum — só a constatação de que não funcionou. Esta
 * versão desce a escada inteira, do DNS ao protocolo, e diz em qual degrau
 * parou e por quê.
 */

const HOST = 'dd-publico.serpro.gov.br';
const PAGINA = `https://${HOST}/extensions/painel/DiscricionariasEmendas.html`;

// Lidos do config.js que o próprio painel publica — não são palpite.
const APP = '37c409c6-51a4-405a-9098-2d426367c982';
const OBJETO = 'LhzUJw'; // "Lista de emendas com instrumentos celebrados"

// Alguns serviços de governo recusam cliente sem cara de navegador. Custa nada
// parecer um, e elimina uma hipótese inteira do diagnóstico.
const CABECALHOS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9',
};

const anotar = (passo, texto) => console.log(`[${passo}] ${texto}`);

/** A cadeia de causas, que é onde mora a explicação de verdade. */
function porQue(erro) {
  const partes = [];
  let e = erro;
  for (let i = 0; e && i < 6; i += 1) {
    partes.push(`${e.name || 'Error'}: ${e.message}${e.code ? ` (${e.code})` : ''}`);
    e = e.cause;
  }
  return partes.join('  ←  ');
}

function fim(mensagem) {
  console.log(`\n${mensagem}`);
  console.log('───────────────────────────────────────────────');
  console.log('Copie tudo acima e mande de volta.');
  process.exit(0);
}

console.log(`Node ${process.version} · ${new Date().toISOString()}`);
console.log(`Alvo: ${HOST}\n`);

// ─────────────────────── 0. o ambiente enxerga a internet? ───────────────────────
//
// Se nem um site fora do governo responder, o problema é a rede da máquina e
// não o painel — e todo o resto do diagnóstico seria leitura errada.
try {
  const r = await fetch('https://example.com', { headers: CABECALHOS });
  anotar(0, `internet OK (example.com → ${r.status})`);
} catch (erro) {
  anotar(0, `SEM INTERNET NESTA MÁQUINA: ${porQue(erro)}`);
  fim('✗ Nada a concluir sobre o painel: a máquina não alcança nem example.com.');
}

// ─────────────────────────── 1. DNS ───────────────────────────
try {
  const dns = await import('node:dns/promises');
  const enderecos = await dns.lookup(HOST, { all: true });
  anotar(1, `DNS resolveu: ${enderecos.map((e) => `${e.address} (IPv${e.family})`).join(', ')}`);
} catch (erro) {
  anotar(1, `DNS FALHOU: ${porQue(erro)}`);
  fim('✗ O nome não resolve. Ou o host mudou, ou esta rede não resolve domínios .gov.br.');
}

// ─────────────────────── 2. porta 443 e certificado ───────────────────────
//
// Separado do GET de propósito: recusa de conexão, bloqueio de firewall e
// cadeia de certificado incompleta são três causas diferentes que o `fetch`
// resume na mesma frase.
try {
  const tls = await import('node:tls');
  const socket = await new Promise((ok, falha) => {
    const s = tls.connect({ host: HOST, port: 443, servername: HOST, timeout: 15000 }, () => ok(s));
    s.on('error', falha);
    s.on('timeout', () => { s.destroy(); falha(new Error('sem resposta em 15s')); });
  });
  const cert = socket.getPeerCertificate();
  anotar(2, `TLS conectou · protocolo ${socket.getProtocol()}`);
  anotar(2, `certificado: ${cert.subject?.CN || '?'} · emitido por ${cert.issuer?.CN || '?'} · válido até ${cert.valid_to || '?'}`);
  anotar(2, `autorizado pela âncora do Node: ${socket.authorized ? 'sim' : `NÃO — ${socket.authorizationError}`}`);
  socket.destroy();
} catch (erro) {
  anotar(2, `TLS FALHOU: ${porQue(erro)}`);
  fim('✗ A conexão não se estabelece. Firewall de saída, ou o host recusa esta origem.');
}

// ─────────────────── 3. o GET, seguindo redirecionamento à mão ───────────────────
//
// `redirect: 'follow'` só devolve os cabeçalhos da resposta final, e é no meio
// do caminho que o Qlik troca o ticket por sessão. O cookie que interessa pode
// nascer e morrer num salto que o fetch automático esconde. Aqui cada salto é
// visto, e todos os cookies se acumulam.

const potes = new Map();
function guardar(resposta) {
  for (const bruto of resposta.headers.getSetCookie?.() || []) {
    const [par] = bruto.split(';');
    const igual = par.indexOf('=');
    if (igual > 0) potes.set(par.slice(0, igual).trim(), par.slice(igual + 1).trim());
  }
}
const cookieAtual = () => [...potes].map(([k, v]) => `${k}=${v}`).join('; ');

let alcancou = false;
let alvo = PAGINA;
for (let salto = 0; salto < 6; salto += 1) {
  let r;
  try {
    // eslint-disable-next-line no-await-in-loop
    r = await fetch(alvo, {
      headers: { ...CABECALHOS, ...(potes.size ? { Cookie: cookieAtual() } : {}) },
      redirect: 'manual',
    });
  } catch (erro) {
    anotar(3, `${alvo} FALHOU: ${porQue(erro)}`);
    break;
  }
  alcancou = true;
  guardar(r);
  const local = r.headers.get('location');
  anotar(3, `salto ${salto}: ${r.status} ${r.statusText} ${alvo.replace(`https://${HOST}`, '')}`);
  const novos = (r.headers.getSetCookie?.() || []).map((c) => c.split('=')[0]);
  if (novos.length) anotar(3, `  cookies: ${novos.join(', ')}`);
  if (!local) {
    // eslint-disable-next-line no-await-in-loop
    const t = await r.text();
    anotar(3, `  corpo: ${t.length} caracteres`);
    if (t.length <= 400) anotar(3, `  corpo: ${t.replace(/\s+/g, ' ').trim()}`);
    break;
  }
  anotar(3, `  → ${local}`);
  alvo = new URL(local, alvo).href;
}
if (!alcancou) fim('✗ O TLS conecta mas o HTTP não completa.');
anotar(3, `cookie acumulado: ${cookieAtual() || 'NENHUM'}`);

// ── 3b. o que o próprio cliente do painel chama antes de abrir o socket ──
//
// No HAR do gabinete apareceram `csrftoken?xrfkey=`, `user?xrfkey=` e
// `features?xrfkey=`. O xrfkey é a defesa do Qlik contra requisição forjada:
// dezesseis caracteres, iguais na URL e no cabeçalho. Se o socket exigir isso,
// é aqui que se descobre.
const XRF = 'abcdefghij123456';
let csrf = null;
for (const caminho of ['/api/v1/csrftoken', '/qps/user', '/api/v1/user']) {
  try {
    // eslint-disable-next-line no-await-in-loop
    const r = await fetch(`https://${HOST}${caminho}?xrfkey=${XRF}`, {
      headers: { ...CABECALHOS, Cookie: cookieAtual(), 'X-Qlik-Xrfkey': XRF },
    });
    guardar(r);
    const t = await r.text();
    anotar('3b', `${caminho} → ${r.status} · ${t.slice(0, 120).replace(/\s+/g, ' ')}`);
    const achado = r.headers.get('qlik-csrf-token');
    if (achado) { csrf = achado; anotar('3b', `  token de CSRF no cabeçalho: ${csrf.slice(0, 12)}…`); }
  } catch (erro) {
    anotar('3b', `${caminho} → ${porQue(erro)}`);
  }
}

// ─────────────────────── 4. o WebSocket, em variantes ───────────────────────
//
// O código 1006 da rodada anterior é "fechou sem dizer por quê", que não
// distingue origem recusada de endereço errado. Em vez de adivinhar qual das
// duas, tenta-se a matriz e relata-se qual passou.

if (typeof WebSocket === 'undefined') {
  anotar(4, `Node ${process.version} não tem WebSocket global — precisa de v22+.`);
  fim('✗ Atualize o Node: nvm install 22 && nvm use 22');
}

const aleatorio = () => Math.random().toString(36).slice(2, 10);
const variantes = [
  { nome: 'app + Origin', url: `wss://${HOST}/app/${APP}`, origem: true },
  { nome: 'app + Origin + Xrfkey', url: `wss://${HOST}/app/${APP}?Xrfkey=${XRF}`, origem: true, xrf: true },
  { nome: 'app/identity + Origin', url: `wss://${HOST}/app/${APP}/identity/${aleatorio()}`, origem: true },
  { nome: 'engineData + Origin', url: `wss://${HOST}/app/engineData`, origem: true },
  { nome: 'app sem Origin (o que falhou antes)', url: `wss://${HOST}/app/${APP}`, origem: false },
];

async function tentarSocket(v) {
  const headers = { Cookie: cookieAtual() };
  if (v.origem) headers.Origin = `https://${HOST}`;
  if (v.xrf) headers['X-Qlik-Xrfkey'] = XRF;
  if (csrf) headers['qlik-csrf-token'] = csrf;

  let s;
  try {
    s = new WebSocket(v.url, { headers });
  } catch (erro) {
    return { ok: false, motivo: porQue(erro) };
  }
  const desfecho = await new Promise((ok) => {
    let motivo = null;
    s.addEventListener('open', () => ok({ ok: true, socket: s }), { once: true });
    s.addEventListener('error', (e) => { motivo = porQue(e.error || e); }, { once: true });
    s.addEventListener('close', (e) => ok({ ok: false, motivo: motivo || `código ${e.code}${e.reason ? ` — ${e.reason}` : ''}` }), { once: true });
    setTimeout(() => ok({ ok: false, motivo: 'sem resposta em 15s' }), 15000);
  });
  if (!desfecho.ok) { try { s.close(); } catch { /* já fechado */ } }
  return desfecho;
}

let socket = null;
for (const v of variantes) {
  // eslint-disable-next-line no-await-in-loop
  const r = await tentarSocket(v);
  anotar(4, `${r.ok ? 'ABRIU  ' : 'recusou'} · ${v.nome}${r.ok ? '' : ` · ${r.motivo}`}`);
  if (r.ok) { socket = r.socket; anotar(4, `→ o endereço que funciona é ${v.url.replace(`wss://${HOST}`, '')}`); break; }
}
if (!socket) {
  fim('✗ Nenhuma variante abriu. O painel exige sessão de navegador de verdade — a coleta terá de acontecer na própria aba dele.');
}

// ─────────────────────────── 5. o protocolo ───────────────────────────

const pendentes = new Map();
let proximoId = 0;
const chamar = (handle, metodo, params = []) => {
  proximoId += 1;
  const id = proximoId;
  return new Promise((ok, falha) => {
    const relogio = setTimeout(() => { pendentes.delete(id); falha(new Error(`sem resposta a ${metodo} em 20s`)); }, 20000);
    pendentes.set(id, {
      ok: (m) => { clearTimeout(relogio); ok(m); },
      falha: (e) => { clearTimeout(relogio); falha(e); },
    });
    socket.send(JSON.stringify({ jsonrpc: '2.0', id, handle, method: metodo, params }));
  });
};

socket.addEventListener('message', (e) => {
  let msg;
  try { msg = JSON.parse(e.data); } catch { return; }
  if (msg.id === undefined) return; // aviso do motor, não resposta
  const espera = pendentes.get(msg.id);
  if (!espera) return;
  pendentes.delete(msg.id);
  if (msg.error) espera.falha(new Error(`${msg.error.message} (código ${msg.error.code})`));
  else espera.ok(msg);
});

try {
  const doc = (await chamar(-1, 'OpenDoc', [APP])).result?.qReturn?.qHandle;
  anotar(5, `OpenDoc → handle ${doc}`);
  if (!Number.isInteger(doc)) throw new Error('o aplicativo não abriu');

  const alvo = (await chamar(doc, 'GetObject', [OBJETO])).result?.qReturn?.qHandle;
  anotar(5, `GetObject(${OBJETO}) → handle ${alvo}`);
  if (!Number.isInteger(alvo)) throw new Error('o objeto da tabela não existe');

  const cubo = (await chamar(alvo, 'GetLayout', [])).result?.qLayout?.qHyperCube || {};
  const titulos = [
    ...(cubo.qDimensionInfo || []).map((c) => c.qFallbackTitle),
    ...(cubo.qMeasureInfo || []).map((c) => c.qFallbackTitle),
  ];
  anotar(5, `colunas (${titulos.length}): ${titulos.join(' | ')}`);
  anotar(5, `tamanho: ${cubo.qSize?.qcy} linhas × ${cubo.qSize?.qcx} colunas`);

  const largura = Math.max(1, cubo.qSize?.qcx || 14);
  const pedir = async (quando) => {
    const p = await chamar(alvo, 'GetHyperCubeData', ['/qHyperCubeDef', [{ qTop: 0, qLeft: 0, qHeight: 3, qWidth: largura }]]);
    const m = p.result?.qDataPages?.[0]?.qMatrix || [];
    anotar(5, `${quando} → ${m.length} linha(s)`);
    m.forEach((l, i) => anotar(5, `  ${i + 1}: ${l.map((c) => c.qText).join(' | ').slice(0, 220)}`));
    return m.length;
  };

  // Sem parlamentar selecionado a tabela vem vazia de propósito — a própria
  // descrição do objeto avisa. Saber se vem vazia ou não já é informação.
  await pedir('sem filtro');

  for (const campo of ['Nome Parlamentar Emenda', 'Parlamentar Autor Emenda', 'Autor Emenda']) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const h = (await chamar(doc, 'GetField', [campo])).result?.qReturn?.qHandle;
      if (!Number.isInteger(h)) { anotar(5, `campo "${campo}": não existe`); continue; }
      // eslint-disable-next-line no-await-in-loop
      const r = await chamar(h, 'Select', ['MARCEL VAN HATTEM', false, 0]);
      anotar(5, `campo "${campo}": Select → ${r.result?.qReturn}`);
      // eslint-disable-next-line no-await-in-loop
      if (r.result?.qReturn === true && await pedir('com MARCEL VAN HATTEM selecionado')) break;
    } catch (erro) {
      anotar(5, `campo "${campo}": ${porQue(erro)}`);
    }
  }

  try { socket.close(); } catch { /* já fechado */ }
  fim('✓ O caminho automático FUNCIONA. Mande esta saída que eu construo.');
} catch (erro) {
  anotar(5, `FALHOU: ${porQue(erro)}`);
  try { socket.close(); } catch { /* já fechado */ }
  fim('✗ O protocolo não completou. A saída acima diz em qual degrau parou.');
}
