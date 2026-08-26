/**
 * Sonda o painel de transferências do SERPRO — diagnóstico, não integração.
 *
 * Por que existe: o ambiente onde este projeto é escrito não alcança gov.br, e
 * três tentativas de integrar às cegas produziram código que parecia funcionar
 * e não funcionava. Esta sonda fecha esse buraco pelo único caminho disponível:
 * ela roda no Cloud Shell, que alcança, e imprime o que cada passo respondeu.
 *
 * Ela não grava nada, não altera nada e não faz parte do sistema. Rode com:
 *
 *   cd ~/applegis && git pull origin main
 *   node teste/sonda-painel.mjs
 *
 * E me mande a saída inteira, inclusive os erros — sobretudo os erros.
 *
 * O que ela tenta, na ordem, e por quê:
 *
 *   1. Abrir a página do painel. Confirma alcance e captura o cookie de sessão
 *      que o Qlik emite mesmo em acesso público (é o que o `qlikTicket` da URL
 *      denuncia).
 *   2. Abrir o WebSocket do motor Qlik com esse cookie. É por aqui que os
 *      números viajam — não existe endereço HTTP que devolva as linhas.
 *   3. Falar o protocolo: abrir o aplicativo, pegar o objeto da tabela de
 *      emendas, ler o layout e pedir três linhas.
 *
 * Se o passo 3 imprimir os títulos das colunas, a integração automática é
 * possível e eu sei exatamente o que escrever. Se travar antes, a mensagem diz
 * em qual passo — e aí a resposta honesta é continuar importando o arquivo à
 * mão, que funciona hoje.
 */

const HOST = 'dd-publico.serpro.gov.br';
const PAGINA = `https://${HOST}/extensions/painel/DiscricionariasEmendas.html`;

// Lidos do config.js que o próprio painel publica — não são palpite.
const APP = '37c409c6-51a4-405a-9098-2d426367c982';
const OBJETO = 'LhzUJw'; // "Lista de emendas com instrumentos celebrados"

const registro = [];
const anotar = (passo, texto) => {
  const linha = `[${passo}] ${texto}`;
  registro.push(linha);
  console.log(linha);
};

function encerrar(codigo) {
  console.log('\n───────────────────────────────────────────────');
  console.log('Copie tudo acima e mande de volta.');
  process.exit(codigo);
}

// ─────────────────────────── 1. a página e o cookie ───────────────────────────

let cookie = '';
try {
  const r = await fetch(PAGINA, { redirect: 'follow' });
  anotar(1, `página respondeu ${r.status} ${r.statusText}`);
  anotar(1, `URL final: ${r.url}`);

  // Node junta os Set-Cookie em getSetCookie(); é deles que sai a sessão.
  const cookies = r.headers.getSetCookie?.() || [];
  anotar(1, `cookies recebidos: ${cookies.length || 'nenhum'}`);
  cookie = cookies.map((c) => c.split(';')[0]).join('; ');
  if (cookie) anotar(1, `cookie montado: ${cookie.slice(0, 120)}${cookie.length > 120 ? '…' : ''}`);

  const corpo = await r.text();
  anotar(1, `corpo: ${corpo.length} caracteres`);
  const ticket = /qlikTicket=([^"'&\s]+)/.exec(r.url + corpo);
  if (ticket) anotar(1, `ticket visto na resposta: ${ticket[1].slice(0, 20)}…`);
} catch (erro) {
  anotar(1, `FALHOU: ${erro.message}`);
  anotar(1, 'Sem alcançar a página, o resto não faz sentido. Pare por aqui.');
  encerrar(1);
}

// ── 1b. o mesmo com a URL que você usou, que já traz ticket ──
//
// Se a de cima não deu cookie, talvez o ticket na URL seja o caminho: ele é o
// modo do Qlik entregar sessão a quem chega de fora.
if (!cookie) {
  anotar('1b', 'sem cookie na primeira tentativa; tentando o caminho de autenticação do Qlik');
  for (const alvo of [
    `https://${HOST}/hub`,
    `https://${HOST}/single/?appid=${APP}&obj=${OBJETO}`,
  ]) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const r = await fetch(alvo, { redirect: 'follow' });
      const cs = r.headers.getSetCookie?.() || [];
      anotar('1b', `${alvo} → ${r.status}, ${cs.length} cookie(s)`);
      if (cs.length) { cookie = cs.map((c) => c.split(';')[0]).join('; '); break; }
    } catch (erro) {
      anotar('1b', `${alvo} → ${erro.message}`);
    }
  }
}

// ─────────────────────────── 2. o WebSocket ───────────────────────────

if (typeof WebSocket === 'undefined') {
  anotar(2, 'Este Node não tem WebSocket global. Rode com Node 22 ou mais novo:');
  anotar(2, '  node --version   (precisa ser v22+)');
  encerrar(1);
}

const url = `wss://${HOST}/app/${APP}`;
anotar(2, `abrindo ${url}`);
anotar(2, cookie ? 'com cookie de sessão' : 'SEM cookie — pode ser recusado');

const socket = new WebSocket(url, cookie ? { headers: { Cookie: cookie } } : undefined);

