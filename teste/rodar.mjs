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

async function abrir({ papel = 'chefe', areas = [], bancoVazio = false } = {}) {
  const pagina = await navegador.newPage();
  pagina.on('pageerror', (e) => conferir(`erro de página inesperado (${papel})`, false, e.message));
  pagina.on('console', (m) => {
    if (m.type() === 'error') conferir(`erro de console inesperado (${papel})`, false, m.text());
  });

  await pagina.addInitScript(([p, a, v]) => {
    globalThis.__PAPEL_TESTE = p;
    globalThis.__AREAS_TESTE = a;
    globalThis.__BANCO_VAZIO_TESTE = v;
  }, [papel, areas, bancoVazio]);

  await pagina.route(/gstatic\.com/, (rota) => rota.fulfill({
    status: 200,
    contentType: 'text/javascript',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: stub,
  }));

  // Duplo da base da Câmara. A lista de autores traz o proponente real no meio
  // dos subscritores, que é exatamente o caso que confundia a importação.
  await pagina.route(/dadosabertos\.camara\.leg\.br/, (rota) => {
    const url = rota.request().url();
    const idProposicao = (/\/proposicoes\/(\d+)/.exec(url) || [])[1];
    let dados;

    if (/idDeputadoAutor/.test(url)) {
      // Só a primeira página tem resultado; a segunda encerra a paginação.
      dados = /pagina=1/.test(url) ? [
        { id: 111, siglaTipo: 'PL', numero: 111, ano: 2025, dataApresentacao: '2025-03-10T10:00' },
        { id: 222, siglaTipo: 'PL', numero: 222, ano: 2025, dataApresentacao: '2025-04-20T10:00' },
      ] : [];
    } else if (/\/deputados\/\d+\/orgaos/.test(url)) {
      dados = [
        { siglaOrgao: 'CCJC', nomeOrgao: 'Constituição e Justiça', dataFim: null },
        { siglaOrgao: 'CSPCCO', nomeOrgao: 'Segurança Pública', dataFim: null },
        { siglaOrgao: 'CAPADR', nomeOrgao: 'Agricultura', dataFim: '2020-01-01' },
      ];
    } else if (/\/eventos\/\d+\/pauta/.test(url)) {
      dados = [
        { ordem: 1, proposicao_: { siglaTipo: 'PL', numero: 77, ano: 2026, ementa: 'Dispõe sobre X.' },
          relator: { nome: 'Dep. Relatora' } },
        { ordem: 2, proposicao_: { siglaTipo: 'REQ', numero: 12, ano: 2026, ementa: 'Requer audiência.' } },
      ];
    } else if (/\/eventos\?/.test(url)) {
      dados = [
        { id: 900, dataHoraInicio: '2026-08-12T14:00', orgaos: [{ sigla: 'CSPCCO' }] },
        { id: 901, dataHoraInicio: '2026-08-13T10:00', orgaos: [{ sigla: 'CVT' }] },
      ];
    } else if (/\/temas/.test(url)) {
      dados = [{ tema: idProposicao === '111' ? 'Saúde' : 'Segurança pública' }];
    } else if (/\/autores/.test(url)) {
      // O parlamentar do gabinete é o 999: assina em primeiro lugar na 111,
      // em terceiro na 222 — autor num caso, subscritor no outro.
      if (idProposicao === '111' || idProposicao === '222') {
        dados = [
          { nome: 'Outro Deputado', uri: 'https://x/api/v2/deputados/1', proponente: 1, ordemAssinatura: idProposicao === '111' ? 2 : 1 },
          { nome: 'Marcel van Hattem', uri: 'https://x/api/v2/deputados/999', proponente: 1, ordemAssinatura: idProposicao === '111' ? 1 : 3 },
        ];
      } else {
      // Caso real: a base marca proponente para todos os signatários, então
      // esse campo sozinho não separa quem apresentou de quem subscreveu.
        dados = [
          { nome: 'Deputado Subscritor Um', proponente: 1, ordemAssinatura: 2 },
          { nome: 'Sóstenes Cavalcante', proponente: 1, ordemAssinatura: 1 },
          { nome: 'Deputado Subscritor Dois', proponente: 1, ordemAssinatura: 3 },
        ];
      }
    } else if (/\/tramitacoes/.test(url)) {
      // O mesmo órgão aparece a cada despacho; a trilha deve juntar repetições.
      dados = [
        { dataHora: '2024-05-14T10:00', siglaOrgao: 'PLEN' },
        { dataHora: '2024-05-20T10:00', siglaOrgao: 'MESA' },
        { dataHora: '2024-06-02T10:00', siglaOrgao: 'CCJC' },
        { dataHora: '2024-06-20T10:00', siglaOrgao: 'CCJC' },
        { dataHora: '2024-07-01T10:00', siglaOrgao: 'MESA' },
        { dataHora: '2025-01-15T10:00', siglaOrgao: 'CPASF' },
      ];
    } else if (/\/proposicoes\/\d+(\?|$)/.test(url)) {
      dados = {
        id: Number(idProposicao),
        siglaTipo: 'PL',
        numero: Number(idProposicao) === 2430726 ? 1904 : Number(idProposicao),
        ano: 2024,
        ementa: 'Acresce dois parágrafos ao art. 124.',
        statusProposicao: {
          descricaoSituacao: 'Pronta para Pauta',
          siglaOrgao: 'CPASF',
          dataHora: '2025-01-15T10:00',
          despacho: 'Às Comissões de Constituição e Justiça.',
        },
      };
    } else {
      dados = [{ id: 2430726, siglaTipo: 'PL', numero: 1904, ano: 2024, ementa: 'Acresce dois parágrafos.' }];
    }
    rota.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ dados }),
    });
  });

  // Garante que o sistema se considere configurado mesmo num clone sem chaves.
  // Troca só a chave: mexer em todas as ocorrências atingiria a sentinela que
  // decide se o sistema está configurado.
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

