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

// ─────────────────── 4. o aperto de mão do WebSocket, na mão ───────────────────
//
// O `WebSocket` nativo do Node segue o padrão do navegador, e nesse padrão o
// segundo argumento são os subprotocolos — não opções. Ele não aceita
// cabeçalhos, então o cookie nunca chegou a ser enviado nas rodadas anteriores:
// o 1006 e o TypeError diziam isso, e eu li como recusa do servidor.
//
// Aqui o aperto de mão é escrito à mão sobre TLS. Não é elegante e não precisa
// ser: ele transforma um código opaco de fechamento numa resposta HTTP com
// status e cabeçalhos, que é o que permite distinguir "origem recusada" de
// "sessão inválida" de "endereço errado".

const tls = await import('node:tls');
const crypto = await import('node:crypto');

function apertoDeMao(caminho, extras = {}) {
  return new Promise((ok) => {
    const chave = crypto.randomBytes(16).toString('base64');
    const cabecalhos = {
      Host: HOST,
      Upgrade: 'websocket',
      Connection: 'Upgrade',
      'Sec-WebSocket-Key': chave,
      'Sec-WebSocket-Version': '13',
      'User-Agent': CABECALHOS['User-Agent'],
      ...extras,
    };
    const pedido = `GET ${caminho} HTTP/1.1\r\n`
      + Object.entries(cabecalhos).map(([k, v]) => `${k}: ${v}`).join('\r\n')
      + '\r\n\r\n';

    // ALPN explícito: sem negociar, o servidor pode responder em HTTP/2, onde
    // um upgrade escrito em HTTP/1.1 é inválido e vira 403 sem explicação. O
    // navegador negocia; escrevendo o aperto de mão à mão é preciso pedir.
    const s = tls.connect({
      host: HOST, port: 443, servername: HOST, timeout: 15000, ALPNProtocols: ['http/1.1'],
    }, () => s.write(pedido));
    let buffer = Buffer.alloc(0);
    const terminar = (r) => { try { s.destroy(); } catch { /* já fechado */ } ok(r); };
    s.on('data', (d) => {
      buffer = Buffer.concat([buffer, d]);
      const fim = buffer.indexOf('\r\n\r\n');
      if (fim === -1) return;
      const cru = buffer.subarray(0, fim).toString('latin1').split('\r\n');
      terminar({ status: cru[0], cabecalhos: cru.slice(1), corpo: buffer.subarray(fim + 4).toString('latin1').slice(0, 300) });
    });
    s.on('error', (e) => terminar({ erro: porQue(e) }));
    s.on('timeout', () => terminar({ erro: 'sem resposta em 15s' }));
  });
}

const origem = `https://${HOST}`;
// O cookie chama-se X-Qlik-Session-Publico. No Qlik, esse sufixo é o nome do
// proxy virtual — e proxy virtual com nome costuma ter prefixo no caminho. Se
// for o caso, o motor não está em /app mas em /publico/app.
// O que "parecer navegador" me custou: com estes cabeçalhos, o /publico/app
// respondeu 400 reclamando do cabeçalho. Sem eles, é o mínimo que a norma pede.
const enfeites = {
  'Accept-Encoding': 'gzip, deflate, br',
  'Accept-Language': 'pt-BR,pt;q=0.9',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
  'Sec-WebSocket-Extensions': 'permessage-deflate; client_max_window_bits',
};