const pendentes = new Map();
let proximoId = 0;
function chamar(handle, metodo, params = []) {
  proximoId += 1;
  const id = proximoId;
  return new Promise((ok, falha) => {
    const relogio = setTimeout(() => {
      pendentes.delete(id);
      falha(new Error(`sem resposta a ${metodo} em 20s`));
    }, 20000);
    pendentes.set(id, {
      ok: (m) => { clearTimeout(relogio); ok(m); },
      falha: (e) => { clearTimeout(relogio); falha(e); },
    });
    socket.send(JSON.stringify({ jsonrpc: '2.0', id, handle, method: metodo, params }));
  });
}

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

socket.addEventListener('error', () => {
  anotar(2, 'FALHOU: o WebSocket não abriu.');
  anotar(2, 'Se isto acontecer com cookie, o painel exige sessão de navegador de verdade');
  anotar(2, 'e o caminho automático fica inviável sem um navegador no servidor.');
  encerrar(1);
});

socket.addEventListener('close', (e) => {
  if (proximoId === 0) {
    anotar(2, `fechou antes de qualquer chamada (código ${e.code}). Sessão recusada.`);
    encerrar(1);
  }
});

await new Promise((ok, falha) => {
  socket.addEventListener('open', ok, { once: true });
  setTimeout(() => falha(new Error('não abriu em 20s')), 20000);
}).catch((erro) => {
  anotar(2, `FALHOU: ${erro.message}`);
  encerrar(1);
});

anotar(2, 'WebSocket aberto.');

// ─────────────────────────── 3. o protocolo ───────────────────────────

try {
  const doc = (await chamar(-1, 'OpenDoc', [APP])).result?.qReturn?.qHandle;
  anotar(3, `OpenDoc → handle ${doc}`);
  if (!Number.isInteger(doc)) throw new Error('o aplicativo não abriu');

  const alvo = (await chamar(doc, 'GetObject', [OBJETO])).result?.qReturn?.qHandle;
  anotar(3, `GetObject(${OBJETO}) → handle ${alvo}`);
  if (!Number.isInteger(alvo)) throw new Error('o objeto da tabela não existe');

  const layout = (await chamar(alvo, 'GetLayout', [])).result?.qLayout;
  const cubo = layout?.qHyperCube || {};
  const titulos = [
    ...(cubo.qDimensionInfo || []).map((c) => c.qFallbackTitle),
    ...(cubo.qMeasureInfo || []).map((c) => c.qFallbackTitle),
  ];
  anotar(3, `colunas (${titulos.length}): ${titulos.join(' | ')}`);
  anotar(3, `tamanho declarado: ${cubo.qSize?.qcy} linhas × ${cubo.qSize?.qcx} colunas`);

  // Sem selecionar parlamentar, a tabela costuma vir vazia de propósito — a
  // própria descrição do objeto avisa. Vale saber se vem vazia ou não.
  const pagina = await chamar(alvo, 'GetHyperCubeData', ['/qHyperCubeDef', [{
    qTop: 0, qLeft: 0, qHeight: 3, qWidth: Math.max(1, cubo.qSize?.qcx || 14),
  }]]);
  const matriz = pagina.result?.qDataPages?.[0]?.qMatrix || [];
  anotar(3, `GetHyperCubeData → ${matriz.length} linha(s) sem filtro`);
  matriz.forEach((l, i) => anotar(3, `  linha ${i + 1}: ${l.map((c) => c.qText).join(' | ').slice(0, 200)}`));

  // O filtro por parlamentar: é o que a tabela exige para mostrar dados.
  for (const campo of ['Nome Parlamentar Emenda', 'Parlamentar Autor Emenda', 'Autor Emenda']) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const h = (await chamar(doc, 'GetField', [campo])).result?.qReturn?.qHandle;
      if (!Number.isInteger(h)) { anotar(3, `campo "${campo}": não existe`); continue; }
      // eslint-disable-next-line no-await-in-loop
      const r = await chamar(h, 'Select', ['MARCEL VAN HATTEM', false, 0]);
      anotar(3, `campo "${campo}": Select → ${r.result?.qReturn}`);
      if (r.result?.qReturn === true) {
        // eslint-disable-next-line no-await-in-loop
        const p2 = await chamar(alvo, 'GetHyperCubeData', ['/qHyperCubeDef', [{
          qTop: 0, qLeft: 0, qHeight: 3, qWidth: Math.max(1, cubo.qSize?.qcx || 14),
        }]]);
        const m2 = p2.result?.qDataPages?.[0]?.qMatrix || [];
        anotar(3, `com o parlamentar selecionado → ${m2.length} linha(s)`);
        m2.forEach((l, i) => anotar(3, `  linha ${i + 1}: ${l.map((c) => c.qText).join(' | ').slice(0, 200)}`));
        break;
      }
    } catch (erro) {
      anotar(3, `campo "${campo}": ${erro.message}`);
    }
  }

  console.log('\n✓ O caminho automático FUNCIONA. Mande esta saída que eu construo.');
} catch (erro) {
  anotar(3, `FALHOU: ${erro.message}`);
  console.log('\n✗ O protocolo não completou. A saída acima diz em qual passo.');
}

try { socket.close(); } catch { /* já fechado */ }
encerrar(0);
