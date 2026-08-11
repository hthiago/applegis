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

async function abrir({
  papel = 'chefe', areas = [], bancoVazio = false, loteRecusado = false, ignorarConsole = false,
} = {}) {
  const pagina = await navegador.newPage();
  pagina.on('pageerror', (e) => conferir(`erro de página inesperado (${papel})`, false, e.message));
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !ignorarConsole) {
      conferir(`erro de console inesperado (${papel})`, false, m.text());
    }
  });

  await pagina.addInitScript(([p, a, v, r]) => {
    globalThis.__PAPEL_TESTE = p;
    globalThis.__AREAS_TESTE = a;
    globalThis.__BANCO_VAZIO_TESTE = v;
    globalThis.__LOTE_RECUSADO_TESTE = r;
  }, [papel, areas, bancoVazio, loteRecusado]);

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
      // A mistura reproduz o caso real: requerimentos e emendas de comissão são
      // a maioria da produção assinada e precisam sair do caminho por padrão.
      dados = /pagina=1/.test(url) ? [
        { id: 111, siglaTipo: 'PL', numero: 111, ano: 2025, ementa: 'Dispõe sobre saúde.' },
        { id: 222, siglaTipo: 'PL', numero: 222, ano: 2024, ementa: 'Dispõe sobre segurança.' },
        { id: 333, siglaTipo: 'REQ', numero: 333, ano: 2025, ementa: 'Requer audiência pública.' },
        { id: 444, siglaTipo: 'EMC', numero: 444, ano: 2025, ementa: 'Emenda de comissão.' },
        { id: 555, siglaTipo: 'PEC', numero: 555, ano: 2024, ementa: 'Altera o art. 5º.' },
        { id: 666, siglaTipo: 'REQ', numero: 666, ano: 2024, ementa: 'Requer informações.' },
      ] : [];
    } else if (/\/votacoes\/[\w-]+\/votos/.test(url)) {
      const idVotacao = (/\/votacoes\/([\w-]+)\/votos/.exec(url) || [])[1];
      // A 4 é simbólica: não produz lista de nomes, nem aqui nem no site
      // oficial. É a maior parte do que a Câmara vota.
      const registrados = {
        'v1': 'Sim', 'v2': 'Sim', 'v3': 'Não',
      };
      dados = registrados[idVotacao]
        ? [
          { deputado_: { id: 1, nome: 'Outro Deputado' }, tipoVoto: 'Não' },
          { deputado_: { id: 999, nome: 'Marcel van Hattem' }, tipoVoto: registrados[idVotacao] },
        ]
        : [];
    } else if (/\/votacoes\/[\w-]+\/orientacoes/.test(url)) {
      dados = [{ siglaPartidoBloco: 'NOVO', orientacaoVoto: 'Sim' }];
    } else if (/\/votacoes\?/.test(url)) {
      // Mérito, retirada de pauta, urgência, uma fora dos colegiados dele e
      // uma simbólica — o retrato do que uma semana de Plenário produz.
      dados = (/pagina=1/.test(url) && /dataInicio=2025/.test(url)) ? [
        { id: 'v1', dataHoraRegistro: '2025-03-12T16:20', siglaOrgao: 'PLEN', aprovacao: 1,
          descricao: 'Votação em turno único do PL 111/2025',
          proposicaoObjeto: 'PL 111/2025',
          uriProposicaoObjeto: 'https://x/api/v2/proposicoes/111' },
        { id: 'v2', dataHoraRegistro: '2025-04-02T18:40', siglaOrgao: 'PLEN', aprovacao: 1,
          descricao: 'Requerimento de Retirada de Pauta do PL 222/2024',
          proposicaoObjeto: 'PL 222/2024',
          uriProposicaoObjeto: 'https://x/api/v2/proposicoes/222' },
        { id: 'v3', dataHoraRegistro: '2025-05-08T20:10', siglaOrgao: 'PLEN', aprovacao: 0,
          descricao: 'Requerimento de Urgência para o PL 222/2024',
          proposicaoObjeto: 'PL 222/2024',
          uriProposicaoObjeto: 'https://x/api/v2/proposicoes/222' },
        { id: 'v4', dataHoraRegistro: '2025-05-09T10:00', siglaOrgao: 'CVT', aprovacao: 1,
          descricao: 'Votação do PL 999/2025', proposicaoObjeto: 'PL 999/2025' },
        { id: 'v5', dataHoraRegistro: '2025-06-01T15:00', siglaOrgao: 'PLEN', aprovacao: 1,
          descricao: 'Votação simbólica do PL 888/2025', proposicaoObjeto: 'PL 888/2025' },
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
      // A 111 tem dois temas: o primeiro agrupa, os dois filtram.
      if (idProposicao === '111') dados = [{ tema: 'Saúde' }, { tema: 'Orçamento público' }];
      else dados = [{ tema: 'Segurança pública' }];
    } else if (/\/autores/.test(url)) {
      // O parlamentar do gabinete é o 999: apresenta a 111 e a 555, subscreve
      // o resto — a distinção sai da ordem de assinatura.
      const nossas = ['111', '555'];
      if (/^(111|222|333|444|555|666)$/.test(idProposicao || '')) {
        const primeiro = nossas.includes(idProposicao);
        dados = [
          { nome: 'Outro Deputado', uri: 'https://x/api/v2/deputados/1', proponente: 1, ordemAssinatura: primeiro ? 2 : 1 },
          { nome: 'Marcel van Hattem', uri: 'https://x/api/v2/deputados/999', proponente: 1, ordemAssinatura: primeiro ? 1 : 3 },
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
    contas[0] === '2' && contas[1] === '4', `autoria ${contas[0]}, subscrição ${contas[1]}`);
  // A identificação sai da própria lista, sem depender de detalhar item a item.
  conferir('subaba de autoria mostra só a proposição apresentada',
    (await pagina.locator('.tabela tbody').innerText()).includes('PL 111/2025'));
  conferir('agrupa por tema',
    (await pagina.locator('.grupo-nome').first().innerText()) === 'SAÚDE',
    await pagina.locator('.grupo-nome').first().innerText());

  await pagina.getByRole('tab', { name: /Subscrição/ }).click();
  await pagina.waitForTimeout(250);
  const naSubscricao = await pagina.locator('.tabela tbody').innerText();
  conferir('subaba de subscrição troca o conteúdo',
    naSubscricao.includes('PL 222/2024') && !naSubscricao.includes('PL 111/2025'));
  conferir('cada subaba agrupa pelo próprio tema',
    (await pagina.locator('.grupo-nome').first().innerText()).includes('SEGURANÇA'));

  // ── facetas: o recorte que torna 1879 registros utilizáveis ──
  // Na subscrição há 4 registros: 1 PL, 2 REQ e 1 EMC. O padrão mostra o PL.
  conferir('o padrão esconde requerimentos e emendas de comissão',
    !naSubscricao.includes('REQ 333') && !naSubscricao.includes('EMC 444'), naSubscricao.replace(/\s+/g, ' '));
  conferir('a contagem avisa que há registro fora do recorte',
    (await pagina.locator('.contagem').innerText()).includes('1 de 4'),
    await pagina.locator('.contagem').innerText());

  const chipReq = pagina.locator('.chip', { hasText: /^REQ/ });
  conferir('o tipo escondido continua visível, com a contagem',
    (await chipReq.innerText()).replace(/\s+/g, ' ').trim() === 'REQ 2',
    (await chipReq.innerText()).replace(/\s+/g, ' ').trim());

  await chipReq.click();
  await pagina.waitForTimeout(250);
  conferir('um clique traz de volta o que estava recortado',
    (await pagina.locator('.tabela tbody').innerText()).includes('REQ 333'));

  // O tema é multivalorado: a 111 é de Saúde e de Orçamento público, e precisa
  // ser encontrável pelos dois.
  await pagina.getByRole('tab', { name: /Autoria/ }).click();
  await pagina.waitForTimeout(250);
  await pagina.locator('.faceta-select').selectOption('Orçamento público');
  await pagina.waitForTimeout(250);
  const porTemaSecundario = await pagina.locator('.tabela tbody').innerText();
  conferir('o filtro de tema alcança o tema secundário',
    porTemaSecundario.includes('PL 111/2025') && !porTemaSecundario.includes('PEC 555'),
    porTemaSecundario.replace(/\s+/g, ' '));

  await pagina.getByRole('button', { name: /Limpar filtros/ }).click();
  await pagina.waitForTimeout(250);
  conferir('limpar filtros devolve a lista inteira da subaba',
    (await pagina.locator('.contagem').innerText()).includes('2 de 2'),
    await pagina.locator('.contagem').innerText());

  // O recorte precisa sobreviver à navegação: reescolher os tipos a cada visita
  // é o tipo de atrito que faz a equipe abandonar a ferramenta.
  await pagina.locator('.chip', { hasText: /^PEC/ }).click();
  await pagina.waitForTimeout(200);
  await pagina.goto(`${BASE}/#/chefia/tarefas`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.tabela');
  await pagina.goto(`${BASE}/#/legislativo/autorias`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.facetas');
  await pagina.waitForTimeout(250);
  conferir('o recorte escolhido sobrevive à navegação',
    (await pagina.locator('.chip--ativo').innerText()).includes('PEC'),
    await pagina.locator('.facetas').innerText());
  await pagina.getByRole('button', { name: /Limpar filtros/ }).click();
  await pagina.waitForTimeout(200);

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

// ───────────── suíte 3: a segunda sessão não relê tudo de novo ─────────────
//
// Depois de recarregar a página, o duplo do servidor volta ao estado inicial e
// não tem mais as proposições importadas. Se elas continuarem na tela, vieram
// da cópia local — e a consulta ao servidor precisa ter sido por faixa, só do
// que mudou, e não a coleção inteira.

console.log('\nLeitura incremental\n');

{
  const pagina = await abrir();
  await pagina.goto(`${BASE}/#/legislativo/autorias`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.segmentos');
  await pagina.getByRole('button', { name: /Importar da Câmara/ }).click();
  await pagina.waitForFunction(
    () => document.querySelectorAll('.segmento-conta')[0]?.textContent === '1',
    null,
    { timeout: 15000 },
  ).catch(() => {});

  await pagina.reload({ waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.tabela', { timeout: 10000 }).catch(() => {});
  await pagina.waitForTimeout(300);

  conferir('a produção sobrevive ao recarregamento, sem o servidor',
    (await pagina.locator('.tabela tbody').innerText()).includes('PL 111/2025'));

  const consultas = await pagina.evaluate(
    () => globalThis.__CONSULTAS.filter((c) => c.caminho.endsWith('/autorias')),
  );
  conferir('a segunda sessão consulta o servidor por faixa, não inteiro',
    consultas.length > 0 && consultas.every((c) => c.operadores.includes('>')),
    JSON.stringify(consultas));

  // Sair precisa levar a cópia local junto: o computador é compartilhado.
  await pagina.getByRole('button', { name: /^Sair$/ }).first().click();
  await pagina.waitForTimeout(400);
  const sobrou = await pagina.evaluate(async () => {
    const bd = await new Promise((ok) => {
      const p = indexedDB.open('applegis', 1);
      p.onsuccess = () => ok(p.result);
      p.onerror = () => ok(null);
    });
    if (!bd) return -1;
    return new Promise((ok) => {
      const p = bd.transaction('documentos', 'readonly').objectStore('documentos').count();
      p.onsuccess = () => ok(p.result);
      p.onerror = () => ok(-1);
    });
  });
  conferir('sair apaga a cópia local', sobrou === 0, `${sobrou} registros restaram`);
  await pagina.close();
}

// ────────── suíte 4: gravação recusada precisa aparecer, não sumir ──────────
//
// Era esse o buraco: as regras recusavam a coleção, cada falha era engolida
// num try/catch, e o botão terminava anunciando sucesso sobre uma lista vazia.

console.log('\nFalha de gravação\n');

{
  const pagina = await abrir({ loteRecusado: true, ignorarConsole: true });
  await pagina.goto(`${BASE}/#/legislativo/autorias`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.segmentos');
  await pagina.getByRole('button', { name: /Importar da Câmara/ }).click();
  await pagina.waitForSelector('.aviso--erro', { timeout: 10000 }).catch(() => {});

  const recado = await pagina.locator('.aviso--erro').first().innerText().catch(() => '');
  conferir('gravação recusada vira aviso de erro na tela', /permission|permiss/i.test(recado), recado);
  conferir('nenhuma linha é anunciada como importada',
    !/proposições assinadas/.test(recado), recado);
  await pagina.close();
}

// ────────── suíte 5: histórico por tema, importado da Câmara ──────────

console.log('\nHistórico por tema\n');

{
  const pagina = await abrir();
  await pagina.goto(`${BASE}/#/legislativo/votacoes`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.modulo-topo');
  await pagina.getByRole('button', { name: /Importar votações/ }).click();
  await pagina.waitForSelector('.tabela tbody tr', { timeout: 15000 }).catch(() => {});
  await pagina.waitForTimeout(400);

  const tabela = (await pagina.locator('.tabela tbody').innerText()).replace(/\s+/g, ' ');

  conferir('registra a votação de mérito', tabela.includes('PL 111/2025'), tabela);
  conferir('a votação em colegiado alheio fica de fora', !tabela.includes('PL 999/2025'));
  conferir('a votação simbólica não vira linha', !tabela.includes('PL 888/2025'));

  const recado = await pagina.locator('.aviso').first().innerText().catch(() => '');
  conferir('o aviso admite quantas votações não têm registro individual',
    /simb[óo]lica/i.test(recado), recado.replace(/\s+/g, ' '));

  // O ponto central: votou SIM na retirada de pauta do PL 222, ou seja, votou
  // para travá-lo. A lista precisa dizer isso, não "Sim".
  conferir('o SIM na retirada de pauta aparece como trava, não como apoio',
    tabela.includes('travar o PL 222/2024'), tabela);
  conferir('o efeito do voto vira etiqueta na lista',
    (await pagina.locator('.tabela tbody').innerText()).includes('Freou o andamento'));

  // Recorte por natureza — a pergunta do gabinete é "onde ele votou para tirar
  // de pauta?", e ela precisa ser respondível num clique.
  await pagina.locator('.chip', { hasText: /Retirada de pauta/ }).click();
  await pagina.waitForTimeout(250);
  const soRetiradas = (await pagina.locator('.tabela tbody').innerText()).replace(/\s+/g, ' ');
  conferir('dá para isolar as votações de retirada de pauta',
    soRetiradas.includes('PL 222/2024') && !soRetiradas.includes('PL 111/2025'), soRetiradas);
  await pagina.getByRole('button', { name: /Limpar filtros/ }).click();
  await pagina.waitForTimeout(250);

  // Etiquetas do gabinete: o vocabulário da Câmara não conhece "pauta do agro".
  await pagina.locator('.col-inline .inline-abrir').first().click();
  await pagina.locator('.inline-entrada').first().fill('pauta do agro, prioridade');
  await pagina.locator('.inline-entrada').first().blur();
  await pagina.waitForTimeout(500);
  conferir('etiqueta escrita na própria lista aparece como etiqueta',
    (await pagina.locator('.tabela tbody .marcador').first().innerText()).includes('pauta do agro'),
    await pagina.locator('.tabela tbody').innerText());

  await pagina.goto(`${BASE}/#/chefia/tarefas`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.tabela');
  await pagina.goto(`${BASE}/#/legislativo/votacoes`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.facetas');
  await pagina.waitForTimeout(300);
  conferir('a etiqueta persiste e vira recorte',
    (await pagina.locator('.facetas').innerText()).includes('pauta do agro'),
    await pagina.locator('.facetas').innerText().catch(() => ''));

  await pagina.close();
}

// ────────── suíte 6: leitura política do voto (sem navegador) ──────────
//
// É a parte mais fácil de errar do sistema inteiro: "Sim" numa retirada de
// pauta é voto CONTRA a matéria. Um histórico que registre só Sim e Não
// descreve o mandato ao contrário na maioria das votações processuais.

console.log('\nLeitura política do voto\n');

{
  const v = await import('../js/votos.js');

  conferir('reconhece retirada de pauta',
    v.naturezaDe('Requerimento de Retirada de Pauta do PL 1904/2024') === 'retirada-pauta');
  conferir('retirada de pauta vence "requerimento" genérico',
    v.naturezaDe('Requerimento de retirada de pauta') === 'retirada-pauta');
  conferir('destaque vence emenda quando os dois aparecem',
    v.naturezaDe('Destaque para Votação em Separado da Emenda nº 3') === 'destaque');
  conferir('reconhece urgência',
    v.naturezaDe('Requerimento de Urgência para o PL 222/2024') === 'urgencia');
  conferir('votação comum cai em mérito',
    v.naturezaDe('Votação em turno único do PL 111/2025') === 'merito');

  conferir('sim no mérito é a favor',
    v.sentidoDo('sim', 'merito') === 'a-favor');
  conferir('SIM na retirada de pauta trava a matéria — o ponto todo',
    v.sentidoDo('sim', 'retirada-pauta') === 'freou');
  conferir('NÃO na retirada de pauta favorece a matéria',
    v.sentidoDo('nao', 'retirada-pauta') === 'avancou');
  conferir('não na urgência freia sem julgar o mérito',
    v.sentidoDo('nao', 'urgencia') === 'freou');
  conferir('destaque não recebe leitura inventada',
    v.sentidoDo('sim', 'destaque') === 'depende');
  conferir('obstrução é obstrução em qualquer natureza',
    v.sentidoDo('obstrucao', 'merito') === 'obstruiu');

  conferir('o resumo diz o que o voto fez, não como foi registrado',
    v.resumoDo({ voto: 'sim', natureza: 'retirada-pauta', proposicao: 'PL 222/2024' })
      === 'Votou de modo a travar o PL 222/2024 (retirada de pauta).',
    v.resumoDo({ voto: 'sim', natureza: 'retirada-pauta', proposicao: 'PL 222/2024' }));

  conferir('normaliza o voto vindo da Câmara',
    v.votoDe('Não') === 'nao' && v.votoDe('Obstrução') === 'obstrucao' && v.votoDe('Sim') === 'sim');
  conferir('sem orientação registrada não se afirma alinhamento',
    v.seguiuOrientacao('sim', null) === null);
  conferir('mede alinhamento com a bancada',
    v.seguiuOrientacao('sim', 'Sim') === true && v.seguiuOrientacao('nao', 'Sim') === false);
}

// ───────────── suíte 7: as regras cobrem todas as coleções da tela ─────────────
//
// Coleção que não está no mapa `areaDa` das regras é recusada em toda gravação,
// e o sintoma é cruel: a tela funciona, o botão diz que importou, e nada
// aparece. Módulo novo sem regra correspondente não pode passar daqui.

console.log('\nRegras de segurança\n');

const regras = fs.readFileSync(path.join(RAIZ, 'firestore.rules'), 'utf8');
const mapaDeAreas = /function areaDa\(colecao\) \{[\s\S]*?return \{([\s\S]*?)\}\.get\(/.exec(regras);
conferir('as regras declaram o mapa de áreas', !!mapaDeAreas);

const declaradas = new Set(
  [...(mapaDeAreas?.[1] || '').matchAll(/'([^']+)'\s*:\s*'([^']+)'/g)].map((m) => m[1]),
);

const fonteModulos = fs.readFileSync(path.join(RAIZ, 'js', 'modulos.js'), 'utf8');
const colecoes = [...fonteModulos.matchAll(/^ {4}id: '([^']+)',$/gm)].map((m) => m[1]);
conferir('encontrou os módulos para conferir', colecoes.length > 15, `${colecoes.length}`);

const semRegra = colecoes.filter((c) => !declaradas.has(c));
conferir('toda coleção de módulo tem área nas regras', semRegra.length === 0, semRegra.join(', '));

const semModulo = [...declaradas].filter((c) => !colecoes.includes(c));
conferir('nenhuma regra sobra sem módulo', semModulo.length === 0, semModulo.join(', '));

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