const variantes = [
  // O prefixo do proxy virtual, que foi o único a chegar num servidor de
  // verdade — agora com o cabeçalho mínimo, sem os enfeites que ele recusou.
  { nome: 'publico/app · mínimo', caminho: `/publico/app/${APP}`, extras: { Cookie: cookieAtual(), Origin: origem } },
  { nome: 'publico/app · mínimo, sem Origin', caminho: `/publico/app/${APP}`, extras: { Cookie: cookieAtual() } },
  { nome: 'publico/app · sem Sec-WebSocket-Extensions', caminho: `/publico/app/${APP}`, extras: { Cookie: cookieAtual(), Origin: origem, 'Accept-Encoding': 'gzip, deflate, br', 'Accept-Language': 'pt-BR,pt;q=0.9' } },
  { nome: 'publico/app · com todos os enfeites (o que deu 400)', caminho: `/publico/app/${APP}`, extras: { Cookie: cookieAtual(), Origin: origem, ...enfeites } },
  { nome: 'publico/app/identity · mínimo', caminho: `/publico/app/${APP}/identity/${Math.random().toString(36).slice(2, 10)}`, extras: { Cookie: cookieAtual(), Origin: origem } },
  { nome: 'publico/app/engineData · mínimo', caminho: '/publico/app/engineData', extras: { Cookie: cookieAtual(), Origin: origem } },
  { nome: 'app + cookie + Origin (controle)', caminho: `/app/${APP}`, extras: { Cookie: cookieAtual(), Origin: origem } },
  { nome: 'app + cookie, sem Origin', caminho: `/app/${APP}`, extras: { Cookie: cookieAtual() } },
  { nome: 'app + Origin, sem cookie', caminho: `/app/${APP}`, extras: { Origin: origem } },
  { nome: 'app/identity + cookie + Origin', caminho: `/app/${APP}/identity/${Math.random().toString(36).slice(2, 10)}`, extras: { Cookie: cookieAtual(), Origin: origem } },
  { nome: 'engineData + cookie + Origin', caminho: '/app/engineData', extras: { Cookie: cookieAtual(), Origin: origem } },
];

let bom = null;
for (const v of variantes) {
  // eslint-disable-next-line no-await-in-loop
  const r = await apertoDeMao(v.caminho, v.extras);
  if (r.erro) { anotar(4, `${v.nome} → ${r.erro}`); continue; }
  const aceitou = /\b101\b/.test(r.status);
  anotar(4, `${aceitou ? 'ACEITOU' : 'recusou'} · ${v.nome} → ${r.status}`);
  if (!aceitou) {
    // Sem filtro: a rodada anterior escondeu a explicação porque nenhum cabeçalho
    // passou pela peneira que eu tinha inventado. Um 403 mudo não existe — a
    // explicação está em algum cabeçalho, e adivinhar qual foi o erro.
    r.cabecalhos.forEach((c) => anotar(4, `    ${c.slice(0, 160)}`));
    const titulo = /<title>([\s\S]*?)<\/title>|<h[12][^>]*>([\s\S]*?)<\/h[12]>/i.exec(r.corpo);
    if (titulo) anotar(4, `    título do erro: ${(titulo[1] || titulo[2]).replace(/\s+/g, ' ').trim().slice(0, 120)}`);
    else anotar(4, `    corpo: ${r.corpo.trim() ? r.corpo.replace(/\s+/g, ' ').trim().slice(0, 200) : '(vazio)'}`);
  }
  if (aceitou && !bom) bom = v;
}

if (!bom) {
  anotar(4, 'A sessão anônima existe (o /qps/user respondeu), mas o motor recusa o socket.');
  fim('✗ Nenhuma variante fez o aperto de mão. A coleta terá de acontecer na própria aba do painel.');
}
anotar(4, `→ funciona em ${bom.caminho}`);

// Para falar o protocolo é preciso montar e ler quadros, e aí uma biblioteca
// paga a pena. Só se chega aqui quando o aperto de mão já deu certo, então
// instalar deixou de ser aposta.
let WS = null;
try {
  ({ default: WS } = await import('ws'));
} catch {
  console.log('\n✓ O APERTO DE MÃO FUNCIONA — o caminho automático é viável.');
  console.log('  Para ler as linhas, falta a biblioteca de quadros. Rode:');
  console.log('    npm install ws --no-save && node teste/sonda-painel.mjs');
  fim('  (mande esta saída de qualquer forma — o aperto de mão já é a resposta que eu precisava)');
}

anotar(4, `abrindo com a biblioteca: wss://${HOST}${bom.caminho}`);
const socket = new WS(`wss://${HOST}${bom.caminho}`, { headers: bom.extras });
const abriu = await new Promise((ok) => {
  socket.on('open', () => ok(true));
  socket.on('error', (e) => { anotar(4, `erro: ${porQue(e)}`); ok(false); });
  setTimeout(() => ok(false), 15000);
});
if (!abriu) fim('✗ O aperto de mão passa, mas a biblioteca não abriu. Mande esta saída.');
anotar(4, 'WebSocket aberto com a biblioteca.');

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

socket.on('message', (dado) => {
  let msg;
  try { msg = JSON.parse(dado.toString()); } catch { return; }
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
