/**
 * Retratos das telas, para olhar o desenho.
 *
 * O mesmo servidor e o mesmo duplo do Firebase da suíte de testes, sem
 * verificação nenhuma: sobe o sistema, importa o Mapa de emendas de verdade e
 * fotografa as telas principais. Serve para discutir leiaute olhando a tela, e
 * não a lembrança dela.
 *
 *   node teste/retratos.mjs [pasta]
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAIDA = process.argv[2] || path.join(RAIZ, 'retratos');
const PORTA = 8125;
const BASE = `http://localhost:${PORTA}`;
const stub = fs.readFileSync(path.join(RAIZ, 'teste', 'stub-firebase.js'), 'utf8');
const { chromium } = await import('playwright');

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
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

fs.mkdirSync(SAIDA, { recursive: true });
const navegador = await chromium.launch();
const pagina = await navegador.newPage({ viewport: { width: 1440, height: 950 } });
await pagina.addInitScript(() => { globalThis.__PAPEL_TESTE = 'chefe'; globalThis.__AREAS_TESTE = []; });
await pagina.route(/gstatic\.com/, (r) => r.fulfill({
  status: 200, contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: stub,
}));
// Uma malha de mentira, para o mapa aparecer no retrato. Três polígonos
// bastam: o que se está olhando aqui é o desenho, não a geografia.
const malhaFalsa = {
  type: 'FeatureCollection',
  features: [
    { properties: { codarea: '4305108' }, geometry: { type: 'Polygon', coordinates: [[[-52, -28.8], [-50.8, -28.9], [-50.9, -29.9], [-52.1, -29.8], [-52, -28.8]]] } },
    { properties: { codarea: '4314902' }, geometry: { type: 'Polygon', coordinates: [[[-51.4, -29.9], [-50.6, -30], [-50.7, -30.6], [-51.5, -30.5], [-51.4, -29.9]]] } },
    { properties: { codarea: '4306957' }, geometry: { type: 'Polygon', coordinates: [[[-52.4, -27.4], [-51.6, -27.5], [-51.7, -28.2], [-52.5, -28.1], [-52.4, -27.4]]] } },
    { properties: { codarea: '4321204' }, geometry: { type: 'Polygon', coordinates: [[[-53.9, -29.5], [-53.1, -29.6], [-53.2, -30.3], [-54, -30.2], [-53.9, -29.5]]] } },
  ],
};
const nomesFalsos = [
  { id: 4305108, nome: 'Caxias do Sul' },
  { id: 4314902, nome: 'Porto Alegre' },
  { id: 4306957, nome: 'Erechim' },
  { id: 4321204, nome: 'Santa Maria' },
];
// A rota registrada por último é a que ganha: a genérica vem primeiro, e as
// específicas depois, senão ela engole as duas e o mapa aparece vazio.
await pagina.route(/servicodados\.ibge\.gov\.br|dadosabertos\.camara\.leg\.br/, (r) => r.fulfill({
  status: 200, contentType: 'application/json', body: '[]',
}));
await pagina.route(/servicodados\.ibge\.gov\.br\/api\/v3\/malhas/, (r) => r.fulfill({
  status: 200, contentType: 'application/json', body: JSON.stringify(malhaFalsa),
}));
await pagina.route(/servicodados\.ibge\.gov\.br\/api\/v1\/localidades\/estados\/\d+\/municipios/, (r) => r.fulfill({
  status: 200, contentType: 'application/json', body: JSON.stringify(nomesFalsos),
}));

await pagina.goto(`${BASE}/#/orcamento/por-municipio`, { waitUntil: 'domcontentloaded' });
await pagina.waitForSelector('.modulo-topo', { timeout: 20000 });
await pagina.setInputFiles('.importador:has(button:text-is("Importar Mapa de emendas")) input[type=file]',
  path.join(RAIZ, 'teste', 'amostras', 'conciliacao-gabinete.xlsx'));
await pagina.waitForSelector('.tabela--municipios', { timeout: 40000 });
await pagina.waitForTimeout(1500);
await pagina.evaluate(() => document.querySelectorAll('.aviso').forEach((n) => n.remove()));

const TELAS = [
  ['chefia', '#/chefia/painel'],
  ['orcamento-dashboard', '#/orcamento/dashboard'],
  ['orcamento-lista', '#/orcamento/por-municipio'],
  ['orcamento-folha', '#/orcamento/folha/Caxias%20do%20Sul'],
  ['legislativo-crud', '#/legislativo/proposicoes'],
  ['administrativo-ficha', '#/administrativo/ficha'],
];

for (const [nome, rota] of TELAS) {
  await pagina.goto(`${BASE}/${rota}`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForTimeout(2500);
  await pagina.evaluate(() => document.querySelectorAll('.aviso').forEach((n) => n.remove()));
  await pagina.screenshot({ path: path.join(SAIDA, `${nome}.png`) });
  console.log('·', nome);
}

await navegador.close();
servidor.close();
