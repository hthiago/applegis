/**
 * Testes de ponta a ponta.
 *
 * Sobe um servidor estático, abre o sistema num Chromium de verdade e troca o
 * SDK do Firebase por um duplo em memória (teste/stub-firebase.js). Assim dá
 * para exercitar login, navegação, cadastro e — o que mais importa — a matriz
 * de permissões, sem tocar em nenhum projeto real.
 *
 *   npm install -D playwright && npx playwright install chromium
 *   node teste/rodar.mjs
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORTA = 8123;
const BASE = `http://localhost:${PORTA}`;
const stub = fs.readFileSync(path.join(RAIZ, 'teste', 'stub-firebase.js'), 'utf8');

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('Playwright não encontrado. Rode: npm install -D playwright && npx playwright install chromium');
  process.exit(1);
}

// ─────────────────────────── servidor estático ───────────────────────────

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};

const servidor = http.createServer((req, res) => {
  let alvo = path.join(RAIZ, decodeURIComponent(req.url.split('?')[0]));
  if (alvo.endsWith(path.sep)) alvo = path.join(alvo, 'index.html');
  if (!alvo.startsWith(RAIZ)) { res.writeHead(403).end(); return; }
  fs.readFile(alvo, (erro, dados) => {
    if (erro) { res.writeHead(404).end('404'); return; }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(alvo)] || 'text/plain' });
    res.end(dados);
  });
});

await new Promise((ok) => servidor.listen(PORTA, ok));

// ──────────────────────────────── apoio ────────────────────────────────

const passos = [];
const conferir = (nome, ok, detalhe = '') => {
  passos.push({ nome, ok, detalhe });
  console.log(`${ok ? '  ok ' : 'FALHA'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
};

const navegador = await chromium.launch();

async function abrir({ papel = 'chefe', areas = [] } = {}) {
  const pagina = await navegador.newPage();
  pagina.on('pageerror', (e) => conferir(`erro de página inesperado (${papel})`, false, e.message));
  pagina.on('console', (m) => {
    if (m.type() === 'error') conferir(`erro de console inesperado (${papel})`, false, m.text());
  });

  await pagina.addInitScript(([p, a]) => {
    globalThis.__PAPEL_TESTE = p;
    globalThis.__AREAS_TESTE = a;
  }, [papel, areas]);

  await pagina.route(/gstatic\.com/, (rota) => rota.fulfill({
    status: 200,
    contentType: 'text/javascript',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: stub,
  }));

  // Só a chave: trocar todas as ocorrências atingiria a sentinela que decide
  // se o sistema está configurado.
  await pagina.route(/js\/config\.js/, async (rota) => {
    const r = await rota.fetch();
    rota.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: (await r.text()).replace("apiKey: 'COLE_AQUI'", "apiKey: 'chave-de-teste'"),
    });
  });

  return pagina;
}

// ─────────────────────────── suíte 1: uso normal ───────────────────────────

console.log('\nUso normal, como chefe de gabinete\n');
{
  const pagina = await abrir();
  await pagina.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.topo', { timeout: 10000 });

  conferir('login reconhece o membro autorizado',
    (await pagina.locator('.usuario-nome').innerText()) === 'Chefe Teste');
  conferir('gabinete correto no topo',
    (await pagina.locator('.topo-marca strong').innerText()) === 'Gabinete de Teste');

  await pagina.waitForSelector('.indicadores');
  const atrasadas = await pagina.locator('.indicador').filter({ hasText: 'Tarefas atrasadas' })
    .locator('.indicador-valor').innerText();
  conferir('painel identifica a tarefa atrasada', atrasadas === '1', `leu ${atrasadas}`);

  for (const [area, esperado] of [
    ['administrativo', 'Cota parlamentar'],
    ['legislativo', 'Proposições acompanhadas'],
    ['comunicacao', 'Calendário editorial'],
    ['orcamento', 'Painel de emendas'],
  ]) {
    await pagina.goto(`${BASE}/#/${area}`, { waitUntil: 'domcontentloaded' });
    await pagina.waitForSelector('.modulo-topo h1', { timeout: 10000 });
    const h1 = await pagina.locator('.modulo-topo h1').first().innerText();
    conferir(`área ${area} abre`, h1 === esperado, `abriu "${h1}"`);
  }

  await pagina.goto(`${BASE}/#/orcamento/painel-emendas`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.indicadores');
  const indicado = await pagina.locator('.indicador').filter({ hasText: 'Indicado' }).first()
    .locator('.indicador-valor').innerText();
  conferir('painel de emendas soma o valor indicado', indicado.includes('500'), `leu ${indicado}`);

  await pagina.goto(`${BASE}/#/administrativo/equipe`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.tabela');
  conferir('lista traz o registro existente', (await pagina.locator('.tabela tbody tr').count()) === 1);

  await pagina.getByRole('button', { name: /Nova integrante/ }).click();
  await pagina.waitForSelector('.modal');
  await pagina.fill('#campo-nome', 'Bruno Novo');
  await pagina.fill('#campo-cargo', 'Assessor técnico');
  await pagina.selectOption('#campo-lotacao', 'estado');
  await pagina.getByRole('button', { name: 'Salvar' }).click();
  await pagina.waitForSelector('.modal', { state: 'detached', timeout: 10000 });
  await pagina.waitForTimeout(400);
  conferir('cadastro grava e a lista recarrega',
    (await pagina.locator('.tabela tbody tr').count()) === 2);
  conferir('registro novo aparece na lista',
    (await pagina.locator('.tabela tbody').innerText()).includes('Bruno Novo'));

  await pagina.fill('.busca', 'Bruno');
  await pagina.waitForTimeout(250);
  conferir('busca filtra', (await pagina.locator('.tabela tbody tr').count()) === 1);

  await pagina.goto(`${BASE}/#/chefia/tarefas`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.tabela');
  conferir('campo de referência mostra o nome, não o identificador',
    (await pagina.locator('.tabela tbody').innerText()).includes('Ana Assessora'));

  await pagina.setViewportSize({ width: 390, height: 780 });
  await pagina.goto(`${BASE}/#/administrativo/equipe`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.tabela');
  await pagina.waitForTimeout(300);
  conferir('sem rolagem horizontal no celular',
    !(await pagina.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)));

  await pagina.close();
}

// ─────────────────────── suíte 2: matriz de permissão ───────────────────────

console.log('\nMatriz de permissão\n');

const TELAS = [
  'administrativo/equipe',
  'legislativo/producao',
  'comunicacao/editorial',
  'orcamento/emendas',
  'chefia/agenda',
  'chefia/tarefas',
];

async function editaveis(papel, areas) {
  const pagina = await abrir({ papel, areas });
  const mapa = {};
  for (const tela of TELAS) {
    await pagina.goto(`${BASE}/#/${tela}`, { waitUntil: 'domcontentloaded' });
    await pagina.waitForSelector('.modulo-topo', { timeout: 10000 });
    await pagina.waitForTimeout(150);
    mapa[tela] = (await pagina.locator('.somente-leitura').count()) === 0;
  }
  await pagina.close();
  return mapa;
}

const chefe = await editaveis('chefe', []);
conferir('chefe edita todas as áreas', TELAS.every((t) => chefe[t]));

const assessor = await editaveis('assessor', ['comunicacao']);
conferir('assessor de comunicação edita a própria área', assessor['comunicacao/editorial']);
conferir('assessor de comunicação não edita administrativo', !assessor['administrativo/equipe']);
conferir('assessor de comunicação não edita legislativo', !assessor['legislativo/producao']);
conferir('assessor de comunicação não edita a agenda do deputado', !assessor['chefia/agenda']);
conferir('assessor edita tarefas — delegação atravessa áreas', assessor['chefia/tarefas']);

const escritorio = await editaveis('escritorio', []);
conferir('escritório no estado edita emendas', escritorio['orcamento/emendas']);
conferir('escritório no estado edita administrativo', escritorio['administrativo/equipe']);
conferir('escritório no estado não edita comunicação', !escritorio['comunicacao/editorial']);
conferir('escritório no estado não edita a agenda', !escritorio['chefia/agenda']);

const leitor = await editaveis('leitor', []);
conferir('somente leitura não edita nada', TELAS.every((t) => !leitor[t]));

// ──────────────────────────────── desfecho ────────────────────────────────

await navegador.close();
servidor.close();

const falhas = passos.filter((p) => !p.ok);
console.log(`\n${passos.length - falhas.length}/${passos.length} verificações passaram.`);
if (falhas.length) {
  console.log('Falharam:');
  falhas.forEach((f) => console.log(`  · ${f.nome}`));
}
process.exit(falhas.length ? 1 : 0);