// ────────────────────── suíte 0: instalação do zero ──────────────────────

console.log('\nPrimeiro acesso, com o banco vazio\n');
{
  const pagina = await abrir({ bancoVazio: true });
  await pagina.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.cartao-central', { timeout: 10000 });

  const titulo = await pagina.locator('.cartao-central h1').innerText();
  conferir('banco vazio oferece a criação do gabinete', titulo === 'Vamos criar o gabinete', `mostrou "${titulo}"`);

  await pagina.fill('.cartao-central input[type="text"]', 'Gabinete Recém-Criado');
  await pagina.getByRole('button', { name: /Criar gabinete e entrar/ }).click();
  await pagina.waitForSelector('.topo', { timeout: 10000 });

  conferir('instalação leva direto para dentro do sistema',
    (await pagina.locator('.topo-marca strong').innerText()) === 'Gabinete Recém-Criado');
  conferir('quem instala vira chefe de gabinete',
    (await pagina.locator('.usuario-papel').innerText()) === 'Chefe de gabinete');
  conferir('chefe recém-criado enxerga a tela de acessos',
    await pagina.locator('.nav-item', { hasText: 'Acessos' }).isVisible());

  await pagina.close();
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

  // Edição direto na lista, sem abrir o formulário.
  const situacao = pagina.locator('.tabela tbody tr').first().locator('select.inline-select').nth(1);
  await situacao.selectOption('concluida');
  await pagina.waitForTimeout(400);
  await pagina.goto(`${BASE}/#/legislativo/proposicoes`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.tabela');
  await pagina.goto(`${BASE}/#/chefia/tarefas`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.tabela');
  conferir('situação alterada na lista persiste',
    (await pagina.locator('.tabela tbody tr').first().locator('select.inline-select').nth(1)
      .inputValue()) === 'concluida');

  // Ao abrir a lista, a consulta à Câmara roda sozinha e corrige situação e autoria.
  await pagina.goto(`${BASE}/#/legislativo/proposicoes`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.tabela');
  await pagina.waitForFunction(
    () => document.querySelector('.tabela tbody')?.innerText.includes('Pronta para Pauta'),
    null,
    { timeout: 10000 },
  ).catch(() => {});

  const textoProposicoes = await pagina.locator('.tabela tbody').innerText();
  conferir('consulta automática atualiza a situação sem clique',
    textoProposicoes.includes('Pronta para Pauta'));
  conferir('mostra só o autor principal, não os subscritores',
    textoProposicoes.includes('Sóstenes Cavalcante') && !textoProposicoes.includes('Subscritor'));
  const passos = pagina.locator('.tabela tbody .trilha-passo');
  const textoTrilha = await pagina.locator('.tabela tbody .trilha').innerText();
  conferir('trilha junta despachos repetidos e omite a Mesa',
    (await passos.count()) === 3, `${await passos.count()} passos: ${textoTrilha.replace(/\s+/g, ' ')}`);
  conferir('a Mesa não aparece na coluna', !textoTrilha.includes('MESA'));
  conferir('trilha mostra o caminho percorrido, do primeiro ao último órgão',
    (await passos.first().innerText()).includes('PLEN')
    && (await passos.last().innerText()).includes('CPASF'));
  conferir('trilha destaca o órgão atual',
    (await pagina.locator('.tabela tbody .trilha-passo--atual').innerText()).includes('CPASF'));
  conferir('trilha traz a data de chegada em cada órgão',
    (await passos.first().innerText()).includes('14/05/24'));
  conferir('situação vem acompanhada de desde quando',
    (await pagina.locator('.tabela tbody .celula-sub').first().innerText()).includes('desde 15/01/2025'));

  await pagina.locator('.inline-abrir').first().click();
  await pagina.locator('.inline-entrada').first().fill('Cobrar relator na quarta.');
  await pagina.locator('.inline-entrada').first().blur();
  await pagina.waitForTimeout(400);
  await pagina.goto(`${BASE}/#/chefia/tarefas`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.tabela');
  await pagina.goto(`${BASE}/#/legislativo/proposicoes`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.tabela');
  conferir('nota escrita na lista persiste',
    (await pagina.locator('.tabela tbody').innerText()).includes('Cobrar relator na quarta.'));

  // Produção do gabinete: importa da Câmara e separa autoria de subscrição.
  await pagina.goto(`${BASE}/#/legislativo/autorias`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.segmentos');
  await pagina.getByRole('button', { name: /Importar da Câmara/ }).click();
  await pagina.waitForFunction(
    () => document.querySelectorAll('.segmento-conta')[0]?.textContent === '1',
    null,
    { timeout: 15000 },
  ).catch(() => {});

  const contas = await pagina.locator('.segmento-conta').allInnerTexts();
  conferir('separa autoria de subscrição pela ordem de assinatura',
    contas[0] === '1' && contas[1] === '1', `autoria ${contas[0]}, subscrição ${contas[1]}`);
  conferir('subaba de autoria mostra só a proposição apresentada',
    (await pagina.locator('.tabela tbody').innerText()).includes('PL 111/2024'));
  conferir('agrupa por tema',
    (await pagina.locator('.grupo-nome').first().innerText()) === 'SAÚDE',
    await pagina.locator('.grupo-nome').first().innerText());

  await pagina.getByRole('tab', { name: /Subscrição/ }).click();
  await pagina.waitForTimeout(250);
  const naSubscricao = await pagina.locator('.tabela tbody').innerText();
  conferir('subaba de subscrição troca o conteúdo',
    naSubscricao.includes('PL 222/2024') && !naSubscricao.includes('PL 111/2024'));
  conferir('cada subaba agrupa pelo próprio tema',
    (await pagina.locator('.grupo-nome').first().innerText()).includes('SEGURANÇA'));

  // Produção do gabinete não aceita cadastro manual.
  await pagina.goto(`${BASE}/#/legislativo/autorias`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.modulo-topo');
  conferir('produção do gabinete não oferece cadastro manual',
    (await pagina.getByRole('button', { name: /Nova proposição/ }).count()) === 0);

  // Pauta importada da Câmara, só dos órgãos do parlamentar.
  await pagina.goto(`${BASE}/#/legislativo/pauta`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.modulo-topo');
  await pagina.getByRole('button', { name: /Importar pauta da semana/ }).click();
  await pagina.waitForFunction(
    () => document.querySelector('.tabela tbody')?.innerText.includes('PL 77/2026'),
    null, { timeout: 15000 },
  ).catch(() => {});
  const textoPauta = await pagina.locator('.tabela tbody').innerText();
  conferir('importa os itens de pauta dos órgãos do parlamentar', textoPauta.includes('PL 77/2026'));
  conferir('ignora reuniões de órgãos alheios ao parlamentar', !textoPauta.includes('CVT'));
  conferir('orientação entra em branco, para o gabinete decidir', textoPauta.includes('A definir'));

  // Minuta: regras de redação + valores do mandato + teor descrito pela equipe.
  await pagina.goto(`${BASE}/#/legislativo/producao`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.tabela');
  await pagina.locator('.tabela tbody tr').first().click();
  await pagina.waitForSelector('.modal');
  await pagina.getByRole('button', { name: /Gerar minuta/ }).click();
  await pagina.waitForSelector('.minuta-prompt');
  const instrucoes = await pagina.locator('.minuta-prompt').inputValue();
  conferir('minuta traz as regras de técnica legislativa',
    instrucoes.includes('Lei Complementar 95/1998'));
  conferir('minuta traz a diretriz do mandato sobre o tema',
    instrucoes.includes('legítima defesa'));
  conferir('minuta traz o teor descrito pela equipe',
    instrucoes.includes('produtor rural'));
  conferir('minuta proíbe inventar dados', instrucoes.includes('[VERIFICAR]'));
  await pagina.getByRole('button', { name: 'Fechar' }).click();
  await pagina.waitForTimeout(200);
  await pagina.keyboard.press('Escape');

  await pagina.goto(`${BASE}/#/chefia/painel`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.indicadores');
  const andaram = await pagina.locator('.indicador').filter({ hasText: 'Proposições que andaram' })
    .locator('.indicador-valor').innerText();
  conferir('painel da chefia conta as proposições que se moveram', andaram === '1', `leu ${andaram}`);
  conferir('painel diz de onde a proposição saiu',
    (await pagina.locator('.bloco').filter({ hasText: 'mudaram de situação' }).innerText())
      .includes('Aguardando Despacho'));

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
