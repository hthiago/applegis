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

// ─────────────────────────── 3. o GET da página ───────────────────────────

let cookie = '';
let alcancou = false;
for (const alvo of [`https://${HOST}/`, PAGINA]) {
  try {
    // eslint-disable-next-line no-await-in-loop
    const r = await fetch(alvo, { headers: CABECALHOS, redirect: 'follow' });
    alcancou = true;
    anotar(3, `${alvo} → ${r.status} ${r.statusText}`);
    if (r.url !== alvo) anotar(3, `  redirecionou para ${r.url}`);
    const cs = r.headers.getSetCookie?.() || [];
    if (cs.length) {
      anotar(3, `  ${cs.length} cookie(s): ${cs.map((c) => c.split('=')[0]).join(', ')}`);
      cookie = cs.map((c) => c.split(';')[0]).join('; ');
    }
    const t = await r.text();
    anotar(3, `  corpo: ${t.length} caracteres`);
    // Resposta curta em geral é recado de bloqueio, e o recado diz quem bloqueou
    // — WAF, gateway de saída, proxy da rede. Imprimir poupa uma rodada inteira.
    if (t.length <= 400) anotar(3, `  corpo: ${t.replace(/\s+/g, ' ').trim()}`);
    const tk = /qlikTicket=([^"'&\s]+)/.exec(`${r.url}${t}`);
    if (tk) anotar(3, `  ticket visto: ${tk[1].slice(0, 24)}…`);
  } catch (erro) {
    anotar(3, `${alvo} FALHOU: ${porQue(erro)}`);
  }
}
if (!alcancou) {
  fim('✗ O TLS conecta mas o HTTP não completa. Costuma ser bloqueio por origem ou por agente.');
}

// ─────────────────────────── 4. o WebSocket ───────────────────────────

if (typeof WebSocket === 'undefined') {
  anotar(4, `Node ${process.version} não tem WebSocket global — precisa de v22+.`);
  fim('✗ Atualize o Node no Cloud Shell e rode de novo: nvm install 22 && nvm use 22');
}

const url = `wss://${HOST}/app/${APP}`;
anotar(4, `abrindo ${url} ${cookie ? 'com cookie' : 'SEM cookie'}`);

let socket;
try {
  socket = new WebSocket(url, cookie ? { headers: { Cookie: cookie } } : undefined);
} catch (erro) {
  anotar(4, `não pôde criar: ${porQue(erro)}`);
  fim('✗ O WebSocket nem foi criado.');
}

let motivoDeFechar = null;
socket.addEventListener('close', (e) => { motivoDeFechar = `código ${e.code}${e.reason ? ` — ${e.reason}` : ''}`; });
socket.addEventListener('error', (e) => { motivoDeFechar = motivoDeFechar || porQue(e.error || e); });

const abriu = await new Promise((ok) => {
  socket.addEventListener('open', () => ok(true), { once: true });
  socket.addEventListener('error', () => ok(false), { once: true });
  socket.addEventListener('close', () => ok(false), { once: true });
  setTimeout(() => ok(false), 20000);
});

if (!abriu) {
  anotar(4, `NÃO ABRIU: ${motivoDeFechar || 'sem resposta em 20s'}`);
  fim(cookie
    ? '✗ Com cookie e mesmo assim recusado: o painel exige sessão de navegador de verdade.'
    : '✗ Recusado sem cookie. O passo 3 não trouxe sessão — é aí que está o nó.');
}
anotar(4, 'WebSocket aberto.');

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
