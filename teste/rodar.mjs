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
  consultaAutomatica = false, funcoes = null,
} = {}) {
  const pagina = await navegador.newPage();
  pagina.on('pageerror', (e) => conferir(`erro de página inesperado (${papel})`, false, e.message));
  // O navegador registra no console toda resposta HTTP de erro, inclusive as
  // que o sistema trata de propósito — a recusa da Câmara, por exemplo. Ruído
  // de rede não é erro de aplicação; o que interessa aqui é exceção nossa.
  const ruidoDeRede = (t) => !t.trim()
    || /Failed to load resource|status of [45]\d\d|net::ERR/i.test(t);

  pagina.on('console', (m) => {
    if (m.type() === 'error' && !ignorarConsole && !ruidoDeRede(m.text())) {
      conferir(`erro de console inesperado (${papel})`, false, m.text());
    }
  });

  await pagina.addInitScript(([p, a, v, r]) => {
    globalThis.__PAPEL_TESTE = p;
    globalThis.__AREAS_TESTE = a;
    globalThis.__BANCO_VAZIO_TESTE = v;
    globalThis.__LOTE_RECUSADO_TESTE = r;
  }, [papel, areas, bancoVazio, loteRecusado]);

  // As respostas das Cloud Functions chegam por aqui: o duplo do SDK devolve o
  // que estiver declarado, inclusive erro. Uma resposta que dependa do que foi
  // pedido vem como `{ __fn: 'corpo da função' }`, porque função não atravessa
  // a serialização que leva os dados para dentro da página.
  if (funcoes) {
    await pagina.addInitScript((f) => {
      const declaradas = JSON.parse(f);
      globalThis.__FUNCOES_TESTE = {};
      for (const [nome, resposta] of Object.entries(declaradas)) {
        globalThis.__FUNCOES_TESTE[nome] = resposta && resposta.__fn
          // eslint-disable-next-line no-new-func
          ? new Function('dados', resposta.__fn)
          : resposta;
      }
    }, JSON.stringify(funcoes));
  }

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
      // Reproduz a recusa real: a base rejeita esta ordenação com 400 e explica
      // o motivo no corpo. A consulta precisa descer para a forma seguinte
      // sozinha, em vez de desistir da importação inteira.
      if (/ordenarPor=dataHoraRegistro/.test(url)) {
        rota.fulfill({
          status: 400,
          contentType: 'application/json',
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ mensagem: 'O parâmetro ordenarPor não aceita esse valor.' }),
        });
        return;
      }
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
      // Nomes oficiais, com vírgula dentro e tudo: é o que a base devolve, e é
      // o que a repartição e a forma curta precisam encarar.
      if (idProposicao === '111') {
        // Dois temas: o primeiro agrupa, os dois filtram.
        dados = [{ tema: 'Saúde' }, { tema: 'Finanças Públicas e Orçamento' }];
      } else if (idProposicao === '444') {
        dados = [{ tema: 'Administração Pública' }];
      } else {
        dados = [{ tema: 'Segurança Pública' }];
      }
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
      body: (await r.text())
        .replace("apiKey: 'COLE_AQUI'", "apiKey: 'chave-de-teste'")
        .replace(/export const CONSULTA_AUTOMATICA = \w+;/,
          `export const CONSULTA_AUTOMATICA = ${consultaAutomatica};`),
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
    ['orcamento', 'Dashboard'],
  ]) {
    await pagina.goto(`${BASE}/#/${area}`, { waitUntil: 'domcontentloaded' });
    await pagina.waitForSelector('.modulo-topo h1', { timeout: 10000 });
    const h1 = await pagina.locator('.modulo-topo h1').first().innerText();
    conferir(`área ${area} abre`, h1 === esperado, `abriu "${h1}"`);
  }

  await pagina.goto(`${BASE}/#/orcamento/painel-emendas`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.indicadores');
  const destinado = await pagina.locator('.indicador').filter({ hasText: 'Destinado' }).first()
    .locator('.indicador-valor').innerText();
  conferir('o painel soma o que foi destinado', destinado.includes('500'), `leu ${destinado}`);
  // A pergunta que chega ao gabinete é sobre um lugar, não sobre um documento.
  conferir('e a entrada é o município, com a situação ao lado',
    (await pagina.locator('.linha-municipio').count()) >= 1
    && /Erechim/i.test(await pagina.locator('.linha-municipio').first().innerText()),
    await pagina.locator('.linha-municipio').first().innerText());

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
    (await pagina.locator('.grupo-nome').first().innerText()) === 'Saúde',
    await pagina.locator('.grupo-nome').first().innerText());

  await pagina.getByRole('tab', { name: /Subscrição/ }).click();
  await pagina.waitForTimeout(250);
  const naSubscricao = await pagina.locator('.tabela tbody').innerText();
  conferir('subaba de subscrição troca o conteúdo',
    naSubscricao.includes('PL 222/2024') && !naSubscricao.includes('PL 111/2025'));
  conferir('cada subaba agrupa pelo próprio tema',
    (await pagina.locator('.grupo-nome').first().innerText()).includes('Segurança'));

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
  await pagina.locator('.faceta-select').selectOption('Orçamento');
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

  // ── ordenação dos grupos, clicando no próprio tema ──
  const primeiroGrupo = () => pagina.locator('.grupo-nome').first().innerText();
  const todosGrupos = () => pagina.locator('.grupo-nome').allInnerTexts();

  // Sem recorte, a subscrição tem quatro registros em dois temas de tamanhos
  // diferentes — que é o que distingue as duas ordens.
  await pagina.getByRole('tab', { name: /Subscrição/ }).click();
  await pagina.waitForTimeout(250);

  const porQuantidade = await todosGrupos();
  await pagina.locator('.grupo-botao').first().click();
  await pagina.waitForTimeout(250);
  const alfabetica = await todosGrupos();

  conferir('clicar no tema reordena os grupos de A a Z',
    JSON.stringify(alfabetica) === JSON.stringify([...alfabetica].sort((a, b) => a.localeCompare(b, 'pt-BR')))
    && JSON.stringify(alfabetica) !== JSON.stringify(porQuantidade),
    `antes ${JSON.stringify(porQuantidade)} depois ${JSON.stringify(alfabetica)}`);

  await pagina.locator('.grupo-botao').first().click();
  await pagina.waitForTimeout(250);
  conferir('clicar de novo volta à ordem por quantidade',
    JSON.stringify(await todosGrupos()) === JSON.stringify(porQuantidade));

  // A escolha precisa sobreviver: reordenar a cada visita é atrito puro.
  await pagina.locator('.grupo-botao').first().click();
  await pagina.waitForTimeout(200);
  await pagina.goto(`${BASE}/#/chefia/tarefas`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.tabela');
  await pagina.goto(`${BASE}/#/legislativo/autorias`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.tabela');
  await pagina.waitForTimeout(250);
  const depoisDeVoltar = await todosGrupos();
  conferir('a ordem escolhida sobrevive à navegação',
    JSON.stringify(depoisDeVoltar) === JSON.stringify([...depoisDeVoltar].sort((a, b) => a.localeCompare(b, 'pt-BR'))),
    JSON.stringify(depoisDeVoltar));

  await pagina.locator('.grupo-botao').first().click();
  await pagina.waitForTimeout(200);
  await pagina.getByRole('tab', { name: /Autoria/ }).click();
  await pagina.waitForTimeout(250);
  conferir('o nome do grupo sai na forma curta, não na oficial',
    !(await primeiroGrupo()).includes(','), await primeiroGrupo());

  // ── enviar para acompanhamento ──
  // A produção é o arquivo de tudo que ele assinou; acompanhar de perto é
  // escolher um punhado dali. O gesto precisa caber num clique na linha.
  await pagina.goto(`${BASE}/#/legislativo/autorias`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.tabela');
  await pagina.waitForTimeout(250);

  // Anota antes de promover: a nota é o que motivou o acompanhamento e não
  // pode ficar para trás na travessia.
  await pagina.locator('.tabela tbody .col-inline .inline-abrir').first().click();
  await pagina.locator('.inline-entrada').first().fill('Relator é da bancada.');
  await pagina.locator('.inline-entrada').first().blur();
  await pagina.waitForTimeout(400);

  await pagina.getByRole('button', { name: 'Enviar para acompanhamento' }).first().click();
  await pagina.waitForTimeout(700);
  conferir('a linha passa a dizer que está em acompanhamento',
    (await pagina.locator('.ja-feito').count()) > 0,
    await pagina.locator('.tabela tbody').innerText());

  await pagina.goto(`${BASE}/#/legislativo/proposicoes`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.tabela');
  await pagina.waitForTimeout(300);
  const acompanhadas = (await pagina.locator('.tabela tbody').innerText()).replace(/\s+/g, ' ');
  conferir('a proposição aparece em acompanhadas', acompanhadas.includes('PL 111/2024'), acompanhadas);
  conferir('a nota do gabinete atravessa junto',
    acompanhadas.includes('Relator é da bancada.'), acompanhadas);
  conferir('a linha nova já nasce com situação, sem esperar sincronização',
    acompanhadas.includes('Pronta para Pauta'), acompanhadas);

  // Promover de novo não pode criar uma segunda linha.
  await pagina.goto(`${BASE}/#/legislativo/autorias`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.tabela');
  await pagina.waitForTimeout(250);
  conferir('quem já está acompanhado não oferece o botão de novo',
    (await pagina.getByRole('button', { name: 'Enviar para acompanhamento' }).count())
      < (await pagina.locator('.tabela tbody tr').count()));

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
  conferir('gravação recusada vira aviso de erro na tela',
    /recusaram a gravação/i.test(recado), recado);
  // "Missing or insufficient permissions" manda procurar no perfil de quem está
  // usando, que é justamente onde não está o problema: coleção fora do mapa das
  // regras não é gravável por ninguém. O recado tem que apontar as regras.
  conferir('permissão negada nomeia a coleção e diz como republicar as regras',
    /"autorias"/.test(recado) && /firestore:rules/.test(recado), recado);
  conferir('nenhuma linha é anunciada como importada',
    !/proposições assinadas/.test(recado), recado);
  await pagina.close();
}

// ────────── suíte 5: histórico por tema, importado da Câmara ──────────

console.log('\nHistórico por tema\n');

{
  const pagina = await abrir();

  // Quais votações custaram uma consulta: o filtro de mérito só serve se ele
  // acontecer ANTES de gastar rede, e é isso que se confere aqui.
  const votosPedidos = [];
  const listagensPedidas = [];
  pagina.on('request', (r) => {
    const m = /\/votacoes\/([\w-]+)\/votos/.exec(r.url());
    if (m) votosPedidos.push(m[1]);
    if (/\/votacoes\?/.test(r.url())) listagensPedidas.push(r.url());
  });

  await pagina.goto(`${BASE}/#/legislativo/votacoes`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.modulo-topo');
  await pagina.getByRole('button', { name: /Importar votações/ }).click();
  await pagina.waitForSelector('.tabela tbody tr', { timeout: 15000 }).catch(() => {});
  await pagina.waitForTimeout(500);

  const tabela = (await pagina.locator('.tabela tbody').innerText()).replace(/\s+/g, ' ');

  conferir('a recusa da base não derruba a importação: a consulta se ajusta',
    tabela.includes('PL 111/2025'), tabela);
  conferir('registra a votação de mérito', tabela.includes('PL 111/2025'), tabela);
  conferir('a votação em colegiado alheio fica de fora', !tabela.includes('PL 999/2025'));
  conferir('a votação simbólica não vira linha', !tabela.includes('PL 888/2025'));

  // O ponto da mudança: retirada de pauta e urgência são processuais e nem
  // sequer chegam a custar uma consulta.
  conferir('votação processual não entra no histórico',
    !tabela.includes('PL 222/2024'), tabela);
  conferir('a peneira de mérito acontece antes de gastar consulta',
    !votosPedidos.includes('v2') && !votosPedidos.includes('v3') && votosPedidos.includes('v1'),
    `consultadas: ${votosPedidos.join(', ') || 'nenhuma'}`);

  conferir('o efeito do voto vira etiqueta na lista',
    tabela.includes('A favor da matéria'), tabela);

  // Quando o resultado é pequeno ou zero, o funil precisa dizer onde parou.
  const recado = await pagina.locator('.aviso').first().innerText().catch(() => '');
  conferir('o aviso mostra o funil, não só o total',
    /Examinadas/.test(recado) && /mérito/i.test(recado) && /simb[óo]lica/i.test(recado),
    recado.replace(/\s+/g, ' '));

  // A maioria das votações da Casa é simbólica e não gera registro; sem marca
  // de varredura, cada reimportação as reconsultaria todas de novo.
  const listagensPrimeira = listagensPedidas.length;
  votosPedidos.length = 0;
  listagensPedidas.length = 0;
  await pagina.getByRole('button', { name: /Importar votações/ }).click();
  await pagina.waitForTimeout(1500);
  conferir('reimportar não varre de novo o período já examinado',
    listagensPedidas.length < listagensPrimeira / 2 && votosPedidos.length < 3,
    `1ª: ${listagensPrimeira} listagens · 2ª: ${listagensPedidas.length} listagens, ${votosPedidos.length} consultas de voto`);

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

// ────────── suíte 6: leitura das planilhas de emendas (sem navegador) ──────────
//
// A execução de emendas chega por arquivo, e cada sistema escreve o seu de um
// jeito. Separador, codificação e número à brasileira são onde a importação
// erra calada — um valor lido errado vira uma cobrança errada a uma prefeitura.

console.log('\nPlanilhas de emenda\n');

{
  const pl = await import('../js/planilha.js');
  const em = await import('../js/emendas.js');

  conferir('número à brasileira vira número',
    pl.numeroBr('1.234.567,89') === 1234567.89
    && pl.numeroBr('R$ 500.000,00') === 500000
    && pl.numeroBr('0,50') === 0.5);
  conferir('ponto de milhar sem decimal não vira centavo',
    pl.numeroBr('1.234') === 1234, String(pl.numeroBr('1.234')));
  conferir('célula vazia é ausência, não zero',
    pl.numeroBr('') === null && pl.numeroBr('-') === null);

  // O objeto de um convênio quase sempre tem ponto e vírgula e quebra de linha.
  const csv = 'Código da Emenda;Ano da Emenda;Autor da Emenda;Localidade do gasto;Valor Empenhado;Valor Pago\n'
    + '202512340001;2025;MARCEL VAN HATTEM;ERECHIM - RS;"1.000.000,00";"250.000,00"\n'
    + '202512340002;2025;OUTRO DEPUTADO;PASSO FUNDO - RS;"900.000,00";"0,00"\n';
  const lido = pl.lerCsv(csv);
  conferir('reconhece o separador e o cabeçalho',
    lido.cabecalho.length === 6 && lido.linhas.length === 2, JSON.stringify(lido.cabecalho));

  const mapa = em.mapearColunas(lido.cabecalho);
  conferir('mapeia as colunas do Portal da Transparência',
    mapa.codigo === 0 && mapa.ano === 1 && mapa.autor === 2 && mapa.valorEmpenhado === 4 && mapa.valorPago === 5,
    JSON.stringify(mapa));
  conferir('identifica de onde a planilha veio',
    em.origemDaPlanilha(['Código da Emenda', 'Valor Restos A Pagar Inscritos']) === 'Portal da Transparência');
  conferir('reconhece a planilha do Transferegov',
    em.origemDaPlanilha(['Nº Proposta', 'Convenente', 'Valor Global']) === 'Transferegov');

  conferir('separa município e UF da coluna de localidade',
    em.separarLocalidade('ERECHIM - RS').municipio === 'ERECHIM'
    && em.separarLocalidade('ERECHIM - RS').uf === 'RS');
  conferir('localidade só com UF não vira nome de município',
    em.separarLocalidade('RS').municipio === null && em.separarLocalidade('RS').uf === 'RS');

  // Acento é a diferença entre a planilha do gabinete e as bases federais, que
  // gravam em caixa alta sem acento. Quem digita "ambulância" tem de achar
  // "AMBULANCIA", e o contrário também.
  {
    const mod = await import('../js/modulos.js');
    const emendas = mod.porId.emendas;
    conferir('a busca em emendas alcança município, categoria, número e proposta',
      ['codigo', 'numeroNaFonte', 'municipio', 'funcao', 'subfuncao', 'proposta', 'objeto']
        .every((k) => emendas.busca.includes(k)),
      emendas.busca.join(', '));
    conferir('e desce aos destinos, onde moram o município e o objeto de cada parcela',
      emendas.buscaEmFilhos?.colecao === 'transferencias'
      && emendas.buscaEmFilhos.campoPai === 'codigo'
      && emendas.buscaEmFilhos.campoFilho === 'codigoEmenda'
      && emendas.buscaEmFilhos.campos.includes('metas'),
      JSON.stringify(emendas.buscaEmFilhos));
    conferir('todo campo buscável existe no módulo — nome errado busca em nada',
      emendas.busca.every((k) => emendas.campos.some((c) => c.k === k)),
      emendas.busca.filter((k) => !emendas.campos.some((c) => c.k === k)).join(', ') || 'todos existem');
  }

  conferir('nome vai para a base como ela o guarda: caixa alta, sem acento',
    pl.nomeParaBusca('Marcel van Hattem') === 'MARCEL VAN HATTEM'
    && pl.nomeParaBusca('Vinícius Gurgel') === 'VINICIUS GURGEL'
    && pl.nomeParaBusca('  José  Medeiros ') === 'JOSE MEDEIROS');

  // A emenda discriminada: uma linha por beneficiário, como o Transferegov
  // publica em plano_acao_especial. É o nível que mostra para onde foi cada
  // parte de uma emenda que se repartiu entre municípios.
  conferir('o código de doze dígitos se remonta das partes que a base separa',
    em.codigoDaEmenda({ ano: 2025, parlamentar: 1234, sequencial: 1 }) === '202512340001',
    em.codigoDaEmenda({ ano: 2025, parlamentar: 1234, sequencial: 1 }));
  conferir('sem ano ou sem parlamentar não há código',
    em.codigoDaEmenda({ ano: 2025 }) === null && em.codigoDaEmenda({ parlamentar: 1234 }) === null);
  conferir('sequencial ausente não vira zero: código inventado casa com a emenda errada',
    em.codigoDaEmenda({ ano: 2025, parlamentar: 1234 }) === null
    && em.codigoDaEmenda({ ano: 2025, parlamentar: 1234, sequencial: 0 }) === '202512340000');
  conferir('a mesma grafia para comparar código escrito de vários jeitos',
    em.normalizarCodigo('2025.1234.0001') === '202512340001'
    && em.normalizarCodigo('12340001') === '000012340001'
    && em.normalizarCodigo('') === null && em.normalizarCodigo(null) === null,
    em.normalizarCodigo('2025.1234.0001'));
  // O Transferegov guarda o código de três formas e não diz qual é a do Portal.
  conferir('o plano de ação atende pelos códigos que a base publica',
    JSON.stringify(em.codigosDoPlano({
      codigo_emenda_parlamentar_formatado_plano_acao: '2025.1234.0009',
      ano_emenda_parlamentar_plano_acao: 2025,
      codigo_parlamentar_emenda_plano_acao: 1234,
      sequencial_emenda_parlamentar_plano_acao: 1,
      numero_emenda_parlamentar_plano_acao: 9,
    })) === JSON.stringify(['202512340009', '202512340001']),
    JSON.stringify(em.codigosDoPlano({
      codigo_emenda_parlamentar_formatado_plano_acao: '2025.1234.0009',
      ano_emenda_parlamentar_plano_acao: 2025,
      codigo_parlamentar_emenda_plano_acao: 1234,
      sequencial_emenda_parlamentar_plano_acao: 1,
      numero_emenda_parlamentar_plano_acao: 9,
    })));
  conferir('sem sequencial nem número, a linha não atende por código nenhum',
    em.codigosDoPlano({ ano_emenda_parlamentar_plano_acao: 2025, codigo_parlamentar_emenda_plano_acao: 1234 })
      .length === 0);
  // Visto na base real: numero_emenda traz o código inteiro, não o sequencial.
  // Prefixar de novo gerava "20264116202641160008", que não casa com nada.
  conferir('número que já é o código inteiro não recebe ano e parlamentar de novo',
    JSON.stringify(em.codigosDoPlano({
      codigo_emenda_parlamentar_formatado_plano_acao: '2026.4116.0008',
      ano_emenda_parlamentar_plano_acao: 2026,
      codigo_parlamentar_emenda_plano_acao: 4116,
      sequencial_emenda_parlamentar_plano_acao: 8,
      numero_emenda_parlamentar_plano_acao: '202641160008',
    })) === JSON.stringify(['202641160008']),
    JSON.stringify(em.codigosDoPlano({
      codigo_emenda_parlamentar_formatado_plano_acao: '2026.4116.0008',
      ano_emenda_parlamentar_plano_acao: 2026,
      codigo_parlamentar_emenda_plano_acao: 4116,
      sequencial_emenda_parlamentar_plano_acao: 8,
      numero_emenda_parlamentar_plano_acao: '202641160008',
    })));

  // Nome de campo não fecha diagnóstico nenhum: os nomes podem estar todos
  // certos e os valores todos vazios. O recorte mostra o que a linha tem.
  const recorte = em.recorteDaLinha({
    id_plano_acao: 7, nome_beneficiario_plano_acao: 'MUNICIPIO DE ERECHIM',
    motivo_impedimento_plano_acao: null, valor_custeio_plano_acao: '',
  });
  conferir('o recorte mostra o que a linha tem, com o sufixo repetido fora do caminho',
    recorte === 'id=7 · nome_beneficiario=MUNICIPIO DE ERECHIM', recorte);
  conferir('plano sem beneficiário e sem valor continua guardável: é o impedido',
    em.chaveDaTransferencia(em.doPlanoAcao({
      id_plano_acao: 55, situacao_plano_acao: 'Aguardando indicação',
    })) === 'pa-55');
  conferir('linha inteiramente vazia é dita como tal, não como ausência de campos',
    em.recorteDaLinha({ a: null, b: '' }) === '(todos os campos vieram vazios)');
  conferir('valor longo é cortado para caber num recado de tela',
    em.recorteDaLinha({ x: 'a'.repeat(400), y: 'b'.repeat(400) }, 80).endsWith('…'));
  conferir('o código se desmonta de volta nas três partes',
    JSON.stringify(em.partesDoCodigo('202512340001'))
      === JSON.stringify({ ano: 2025, parlamentar: 1234, sequencial: 1 }),
    JSON.stringify(em.partesDoCodigo('202512340001')));
  conferir('código curto demais não vira partes',
    em.partesDoCodigo('2025') === null);
  conferir('o município sai do nome do beneficiário',
    em.municipioDoBeneficiario('MUNICIPIO DE GRAMADO') === 'GRAMADO'
    && em.municipioDoBeneficiario('Prefeitura Municipal de Erechim') === 'Erechim'
    // Favorecido que não é prefeitura não tem município a extrair. Devolver o
    // nome da instituição escrevia "ASSOCIACAO BENEFICENTE HOSPITAL SANTO
    // ANTONIO" na coluna de município — dado errado no lugar de vazio honesto.
    && em.municipioDoBeneficiario('ASSOCIACAO BENEFICENTE HOSPITAL SANTO ANTONIO') === null
    && em.municipioDoBeneficiario('FUNDO ESTADUAL DE SAUDE') === null);

  const plano = em.doPlanoAcao({
    id_plano_acao: 9911,
    ano_emenda_parlamentar_plano_acao: 2025,
    codigo_parlamentar_emenda_plano_acao: 1234,
    sequencial_emenda_parlamentar_plano_acao: 1,
    nome_beneficiario_plano_acao: 'MUNICIPIO DE GRAMADO',
    cnpj_beneficiario_plano_acao: '88.111.222/0001-00',
    uf_beneficiario_plano_acao: 'RS',
    descricao_programacao_orcamentaria_plano_acao: 'Custeio da atenção básica',
    situacao_plano_acao: 'Impedimento técnico',
    motivo_impedimento_plano_acao: 'Dado bancário inválido',
    valor_custeio_plano_acao: '400000',
    valor_investimento_plano_acao: '100000',
  });
  conferir('o plano de ação traz quem recebeu, quanto e de qual emenda',
    plano.favorecido === 'MUNICIPIO DE GRAMADO' && plano.valor === 500000
    && plano.municipio === 'GRAMADO' && plano.uf === 'RS'
    && plano.codigoEmenda === '202512340001' && plano.tipo === 'especial',
    JSON.stringify(plano));
  conferir('o motivo do impedimento vem colado na situação, que é o que trava o repasse',
    plano.situacao === 'Impedimento técnico — Dado bancário inválido', plano.situacao);
  conferir('custeio e investimento continuam separados além do total',
    plano.valorCusteio === 400000 && plano.valorInvestimento === 100000);
  conferir('o plano de ação identifica a transferência sozinho',
    em.chaveDaTransferencia(plano) === 'pa-9911', em.chaveDaTransferencia(plano));
  conferir('sem plano de ação, a emenda mais o documento servem de chave',
    em.chaveDaTransferencia({ codigoEmenda: '202512340001', documento: '2025NE000123' })
      === '202512340001-2025NE000123');
  conferir('sem documento nem emenda não há chave possível',
    em.chaveDaTransferencia({ favorecido: 'Prefeitura' }) === null);

  // A execução no Portal cobre o que nenhuma base de transferência vê: convênio
  // de finalidade definida e a execução direta pelo órgão.
  conferir('a fase vem da palavra que a fonte usa',
    em.tipoDaFase('Empenho') === 'empenho'
    && em.tipoDaFase('Pagamento') === 'pagamento'
    && em.tipoDaFase('Liquidação') === 'liquidacao'
    && em.tipoDaFase('Outra coisa') === null);

  const doc = em.doDocumentoDaEmenda({
    id: 5, data: '10/02/2026', fase: 'Empenho',
    codigoDocumentoResumido: '2026NE000001',
    especieTipo: { descricao: 'Nota de empenho' },
    nomeFavorecido: 'MUNICIPIO DE GRAMADO', municipio: 'GRAMADO - RS',
    valor: '250.000,00',
  }, '202612340003');
  // O detalhe do documento, como a API o devolve de verdade: sem município, com
  // UF do favorecido, e com a observação do empenho no lugar do objeto.
  const detalhe = em.doDocumentoDaEmenda({
    documento: '257001000012020NE808376', documentoResumido: '2020NE808376',
    data: '08/04/2020', fase: 'Empenho', especie: 'ORIGINAL',
    observacao: 'EMPENHO PARA ATENDER A PORTARIA 706 DE 08/04/2020',
    funcao: '10 - Saúde', subfuncao: '301 - Atenção básica',
    programa: '5019 - ATENCAO PRIMARIA A SAUDE',
    acao: '2E89 - INCREMENTO TEMPORARIO AO CUSTEIO',
    localizadorGasto: '0040 - NA REGIAO SUL',
    nomeFavorecido: 'MUNICIPIO DE ERECHIM', codigoFavorecido: '87612917000100',
    ufFavorecido: 'RS', valor: '1.720.227,00',
  }, '202041160001');
  conferir('o documento detalhado traz o objeto, o favorecido e o valor',
    detalhe.objeto === 'PORTARIA 706 DE 08/04/2020'
    && detalhe.favorecido === 'MUNICIPIO DE ERECHIM' && detalhe.valor === 1720227
    && detalhe.uf === 'RS', JSON.stringify(detalhe));
  // "EMPENHO PARA ATENDER A…" repete o que a coluna Fase já diz, e some da
  // frente do objeto — numa lista de vinte e sete linhas, isso é uma parede de
  // texto idêntico escondendo a única parte que distingue uma linha da outra.
  conferir('o preâmbulo que repete a fase sai da frente do objeto',
    !/^EMPENHO/.test(detalhe.objeto), detalhe.objeto);
  conferir('o município sai do nome do favorecido, que é onde ele está',
    detalhe.municipio === 'ERECHIM', String(detalhe.municipio));
  conferir('a classificação funcional diz por qual programa o dinheiro saiu',
    detalhe.area === '10 - Saúde'
    && detalhe.acao === '5019 - ATENCAO PRIMARIA A SAUDE · 2E89 - INCREMENTO TEMPORARIO AO CUSTEIO'
    && detalhe.localizador === '0040 - NA REGIAO SUL', detalhe.acao);
  // A observação do pagamento identifica o documento; a do empenho descreve o
  // gasto. Escrever a primeira na coluna de objeto repetiu o erro do "Não se
  // aplica": ocupar com identificação o lugar da resposta.
  const burocratico = em.objetoDaObservacao(
    'PAGAMENTO DA PROPOSTA 11707405000126004 - UF RS - EMENDA: (41160003) MARCEL VAN HATTEM',
  );
  conferir('observação que só identifica não vira objeto',
    burocratico.objeto === null, String(burocratico.objeto));
  conferir('mas o número da proposta é guardado: é o elo com o convênio',
    burocratico.proposta === '11707405000126004', String(burocratico.proposta));

  const descritivo = em.objetoDaObservacao(
    'AQUISICAO DE EQUIPAMENTOS PARA UNIDADE DE SAUDE - UF RS - EMENDA: (41160003) MARCEL VAN HATTEM',
  );
  conferir('a descrição sobrevive à limpeza, sem os identificadores em volta',
    descritivo.objeto === 'AQUISICAO DE EQUIPAMENTOS PARA UNIDADE DE SAUDE',
    String(descritivo.objeto));

  // A frase real de um pagamento de saúde, com todo o ruído grudado nela.
  const real = em.objetoDaObservacao(
    'PAGAMENTO DE 65058-INCREMENTO TEMPORARIO AO CUSTEIO DOS SERVICOS DE ATENCAO'
    + ' BASICA EM SAUDE PARCELA UNICA MUNICIPAL - PROCESSO 25000075166202062 UF RS',
  );
  conferir('o objeto sai limpo do preâmbulo, do processo e da UF grudados',
    real.objeto === 'INCREMENTO TEMPORARIO AO CUSTEIO DOS SERVICOS DE ATENCAO BASICA'
      + ' EM SAUDE PARCELA UNICA MUNICIPAL', real.objeto);
  conferir('e o número do processo é guardado em vez de descartado',
    real.processo === '25000075166202062', String(real.processo));

  // Uma versão anterior gravou a espécie do documento na coluna de objeto. Os
  // registros continuam lá; reconhecê-los limpa o que já foi salvo errado.
  conferir('espécie gravada como objeto por versão antiga é reconhecida e some',
    em.objetoDaObservacao('ORIGINAL').objeto === null
    && em.objetoDaObservacao('Não se aplica').objeto === null);

  // "-14 - Múltiplo · -14 - Múltiplo" é a mesma informação escrita duas vezes,
  // e "Múltiplo" é o que a fonte diz quando não há um valor só.
  conferir('ação orçamentária não repete a si mesma nem enche a coluna de "Múltiplo"',
    em.acaoOrcamentaria('-14 - Múltiplo', '-14 - Múltiplo') === null
    && em.acaoOrcamentaria('5019 - ATENCAO', '5019 - ATENCAO') === '5019 - ATENCAO'
    && em.acaoOrcamentaria('5019 - ATENCAO', '2E89 - INCREMENTO')
      === '5019 - ATENCAO · 2E89 - INCREMENTO');

  // Numa transferência a município, o favorecido do documento é o banco que
  // operacionaliza o repasse. Quem recebeu está um nível abaixo.
  const repartido = em.repartirEntreFinais(
    { favorecido: 'BANCO DO BRASIL SA', valor: 7000, idDocumento: 9, tipo: 'pagamento' },
    [
      { nomeFavorecidoFinal: 'MUNICIPIO DE ACEGUA', ufFavorecido: 'RS', valor: '4.000,00' },
      { nomeFavorecidoFinal: 'MUNICIPIO DE VACARIA', ufFavorecido: 'RS', valor: '3.000,00' },
    ],
  );
  conferir('o pagamento ao banco vira um destino por município que recebeu',
    repartido.length === 2
    && repartido[0].municipio === 'ACEGUA' && repartido[0].valor === 4000
    && repartido[1].municipio === 'VACARIA'
    && repartido[0].favorecidoIntermediario === 'BANCO DO BRASIL SA',
    JSON.stringify(repartido));
  // Sem valor por parte, somar as partes daria um total diferente do documento.
  conferir('sem valor por parte não se reparte: a tabela mentiria para detalhar mais',
    em.repartirEntreFinais({ favorecido: 'BANCO DO BRASIL SA', valor: 7000 },
      [{ nomeFavorecidoFinal: 'MUNICIPIO DE ACEGUA' }]).length === 1);
  conferir('mas já se sabe para quem foi, ao lado do intermediário',
    em.repartirEntreFinais({ favorecido: 'BANCO DO BRASIL SA', valor: 7000 },
      [{ nomeFavorecidoFinal: 'MUNICIPIO DE ACEGUA' }])[0].favorecidoFinal
      === 'MUNICIPIO DE ACEGUA');
  conferir('documento sem favorecido final continua inteiro',
    em.repartirEntreFinais({ favorecido: 'X', valor: 1 }, []).length === 1);

  // O pagamento é a prova de que o dinheiro chegou e não pode sumir da lista.
  // Mas ele não descreve objeto — e o empenho da mesma emenda descreve.
  const herdadas = em.herdarObjeto([
    { tipo: 'empenho', objeto: 'AQUISICAO DE AMBULANCIA' },
    { tipo: 'pagamento', objeto: null },
  ]);
  conferir('o pagamento herda o objeto do empenho da mesma emenda',
    herdadas[1].objeto === 'AQUISICAO DE AMBULANCIA' && herdadas[1].objetoHerdado === true,
    JSON.stringify(herdadas[1]));
  conferir('com dois objetos diferentes não se herda: seria atribuir destino errado',
    em.herdarObjeto([
      { tipo: 'empenho', objeto: 'A' },
      { tipo: 'empenho', objeto: 'B' },
      { tipo: 'pagamento', objeto: null },
    ])[2].objeto === null);

  conferir('o código longo é o que serve para pedir o detalhe',
    detalhe.codigoDocumento === '257001000012020NE808376'
    && detalhe.documento === '2020NE808376', detalhe.codigoDocumento);
  conferir('o documento do Portal vira um destino da emenda',
    doc.codigoEmenda === '202612340003' && doc.tipo === 'empenho'
    && doc.documento === '2026NE000001' && doc.data === '2026-02-10'
    && doc.favorecido === 'MUNICIPIO DE GRAMADO' && doc.municipio === 'GRAMADO'
    && doc.uf === 'RS' && doc.valor === 250000,
    JSON.stringify(doc));
  // `especieTipo` é a espécie do documento — "Original", "Reforço", "Não se
  // aplica" —, não o objeto do gasto. Escrevê-la na coluna de objeto encheu a
  // tela de "Não se aplica" onde se esperava ler para que serviu o dinheiro:
  // parece resposta e não é, o que é pior que a coluna vazia.
  conferir('a espécie do documento não se disfarça de objeto do gasto',
    doc.especie === 'Nota de empenho' && doc.objeto === null,
    `especie=${doc.especie} objeto=${doc.objeto}`);
  conferir('documento sem plano de ação ainda tem chave própria',
    em.chaveDaTransferencia(doc) === 'doc-5', em.chaveDaTransferencia(doc));

  // Quatro rodadas descobrindo um endereço por vez, quando o serviço publica a
  // lista inteira com os parâmetros de cada um. É isto que encerra o palpite.
  const enderecos = em.enderecosDe({
    paths: {
      '/api-de-dados/emendas': { get: { parameters: [{ name: 'codigoEmenda' }, { name: 'pagina', required: true }] } },
      '/api-de-dados/despesas/documentos': { get: { parameters: [{ name: 'dataEmissao', required: true }] } },
      '/api-de-dados/contratos': { get: { parameters: [] } },
    },
  });
  conferir('a documentação vira lista de endereços com seus parâmetros',
    JSON.stringify(enderecos) === JSON.stringify([
      '/api-de-dados/emendas (codigoEmenda, pagina*)',
      '/api-de-dados/despesas/documentos (dataEmissao*)',
    ]), JSON.stringify(enderecos));
  conferir('parâmetro obrigatório é marcado, que é o que faz a chamada falhar',
    enderecos[1].includes('dataEmissao*'));
  conferir('o que não é do assunto fica de fora do relatório',
    !JSON.stringify(enderecos).includes('contratos'));
  conferir('resposta que não é documentação não vira lista vazia enganosa',
    em.enderecosDe({ dados: [] }) === null);
  conferir('o nome é procurado como está e também sem acento',
    JSON.stringify(em.grafiasDoNome('José Medeiros')) === JSON.stringify(['José Medeiros', 'JOSE MEDEIROS'])
    && em.grafiasDoNome('Marcel van Hattem').length === 2
    && em.grafiasDoNome('').length === 0,
    JSON.stringify(em.grafiasDoNome('José Medeiros')));

  // ── consolidação entre a planilha do gabinete e o Portal ──
  //
  // A planilha tem especificações que o Portal não publica; o Portal tem a
  // execução real. A regra vale nos dois sentidos, e discordância se registra
  // em vez de se engolir: número trocado em silêncio não pode mais ser
  // auditado.
  const jaConferida = {
    consultadoEm: '2026-08-01', valorEmpenhado: 1720227, municipio: 'ERECHIM', uf: 'RS',
  };
  const daPlanilha = {
    valorEmpenhado: 1700000, municipio: 'ERECHIM',
    objeto: 'Ambulância', beneficiario: 'Hospital São Vicente',
    detalhesDaPlanilha: 'Responsável: Fulano',
  };

  const juncao = em.consolidar(jaConferida, daPlanilha);
  conferir('o que só a planilha tem entra inteiro — é o motivo de consolidar',
    juncao.dados.objeto === 'Ambulância'
    && juncao.dados.beneficiario === 'Hospital São Vicente'
    && juncao.dados.detalhesDaPlanilha === 'Responsável: Fulano',
    JSON.stringify(juncao.dados));
  conferir('valor que o Portal já publicou não é sobrescrito pela planilha',
    juncao.dados.valorEmpenhado === undefined, String(juncao.dados.valorEmpenhado));
  conferir('e a discordância fica registrada, com os dois números',
    juncao.divergencias.length === 1
    && /valorEmpenhado/.test(juncao.divergencias[0])
    && /1\.700\.000,00/.test(juncao.divergencias[0])
    && /1\.720\.227,00/.test(juncao.divergencias[0]),
    JSON.stringify(juncao.divergencias));
  conferir('valor igual em formatos diferentes não é divergência',
    em.consolidar({ consultadoEm: '2026-08-01', valorPago: 1000 },
      { valorPago: '1.000,00' }).divergencias.length === 0);
  conferir('campo que o Portal deixou vazio a planilha preenche',
    em.consolidar({ consultadoEm: '2026-08-01', municipio: null },
      { municipio: 'GRAMADO' }).dados.municipio === 'GRAMADO');
  conferir('sem consulta prévia ao Portal, a planilha escreve tudo',
    em.consolidar({}, daPlanilha).dados.valorEmpenhado === 1700000);
  conferir('a consulta ao Portal escreve por cima e não acusa divergência',
    em.consolidar(jaConferida, { valorEmpenhado: 1800000 }, { autoritativa: true })
      .dados.valorEmpenhado === 1800000
    && em.consolidar(jaConferida, { valorEmpenhado: 1800000 }, { autoritativa: true })
      .divergencias.length === 0);

  conferir('a chave concilia pelo código e ano',
    em.chaveDaLinha({ codigo: '202512340001', ano: 2025 }) === '2025-202512340001');
  conferir('sem código, a proposta serve de chave',
    em.chaveDaLinha({ proposta: '045678/2025' }) === 'prop-045678-2025');
  conferir('linha sem nenhuma identificação não recebe chave',
    em.chaveDaLinha({ beneficiario: 'Prefeitura' }) === null);

  // Arquivo em ISO-8859-1, que é como boa parte das exportações ainda sai.
  const latin = new Uint8Array([0x53, 0xc3, 0xa3, 0x6f]); // "São" em UTF-8
  conferir('lê arquivo em UTF-8', pl.decodificar(latin.buffer) === 'São');
  const iso = new Uint8Array([0x53, 0xe3, 0x6f]); // "São" em ISO-8859-1
  conferir('lê arquivo em ISO-8859-1 sem estragar o acento',
    pl.decodificar(iso.buffer) === 'São', pl.decodificar(iso.buffer));
}

// ── a mesma planilha, agora entrando pela tela ──
{
  const pagina = await abrir();
  await pagina.goto(`${BASE}/#/orcamento/emendas`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.modulo-topo');

  // Duas linhas do parlamentar e uma de outro, como vem o arquivo do Portal da
  // Transparência: ele traz as emendas de todo mundo.
  const planilha = [
    'Código da Emenda;Ano da Emenda;Tipo de Emenda;Autor da Emenda;Localidade do gasto;Valor Empenhado;Valor Liquidado;Valor Pago;Valor Restos A Pagar Inscritos',
    '202512340001;2025;Individual;Deputada Teste;ERECHIM - RS;"1.000.000,00";"400.000,00";"250.000,00";"150.000,00"',
    '202512340002;2025;Bancada;Deputada Teste;PASSO FUNDO - RS;"2.000.000,00";"0,00";"0,00";"0,00"',
    '202512340003;2025;Individual;Outro Parlamentar;CANOAS - RS;"900.000,00";"0,00";"0,00";"0,00"',
  ].join('\n');

  await pagina.setInputFiles('.importador input[type=file]', {
    name: '2025_Emendas.csv', mimeType: 'text/csv', buffer: Buffer.from(planilha, 'utf-8'),
  });
  await pagina.waitForTimeout(900);

  const recado = await pagina.locator('.aviso').first().innerText().catch(() => '');
  conferir('a planilha é reconhecida e importada',
    /2 emendas novas/.test(recado) && /Portal da Transparência/.test(recado),
    recado.replace(/\s+/g, ' '));
  conferir('o funil diz quantas linhas eram de outro parlamentar',
    /1 eram de outros parlamentares/.test(recado), recado.replace(/\s+/g, ' '));

  const tabela = (await pagina.locator('.tabela tbody').innerText()).replace(/\s+/g, ' ');
  conferir('a emenda de outro parlamentar não entra',
    !tabela.includes('CANOAS'), tabela);
  conferir('o valor à brasileira chega como dinheiro na tela',
    tabela.includes('1,0 mi') || tabela.includes('1.000.000'), tabela);
  conferir('emenda de bancada é reconhecida pelo tipo',
    tabela.includes('Bancada'), tabela);

  // Reimportar o mesmo arquivo não pode duplicar nada.
  const antes = await pagina.locator('.tabela tbody tr').count();
  await pagina.setInputFiles('.importador input[type=file]', {
    name: '2025_Emendas.csv', mimeType: 'text/csv', buffer: Buffer.from(planilha, 'utf-8'),
  });
  await pagina.waitForTimeout(900);
  const recado2 = await pagina.locator('.aviso').last().innerText().catch(() => '');
  conferir('reimportar atualiza em vez de duplicar',
    (await pagina.locator('.tabela tbody tr').count()) === antes && /2 atualizadas/.test(recado2),
    `${antes} linhas · ${recado2.replace(/\s+/g, ' ')}`);

  await pagina.close();
}

// Arquivo que não é de emendas precisa dizer isso, não gravar lixo. Numa página
// à parte porque a recusa vai de propósito para o console.
{
  const pagina = await abrir({ ignorarConsole: true });
  await pagina.goto(`${BASE}/#/orcamento/emendas`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.modulo-topo');
  await pagina.setInputFiles('.importador input[type=file]', {
    name: 'lista.csv', mimeType: 'text/csv',
    buffer: Buffer.from('Nome;Telefone\nFulano;5199999', 'utf-8'),
  });
  await pagina.waitForTimeout(700);
  const recusa = await pagina.locator('.aviso--erro').first().innerText().catch(() => '');
  conferir('planilha sem colunas de valor é recusada com explicação',
    /colunas de valor/.test(recusa), recusa.replace(/\s+/g, ' '));
  conferir('a recusa não grava nada',
    !(await pagina.locator('.tabela tbody').innerText()).includes('Fulano'));
  await pagina.close();
}

// ── consulta automática, pela ponte no servidor ──
{
  const pagina = await abrir({
    consultaAutomatica: true,
    funcoes: {
      // O Portal só devolve quando o nome chega na forma dele: caixa alta.
      consultarFonte: {
        __fn: `if (!dados.parametros || dados.parametros.nomeAutor !== 'DEPUTADA TESTE') return { dados: [] };
        return { dados: [
          { codigoEmenda: '202598760001', ano: '2025', tipoEmenda: 'Individual',
            nomeAutor: 'Deputada Teste', localidadeDoGasto: 'GRAMADO - RS', funcao: 'Saúde',
            valorEmpenhado: '3.000.000,00', valorLiquidado: '1.500.000,00',
            valorPago: '1.200.000,00', valorRestoInscrito: '300.000,00' },
          { codigoEmenda: '202598760002', ano: '2025', tipoEmenda: 'Bancada',
            nomeAutor: 'Homônimo Qualquer', localidadeDoGasto: 'BENTO - RS',
            valorEmpenhado: '100,00' },
        ] };`,
      },
    },
  });

  await pagina.goto(`${BASE}/#/orcamento/emendas`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.modulo-topo');
  conferir('o botão de consulta aparece quando a ponte está ligada',
    (await pagina.getByRole('button', { name: 'Consultar Portal' }).count()) === 1);

  await pagina.getByRole('button', { name: 'Consultar Portal' }).click();
  await pagina.waitForTimeout(900);

  const recado = await pagina.locator('.aviso').last().innerText().catch(() => '');
  conferir('a consulta traz as emendas do Portal',
    /1 emendas novas/.test(recado), recado.replace(/\s+/g, ' '));
  conferir('homônimo é descartado, e isso é dito',
    /1 de nomes parecidos/.test(recado), recado.replace(/\s+/g, ' '));

  const tabela = (await pagina.locator('.tabela tbody').innerText()).replace(/\s+/g, ' ');
  conferir('o valor do Portal chega convertido',
    tabela.includes('GRAMADO') && /3\.000\.000/.test(tabela), tabela);
  conferir('a emenda do homônimo não entra', !tabela.includes('BENTO'), tabela);

  await pagina.close();
}

// Nome de campo divergente é o erro mais provável desta ponte e o único que não
// dá para prever de fora. Precisa virar diagnóstico, não zeros gravados.
{
  const pagina = await abrir({
    consultaAutomatica: true,
    funcoes: {
      consultarFonte: {
        dados: [{ idEmenda: '99', anoEmenda: '2025', autorDaEmenda: 'Deputada Teste', empenho: '10,00' }],
      },
    },
  });
  await pagina.goto(`${BASE}/#/orcamento/emendas`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.modulo-topo');
  await pagina.getByRole('button', { name: 'Consultar Portal' }).click();
  await pagina.waitForTimeout(800);
  const diag = await pagina.locator('.aviso--erro').first().innerText().catch(() => '');
  conferir('campo irreconhecível vira diagnóstico com os nomes recebidos',
    /nenhum campo foi reconhecido/.test(diag) && /idEmenda/.test(diag), diag.replace(/\s+/g, ' '));
  conferir('e nada é gravado com valores vazios',
    !(await pagina.locator('.tabela tbody').innerText()).includes('2025'),
    await pagina.locator('.tabela tbody').innerText());
  await pagina.close();
}

// O Portal pagina de quinze em quinze e não diz o total. Parar cedo demais
// transforma um mandato inteiro em quinze emendas — foi o que aconteceu.
{
  const pagina = await abrir({
    consultaAutomatica: true,
    funcoes: {
      // Três páginas de 15 e uma vazia, como a API real se comporta.
      consultarFonte: {
        // Sem ano, a fonte devolve só uma página — o recorte silencioso que
        // fazia um mandato inteiro caber em quinze linhas. Com ano, devolve o
        // exercício pedido.
        __fn: `var par = dados.parametros || {};
        var p = Number(par.pagina || 1);
        if (!par.ano) {
          if (p > 1) return { dados: [] };
          var soUma = [];
          for (var k = 0; k < 15; k++) {
            soUma.push({ codigoEmenda: '2026000' + (100 + k), ano: '2026',
              tipoEmenda: 'Individual', nomeAutor: 'DEPUTADA TESTE',
              localidadeDoGasto: 'ERECHIM - RS', valorEmpenhado: '1.000,00' });
          }
          return { dados: soUma };
        }
        if (p > 1) return { dados: [] };
        var linhas = [];
        for (var i = 0; i < 10; i++) {
          linhas.push({
            codigoEmenda: par.ano + '000' + (200 + i),
            ano: String(par.ano),
            tipoEmenda: 'Individual',
            nomeAutor: 'DEPUTADA TESTE',
            localidadeDoGasto: 'ERECHIM - RS',
            valorEmpenhado: '1.000,00',
          });
        }
        return { dados: linhas };`,
      },
    },
  });

  await pagina.goto(`${BASE}/#/orcamento/emendas`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.modulo-topo');
  await pagina.getByRole('button', { name: 'Consultar Portal' }).click();
  await pagina.waitForTimeout(1500);

  const recado = await pagina.locator('.aviso').last().innerText().catch(() => '');
  // Sem ano viriam 15. Varrendo 2019 até o ano corrente, vêm dez por exercício
  // mais os quinze da varredura livre — e a tela mostra a distribuição.
  conferir('a consulta varre ano a ano, não só o recorte que a fonte oferece',
    /emendas novas/.test(recado) && /2019: 10/.test(recado) && /2020: 10/.test(recado),
    recado.replace(/\s+/g, ' '));
  conferir('o aviso mostra a distribuição por ano, que denuncia exercício faltando',
    (recado.match(/20\d\d: \d+/g) || []).length >= 7, recado.replace(/\s+/g, ' '));
  await pagina.close();
}

// Fonte que ignora o número da página não pode virar laço infinito.
{
  const pagina = await abrir({
    consultaAutomatica: true,
    funcoes: {
      consultarFonte: {
        __fn: `return { dados: [{ codigoEmenda: 'X1', ano: '2025', nomeAutor: 'DEPUTADA TESTE', valorEmpenhado: '1,00' }] };`,
      },
    },
  });
  await pagina.goto(`${BASE}/#/orcamento/emendas`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.modulo-topo');
  await pagina.getByRole('button', { name: 'Consultar Portal' }).click();
  await pagina.waitForTimeout(1500);
  const recado = await pagina.locator('.aviso').last().innerText().catch(() => '');
  // A fonte devolve sempre o mesmo registro, em toda página e em todo ano. A
  // consulta precisa terminar e guardar uma emenda só.
  conferir('página que só repete o que já veio encerra a consulta',
    /1 emendas novas/.test(recado) && /2025: 1/.test(recado),
    recado.replace(/\s+/g, ' '));
  await pagina.close();
}

// ── o dashboard: onde o mandato chegou, e onde não chegou ──
//
// Duas malhas de mentira, uma que responde e outra que não. O mapa é o caminho
// bom; a lista é o que garante que uma indisponibilidade do IBGE não leve embora
// a resposta.
{
  const malhaFalsa = {
    type: 'FeatureCollection',
    features: [
      { properties: { codarea: '4306957' }, geometry: { type: 'Polygon', coordinates: [[[-52, -27], [-51, -27], [-51, -28], [-52, -28], [-52, -27]]] } },
      { properties: { codarea: '4300034' }, geometry: { type: 'Polygon', coordinates: [[[-54, -31], [-53, -31], [-53, -32], [-54, -32], [-54, -31]]] } },
      { properties: { codarea: '4309050' }, geometry: { type: 'Polygon', coordinates: [[[-51, -29], [-50, -29], [-50, -30], [-51, -30], [-51, -29]]] } },
    ],
  };
  const nomesFalsos = [
    { id: 4306957, nome: 'Erechim' },
    { id: 4300034, nome: 'Aceguá' },
    { id: 4309050, nome: 'Gramado' },
  ];

  const pagina = await abrir();
  await pagina.route(/servicodados\.ibge\.gov\.br.*malhas/, (r) => r.fulfill({
    status: 200,
    contentType: 'application/geo+json',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(malhaFalsa),
  }));
  await pagina.route(/servicodados\.ibge\.gov\.br.*municipios/, (r) => r.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(nomesFalsos),
  }));

  await pagina.goto(`${BASE}/#/orcamento/dashboard`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.mapa', { timeout: 15000 });

  conferir('o mapa desenha um polígono por município do estado',
    (await pagina.locator('.mapa-municipio').count()) === 3,
    `${await pagina.locator('.mapa-municipio').count()} polígonos`);
  // Só o município atendido é clicável: um mapa em que tudo responde a clique
  // promete resposta onde não há dado.
  conferir('só quem tem emenda é clicável, e vem pintado',
    (await pagina.locator('.mapa-municipio--com-emenda').count()) === 1,
    `${await pagina.locator('.mapa-municipio--com-emenda').count()} com emenda`);
  // "4306957" ao passar o mouse não responde pergunta nenhuma.
  conferir('e o município se identifica pelo nome, não pelo código do IBGE',
    /Erechim/.test(await pagina.locator('.mapa-municipio--com-emenda title').first().innerText()
      .catch(async () => pagina.locator('.mapa-municipio--com-emenda title').first().textContent())),
    await pagina.locator('.mapa-municipio--com-emenda title').first().textContent());

  await pagina.locator('.mapa-municipio--com-emenda').first().click();
  await pagina.waitForTimeout(400);
  const detalhe = (await pagina.locator('.bloco--detalhe-mapa').innerText()).replace(/\s+/g, ' ');
  conferir('clicar no município mostra as emendas dele',
    /Erechim/i.test(detalhe) && /emenda/i.test(detalhe), detalhe.slice(0, 200));

  await pagina.close();
}

// Um mapa que não carrega não pode levar embora a resposta.
{
  const pagina = await abrir();
  await pagina.route(/servicodados\.ibge\.gov\.br/, (r) => r.abort());
  await pagina.goto(`${BASE}/#/orcamento/dashboard`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.indicadores', { timeout: 15000 });
  await pagina.waitForTimeout(900);

  conferir('sem o IBGE, a distribuição vai em lista e a tela diz por quê',
    (await pagina.locator('.mapa').count()) === 0
    && /IBGE não respondeu/.test(await pagina.locator('.bloco').first().innerText()),
    (await pagina.locator('.bloco').first().innerText()).replace(/\s+/g, ' ').slice(0, 160));
  conferir('e o município continua a um clique de distância',
    (await pagina.locator('.bloco--detalhe-mapa').innerText()).length > 10);
  await pagina.close();
}

// As quatro abas saem da navegação sem sair do sistema: oito campos de outros
// módulos apontam para `equipe` em "Responsável", e apagar a coleção quebraria
// todos eles.
{
  const mod = await import('../js/modulos.js');
  const visiveis = mod.modulosDaArea('administrativo').map((m) => m.id);
  conferir('férias, documentos, histórico de contato e equipe saem da barra',
    !['ausencias', 'documentos', 'interacoes', 'equipe'].some((id) => visiveis.includes(id)),
    visiveis.join(', '));
  conferir('mas o administrativo continua com o que interessa',
    ['viagens', 'ceap', 'contatos', 'atendimentos'].every((id) => visiveis.includes(id)),
    visiveis.join(', '));
  // Esconder e desligar são coisas diferentes: misturá-las transformaria "tire
  // esta aba do caminho" em "perca este cadastro".
  conferir('a coleção escondida continua existindo, para os campos que a referenciam',
    !!mod.porId.equipe && mod.porId.equipe.oculto === true);
  const refs = mod.MODULOS.flatMap((m) => m.campos.filter((c) => c.ref).map((c) => c.ref));
  conferir('toda referência aponta para um módulo que existe',
    refs.every((r) => !!mod.porId[r]),
    refs.filter((r) => !mod.porId[r]).join(', ') || 'todas existem');
}

// ── pós-processamento: a fase que faltava entre buscar e mostrar ──
{
  const pp = await import('../js/posprocessamento.js');

  // O nome do favorecido diz o que ele é, e nem todo favorecido é destino.
  const casos = [
    ['MUNICIPIO DE ERECHIM', 'municipio', 'ERECHIM'],
    ['PREFEITURA MUNICIPAL DE GRAMADO', 'municipio', 'GRAMADO'],
    ['FUNDO MUNICIPAL DE SAUDE DE ANTA GORDA', 'municipio', 'ANTA GORDA'],
    ['MUNICIPIO DE ACEGUA - RS', 'municipio', 'ACEGUA'],
    // O banco não recebeu a emenda: passou o dinheiro adiante. Tratá-lo como
    // destino punha "BANCO DO BRASIL SA" na coluna de município e somava a ele
    // o repasse de dezenas de cidades.
    ['BANCO DO BRASIL SA', 'intermediario', null],
    ['CAIXA ECONOMICA FEDERAL', 'intermediario', null],
    ['ASSOCIACAO BENEFICENTE HOSPITAL SANTO ANTONIO', 'entidade', null],
    ['SANTA CASA DE CARIDADE', 'entidade', null],
    ['ESTADO DO RIO GRANDE DO SUL', 'estado', null],
    ['FUNDO ESTADUAL DE SAUDE', 'estado', null],
    ['MINISTERIO DA SAUDE', 'uniao', null],
  ];
  const erradas = casos.filter(([nome, tipo, cidade]) => {
    const c = pp.classificarDestino(nome);
    return c.tipo !== tipo || (c.municipio || null) !== cidade;
  });
  conferir('o favorecido é classificado, e só o que é município vira município',
    erradas.length === 0,
    erradas.map(([n]) => `${n} → ${JSON.stringify(pp.classificarDestino(n))}`).join(' | '));
  // Linha sem classificação foi o que produziu o filtro de 5752 opções vazias.
  // "Indefinido" é uma resposta; ausência de resposta, não.
  conferir('nome vazio recebe classificação, não ausência dela',
    pp.classificarDestino('').tipo === 'indefinido'
    && pp.classificarDestino(null).tipo === 'indefinido');

  // Empenho, liquidação e pagamento do mesmo dinheiro eram três linhas; somadas,
  // triplicavam o repasse.
  const reunidos = pp.reunirDestinos([
    { codigoEmenda: '202041160001', favorecido: 'BANCO DO BRASIL SA', municipio: 'ERECHIM',
      tipo: 'empenho', valor: 1000, documento: '2020NE1', data: '2020-04-08',
      objeto: 'ATENCAO BASICA EM SAUDE' },
    { codigoEmenda: '202041160001', favorecido: 'BANCO DO BRASIL SA', municipio: 'ERECHIM',
      tipo: 'liquidacao', valor: 1000, documento: '2020NS1', data: '2020-05-27' },
    { codigoEmenda: '202041160001', favorecido: 'BANCO DO BRASIL SA', municipio: 'ERECHIM',
      tipo: 'pagamento', valor: 1000, documento: '2020OB1', data: '2020-06-01' },
  ]);
  conferir('os documentos de um destino viram uma linha, com as fases em colunas',
    reunidos.length === 1
    && reunidos[0].valorEmpenhado === 1000
    && reunidos[0].valorLiquidado === 1000
    && reunidos[0].valorPago === 1000
    && reunidos[0].valor === 1000,
    JSON.stringify(reunidos[0]));
  conferir('e o município aparece no lugar do banco',
    reunidos[0].municipio === 'ERECHIM' && reunidos[0].destinoTipo === 'municipio');
  // "Foi pago em três parcelas" é informação, não ruído.
  conferir('a contagem de documentos se preserva, com os números',
    reunidos[0].qtdDocumentos === 3 && /2020NE1/.test(reunidos[0].documentos));
  conferir('e a linha sai classificada em que pé está',
    reunidos[0].situacaoExecucao === 'pago', reunidos[0].situacaoExecucao);
  conferir('o objeto sobrevive mesmo vindo de uma fase só',
    reunidos[0].objeto === 'ATENCAO BASICA EM SAUDE');

  // Dois executores da mesma cidade são dois destinos, com objetos diferentes.
  conferir('favorecido de verdade não se funde com outro da mesma cidade',
    pp.reunirDestinos([
      { codigoEmenda: '1', favorecido: 'SECRETARIA DE SAUDE', municipio: 'X', tipo: 'especial', valor: 1 },
      { codigoEmenda: '1', favorecido: 'SECRETARIA DE OBRAS', municipio: 'X', tipo: 'especial', valor: 2 },
    ]).length === 2);

  const semNada = pp.reunirDestinos([
    { codigoEmenda: '9', tipo: 'liquidacao', documento: '2020NS9', data: '2020-05-29' },
    { codigoEmenda: '9', tipo: 'liquidacao', documento: '2020NS8', data: '2020-05-30' },
  ]);
  // Os documentos não se jogam fora: reunidos, dois carimbos sem destino são UMA
  // linha que diz "dois documentos, destino a resolver" — e é ela que permite
  // tentar de novo. Descartá-los faria a falha de uma consulta apagar a prova de
  // que a execução existe.
  conferir('documentos sem destino resolvido viram uma linha, não zero nem trinta',
    semNada.length === 1 && semNada[0].qtdDocumentos === 2 && !pp.vazia(semNada[0]),
    JSON.stringify(semNada[0]));
  conferir('linha sem valor, sem quem e sem documento é descartada',
    pp.vazia({ qtdDocumentos: 0 }) === true);

  conferir('o impedimento vence qualquer valor na classificação da situação',
    pp.situacaoDaExecucao({ valorPago: 100, situacao: 'IMPEDIDO — dado bancário' }) === 'impedido');
  conferir('pago a menos que o empenhado é pago em parte, não pago',
    pp.situacaoDaExecucao({ valorEmpenhado: 100, valorPago: 40 }) === 'pago-parcial');
}

// A pergunta que chega ao gabinete: "quanto foi para Erechim, e já foi pago?".
// A resposta precisa estar na tela, não ser montada de cabeça a partir de linhas
// com o formato da fonte.
{
  const pagina = await abrir({
    consultaAutomatica: true,
    funcoes: {
      consultarFonte: {
        __fn: `var c = dados.caminho || '';
        var par = dados.parametros || {};
        if (c === '/transferenciasespeciais/plano_acao_especial') {
          if (Number(par.offset || 0) > 0) return { dados: [] };
          if (!/Deputada Teste/i.test(String(par.nome_parlamentar_emenda_plano_acao || ''))) return { dados: [] };
          return { dados: [
            { id_plano_acao: 701, ano_emenda_parlamentar_plano_acao: 2026,
              codigo_parlamentar_emenda_plano_acao: 1234,
              sequencial_emenda_parlamentar_plano_acao: 0,
              nome_beneficiario_plano_acao: 'MUNICIPIO DE ERECHIM',
              uf_beneficiario_plano_acao: 'RS', situacao_plano_acao: 'CIENTE',
              descricao_programacao_orcamentaria_plano_acao: 'Atenção básica',
              valor_investimento_plano_acao: '400000' },
            { id_plano_acao: 702, ano_emenda_parlamentar_plano_acao: 2026,
              codigo_parlamentar_emenda_plano_acao: 1234,
              sequencial_emenda_parlamentar_plano_acao: 0,
              nome_beneficiario_plano_acao: 'MUNICIPIO DE ACEGUA',
              uf_beneficiario_plano_acao: 'RS',
              situacao_plano_acao: 'IMPEDIDO',
              motivo_impedimento_plano_acao: 'Dado bancário inválido',
              valor_investimento_plano_acao: '398000' },
          ] };
        }
        if (c === '/transferenciasespeciais/executor_especial') {
          if (String(par.id_plano_acao || '') !== 'in.(701,702)') return { dados: [] };
          return { dados: [{ id_plano_acao: 701, id_executor: 900,
            nome_executor: 'SECRETARIA DE SAUDE', objeto_executor: 'Aquisição de ambulância',
            vl_investimento_executor: '400000' }] };
        }
        return { dados: [] };`,
      },
    },
  });

  await pagina.goto(`${BASE}/#/orcamento/transferencias`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.modulo-topo');
  await pagina.getByRole('button', { name: 'Detalhar emendas' }).click();
  await pagina.waitForTimeout(2200);

  await pagina.goto(`${BASE}/#/orcamento/painel-emendas`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.linha-municipio');

  const busca = pagina.locator('.busca');
  await busca.fill('erechim');
  await pagina.waitForTimeout(300);
  conferir('procurar o município deixa só ele na tela',
    (await pagina.locator('.linha-municipio').count()) === 1,
    `${await pagina.locator('.linha-municipio').count()} linhas`);

  const linha = (await pagina.locator('.linha-municipio').first().innerText()).replace(/\s+/g, ' ');
  conferir('e a linha já responde quanto e em que pé, sem abrir nada',
    /400\.000/.test(linha) && /sem empenho|sem pagamento|Pago/i.test(linha), linha);

  await pagina.locator('.linha-municipio').first().click();
  await pagina.waitForTimeout(300);
  const detalhe = (await pagina.locator('.municipio-detalhe').first().innerText()).replace(/\s+/g, ' ');
  conferir('abrir mostra emenda por emenda, com o objeto',
    /202612340000/.test(detalhe) && /Aquisição de ambulância/.test(detalhe), detalhe);

  // O impedimento é a informação mais acionável: é sobre ele que a prefeitura
  // liga, e ele tem de aparecer sem ninguém precisar procurar.
  await busca.fill('acegua');
  await pagina.waitForTimeout(300);
  const impedida = (await pagina.locator('.linha-municipio').first().innerText()).replace(/\s+/g, ' ');
  conferir('município com repasse travado é dito como travado na própria linha',
    /impedimento/i.test(impedida), impedida);
  await pagina.locator('.linha-municipio').first().click();
  await pagina.waitForTimeout(300);
  conferir('e o motivo do travamento aparece ao abrir',
    /Dado banc/i.test(await pagina.locator('.municipio-trava').first().innerText()),
    await pagina.locator('.municipio-trava').first().innerText().catch(() => '(sem trava na tela)'));

  await pagina.close();
}

// A busca em emendas. O gabinete procura por município, por objeto, pelo número
// — e o município de cada parcela não está na emenda: está no destino pendurado
// nela. Uma busca que não desce até ali não acha nada do que se procura.
{
  const pagina = await abrir({
    consultaAutomatica: true,
    funcoes: {
      consultarFonte: {
        __fn: `var c = dados.caminho || '';
        if (c === '/transferenciasespeciais/plano_acao_especial') {
          if (Number((dados.parametros || {}).offset || 0) > 0) return { dados: [] };
          if (!/Deputada Teste/i.test(String((dados.parametros || {}).nome_parlamentar_emenda_plano_acao || ''))) return { dados: [] };
          return { dados: [{ id_plano_acao: 501, ano_emenda_parlamentar_plano_acao: 2026,
            codigo_parlamentar_emenda_plano_acao: 1234,
            sequencial_emenda_parlamentar_plano_acao: 0,
            nome_beneficiario_plano_acao: 'MUNICIPIO DE ACEGUA',
            uf_beneficiario_plano_acao: 'RS',
            descricao_programacao_orcamentaria_plano_acao: 'Videomonitoramento urbano',
            valor_investimento_plano_acao: '398000' }] };
        }
        return { dados: [] };`,
      },
    },
  });

  // Traz o destino, para a busca ter em que descer.
  await pagina.goto(`${BASE}/#/orcamento/transferencias`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.modulo-topo');
  await pagina.getByRole('button', { name: 'Detalhar emendas' }).click();
  await pagina.waitForTimeout(2000);

  await pagina.goto(`${BASE}/#/orcamento/emendas`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.tabela');
  const busca = pagina.locator('.busca');
  const linhas = async () => pagina.locator('.tabela tbody tr:not(.linha-detalhe)').count();

  conferir('a busca anuncia o que aceita, em vez de parecer só por código',
    /munic[íi]pio/i.test(await busca.getAttribute('placeholder') || ''),
    await busca.getAttribute('placeholder'));

  // O município está na transferência, não na emenda.
  await busca.fill('acegua');
  await pagina.waitForTimeout(300);
  conferir('busca por município acha a emenda pelo destino pendurado nela',
    (await linhas()) === 1, `${await linhas()} linhas`);

  // Sem acento de um lado, com acento do outro.
  await busca.fill('videomonitoramento');
  await pagina.waitForTimeout(300);
  conferir('busca pelo objeto do destino também acha',
    (await linhas()) === 1, `${await linhas()} linhas`);

  await busca.fill('2026');
  await pagina.waitForTimeout(300);
  conferir('busca pelo número da emenda continua funcionando',
    (await linhas()) >= 1, `${await linhas()} linhas`);

  // Dois termos que moram em lugares diferentes: um na emenda, outro no destino.
  await busca.fill('acegua 2026');
  await pagina.waitForTimeout(300);
  conferir('vários termos se somam, mesmo vindo de campos diferentes',
    (await linhas()) === 1, `${await linhas()} linhas`);

  await busca.fill('acegua tratores');
  await pagina.waitForTimeout(300);
  conferir('e termo que não existe reduz a nada, em vez de ser ignorado',
    (await linhas()) === 0, `${await linhas()} linhas`);

  await pagina.close();
}

// Consolidação pela tela: consultar o Portal e depois importar a planilha de
// controle. A planilha acrescenta o que só ela tem, não apaga o que o Portal
// publicou, e a discordância aparece em vez de sumir.
{
  const pagina = await abrir({
    consultaAutomatica: true,
    funcoes: {
      consultarFonte: {
        __fn: `var par = dados.parametros || {};
        if (dados.fonte !== 'portal-emendas' && dados.caminho !== '/emendas') return { dados: [] };
        if (Number(par.pagina || 1) > 1) return { dados: [] };
        if (par.ano && String(par.ano) !== '2025') return { dados: [] };
        return { dados: [{ codigoEmenda: '202512340001', ano: '2025',
          nomeAutor: 'DEPUTADA TESTE', tipoEmenda: 'Emenda Individual',
          localidadeDoGasto: 'ERECHIM - RS', funcao: 'Saúde',
          valorEmpenhado: '1.720.227,00', valorPago: '1.720.227,00' }] };`,
      },
    },
  });

  await pagina.goto(`${BASE}/#/orcamento/emendas`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.modulo-topo');
  await pagina.getByRole('button', { name: 'Consultar Portal' }).click();
  await pagina.waitForTimeout(1500);

  // A planilha do gabinete: o mesmo código, um valor desatualizado e três
  // colunas que o Portal não publica.
  const planilha = [
    'Código da Emenda;Ano;Autor;Valor Empenhado;Objeto;Convenente;Responsável no gabinete',
    '202512340001;2025;DEPUTADA TESTE;"1.700.000,00";Ambulância tipo A;HOSPITAL SAO VICENTE;Fulano',
  ].join('\n');
  await pagina.setInputFiles('.importador input[type=file]', {
    name: 'controle.csv', mimeType: 'text/csv', buffer: Buffer.from(planilha, 'utf8'),
  });
  await pagina.waitForTimeout(1500);

  const recado = (await pagina.locator('.aviso').last().innerText().catch(() => ''))
    .replace(/\s+/g, ' ');
  conferir('a importação relata quantas divergem e que o Portal prevaleceu',
    /1 divergem do Portal/.test(recado) && /mantive o Portal/i.test(recado), recado);
  conferir('e relata as colunas próprias da planilha que foram guardadas',
    /colunas próprias da planilha/.test(recado)
    && /Responsável no gabinete/.test(recado), recado);

  const tabela = (await pagina.locator('.tabela tbody').innerText()).replace(/\s+/g, ' ');
  conferir('o valor exibido continua sendo o do Portal',
    /1\.720\.227/.test(tabela) && !/1\.700\.000/.test(tabela), tabela);
  conferir('e a emenda fica marcada como divergente, para virar lista de trabalho',
    /Divergente/.test(tabela), tabela);

  await pagina.close();
}

// A sondagem existe porque adivinhar endereço custava uma implantação por
// palpite. Agora ela se expande sozinha: lê o catálogo do serviço e percorre o
// que ele declarar, em vez de depender de uma lista escrita à mão aqui.
{
  const pagina = await abrir({
    consultaAutomatica: true,
    ignorarConsole: true,
    funcoes: {
      consultarFonte: {
        // A raiz de um serviço PostgREST devolve o catálogo das tabelas: é o
        // que substitui o palpite pelo nome certo.
        __fn: `var c = dados.caminho || '';
        var par = dados.parametros || {};
        if (c === '/v3/api-docs') {
          return { dados: { paths: {
            '/api-de-dados/despesas/documentos-relacionados': {
              get: { parameters: [{ name: 'codigoDocumento', required: true }] } },
            '/api-de-dados/licitacoes': { get: { parameters: [] } },
          } } };
        }
        if (c === '/transferenciasvoluntarias') {
          return { dados: { paths: { '/': {}, '/proposta': {}, '/convenio': {} } } };
        }
        if (c === '/transferenciasvoluntarias/proposta') {
          if (par.nome_parlamentar_proposta) {
            return /Deputada Teste/i.test(par.nome_parlamentar_proposta)
              ? { dados: [{ id_proposta: 55, nr_emenda: '202612340000',
                  nome_parlamentar_proposta: 'Deputada Teste',
                  objeto_proposta: 'Pavimentação de vias urbanas' }] }
              : { dados: [] };
          }
          return { dados: [{ id_proposta: 1, nr_emenda: '209900000000',
            nome_parlamentar_proposta: 'Outro Deputado', objeto_proposta: 'Outra coisa' }] };
        }
        if (c === '/transferenciasvoluntarias/convenio') {
          return { dados: [{ id_convenio: 9, vl_global_convenio: 1000 }] };
        }
        var e = new Error('respondeu 404: <html><head><title>404</title></head><body>nginx</body></html>');
        e.code = 'functions/unavailable';
        throw e;`,
      },
    },
  });

  await pagina.goto(`${BASE}/#/orcamento/emendas`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.modulo-topo');
  await pagina.getByRole('button', { name: 'Sondar fontes' }).click();
  await pagina.waitForSelector('.sondagem-texto', { timeout: 30000 });

  const texto = await pagina.locator('.sondagem-texto').inputValue();
  // Se a documentação responde, nenhum palpite precisa acertar: ela diz o
  // endereço e os parâmetros obrigatórios de uma vez.
  conferir('a sondagem consulta a documentação da API antes de adivinhar',
    /doc \/v3\/api-docs/.test(texto)
    && /despesas\/documentos-relacionados \(codigoDocumento\*\)/.test(texto),
    texto.split('\n').filter((l) => l.includes('api-docs') || l.includes('relacionados')).join(' | '));
  conferir('a sondagem lê o catálogo de tabelas na raiz do serviço',
    /TABELAS\s+\/transferenciasvoluntarias — proposta, convenio/.test(texto),
    texto.split('\n').find((l) => l.includes('TABELAS')) || texto.slice(0, 120));
  // O ponto da reescrita: ninguém escreveu "proposta" numa lista de candidatos.
  // Ela veio do catálogo e foi consultada por causa disso.
  conferir('e percorre as tabelas que o catálogo declarou, sem lista escrita à mão',
    /OK\s+\/transferenciasvoluntarias\/proposta/.test(texto)
    && /OK\s+\/transferenciasvoluntarias\/convenio/.test(texto),
    texto.split('\n').filter((l) => l.startsWith('OK')).join(' | '));
  conferir('a tabela responde com suas colunas',
    /objeto_proposta/.test(texto) && /vl_global_convenio/.test(texto));
  conferir('as colunas que ligam à emenda vêm apontadas',
    /liga por: nr_emenda, nome_parlamentar_proposta/.test(texto),
    texto.split('\n').find((l) => l.includes('liga por')) || '');
  // Uma linha de verdade do parlamentar ensina mais que a lista de colunas:
  // mostra que valores esperar e como pendurá-la na emenda.
  conferir('e uma linha do próprio parlamentar, quando a tabela o nomeia',
    /exemplo: .*Pavimentação de vias urbanas/.test(texto),
    texto.split('\n').find((l) => l.includes('exemplo:')) || '');
  conferir('tabela sem coluna de parlamentar não inventa exemplo',
    !/vl_global_convenio[\s\S]{0,80}exemplo/.test(texto));
  conferir('o Portal também é sondado, com o código na URL',
    /portal\/emendas\/202612340000/.test(texto),
    texto.split('\n').filter((l) => l.includes('portal/')).join(' | ').slice(0, 200));
  conferir('página HTML de erro não é despejada inteira no relatório',
    /FALHA/.test(texto) && !/<head>/.test(texto),
    texto.split('\n').find((l) => l.startsWith('FALHA')) || '');

  await pagina.close();
}

// A sanfona: a emenda de sete milhões que aparece como "MÚLTIPLO" precisa
// abrir na própria linha e mostrar para onde cada parte foi.
{
  const pagina = await abrir({
    consultaAutomatica: true,
    funcoes: {
      consultarFonte: {
        // O Transferegov filtra por ano e parlamentar; o sequencial é peneirado
        // no cliente, então o duble devolve as duas linhas da mesma emenda mais
        // uma de outra, para conferir que a peneira funciona.
        __fn: `if (dados.caminho !== '/transferenciasespeciais/plano_acao_especial') return { dados: [] };
        if (Number((dados.parametros || {}).offset || 0) > 0) return { dados: [] };
        return { dados: [
          { id_plano_acao: 1, ano_emenda_parlamentar_plano_acao: 2026,
            codigo_parlamentar_emenda_plano_acao: 1234,
            sequencial_emenda_parlamentar_plano_acao: 0,
            nome_beneficiario_plano_acao: 'MUNICIPIO DE ERECHIM',
            uf_beneficiario_plano_acao: 'RS', situacao_plano_acao: 'Em execução',
            valor_custeio_plano_acao: '4000000' },
          { id_plano_acao: 2, ano_emenda_parlamentar_plano_acao: 2026,
            codigo_parlamentar_emenda_plano_acao: 1234,
            sequencial_emenda_parlamentar_plano_acao: 0,
            nome_beneficiario_plano_acao: 'MUNICIPIO DE GRAMADO',
            uf_beneficiario_plano_acao: 'RS', situacao_plano_acao: 'Em execução',
            valor_investimento_plano_acao: '3000000' },
          { id_plano_acao: 3, ano_emenda_parlamentar_plano_acao: 2026,
            codigo_parlamentar_emenda_plano_acao: 1234,
            sequencial_emenda_parlamentar_plano_acao: 7,
            nome_beneficiario_plano_acao: 'MUNICIPIO DE VACARIA',
            uf_beneficiario_plano_acao: 'RS', valor_custeio_plano_acao: '900000' },
        ] };`,
      },
    },
  });

  await pagina.goto(`${BASE}/#/orcamento/emendas`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.tabela');
  await pagina.waitForTimeout(200);

  conferir('cada emenda ganha o botão de abrir',
    (await pagina.locator('.btn-sanfona').count()) > 0);
  conferir('o detalhe começa fechado',
    (await pagina.locator('.linha-detalhe:visible').count()) === 0);

  await pagina.locator('.btn-sanfona').first().click();
  await pagina.waitForTimeout(900);

  const dentro = (await pagina.locator('.linha-detalhe').first().innerText()).replace(/\s+/g, ' ');
  conferir('a sanfona mostra os municípios que a emenda contemplou',
    dentro.includes('ERECHIM') && dentro.includes('GRAMADO'), dentro);
  conferir('e o valor de cada parcela',
    /4\.000\.000/.test(dentro) && /3\.000\.000/.test(dentro), dentro);
  conferir('plano de ação de outra emenda não entra nesta sanfona',
    !dentro.includes('VACARIA'), dentro);
  conferir('a sanfona fecha a conta do que foi repartido',
    /7\.000\.000/.test(dentro) && /2 destino/.test(dentro), dentro);

  await pagina.locator('.btn-sanfona').first().click();
  await pagina.waitForTimeout(250);
  conferir('clicar de novo fecha a sanfona',
    (await pagina.locator('.linha-detalhe:visible').count()) === 0);

  await pagina.close();
}

// Linha que chega e não é desta emenda não é "campo não reconhecido". Já disse
// isso uma vez e mandei procurar no lugar errado; o recado tem que distinguir.
{
  const pagina = await abrir({
    consultaAutomatica: true,
    funcoes: {
      consultarFonte: {
        __fn: `if (dados.caminho !== '/transferenciasespeciais/plano_acao_especial') return { dados: [] };
        if (Number((dados.parametros || {}).offset || 0) > 0) return { dados: [] };
        return { dados: [
          { id_plano_acao: 90, ano_emenda_parlamentar_plano_acao: 2026,
            codigo_parlamentar_emenda_plano_acao: 1234,
            sequencial_emenda_parlamentar_plano_acao: 8,
            nome_beneficiario_plano_acao: 'MUNICIPIO DE VACARIA',
            valor_custeio_plano_acao: '900000' },
        ] };`,
      },
    },
  });

  await pagina.goto(`${BASE}/#/orcamento/emendas`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.tabela');
  await pagina.locator('.btn-sanfona').first().click();
  await pagina.waitForTimeout(900);
  const recado = (await pagina.locator('.sanfona-recado').first().innerText().catch(() => ''))
    .replace(/\s+/g, ' ');
  // Planos de outras emendas do mesmo ano não são falha: são a resposta de que
  // esta emenda não foi por transferência especial. Dizer isso poupa abrir uma
  // a uma para descobrir quais foram.
  conferir('emenda sem plano de ação é dita como resposta, não como erro',
    /não é transferência especial/.test(recado)
    && /202612340008/.test(recado)
    && !/campo/i.test(recado), recado);
  await pagina.close();
}

// A emenda que não é transferência especial ainda foi executada. O Portal
// registra essa execução para qualquer modalidade — inclusive a direta, em que o
// ministério paga o fornecedor e nenhuma base de transferência jamais a vê.
{
  const pagina = await abrir({
    consultaAutomatica: true,
    funcoes: {
      consultarFonte: {
        __fn: `var c = dados.caminho || '';
        var par = dados.parametros || {};
        if (c === '/emendas/documentos/202612340000') {
          if (Number(par.pagina || 1) > 1) return { dados: [] };
          return { dados: [
            { id: 1, data: '10/02/2026', fase: 'Empenho',
              codigoDocumentoResumido: '2026NE000001',
              especieTipo: { descricao: 'Original' },
              observacao: 'Aquisição de equipamentos hospitalares',
              nomeFavorecido: 'MUNICIPIO DE ERECHIM', municipio: 'ERECHIM - RS',
              valor: '4.000.000,00' },
            { id: 2, data: '11/02/2026', fase: 'Pagamento',
              codigoDocumentoResumido: '2026OB000009',
              especieTipo: { descricao: 'Original' },
              observacao: 'Reforma de unidade básica',
              nomeFavorecido: 'MUNICIPIO DE GRAMADO', municipio: 'GRAMADO - RS',
              valor: '3.000.000,00' },
          ] };
        }
        return { dados: [] };`,
      },
    },
  });

  await pagina.goto(`${BASE}/#/orcamento/emendas`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.tabela');
  await pagina.locator('.btn-sanfona').first().click();
  await pagina.waitForTimeout(1500);

  const dentro = (await pagina.locator('.linha-detalhe').first().innerText()).replace(/\s+/g, ' ');
  conferir('emenda fora do Transferegov abre pelos documentos do Portal',
    dentro.includes('ERECHIM') && dentro.includes('GRAMADO'), dentro);
  conferir('com o objeto de cada documento',
    /Aquisição de equipamentos hospitalares/.test(dentro)
    && /Reforma de unidade básica/.test(dentro), dentro);
  // As fases deixam de ser linhas e passam a ser colunas: o mesmo real registrado
  // em etapas somava três vezes quando cada etapa era uma linha.
  conferir('as fases viram colunas, e cada real é contado uma vez',
    /EMPENHADO/i.test(dentro) && /PAGO/i.test(dentro)
    && /4\.000\.000/.test(dentro) && /3\.000\.000/.test(dentro), dentro);
  conferir('somando o que a emenda repartiu',
    /7\.000\.000/.test(dentro), dentro);
  await pagina.close();
}

// O caminho que a documentação da API nomeou, com o formato real das duas
// consultas: o índice traz fase e data, o detalhe traz objeto, favorecido e
// valor. É a resposta a "para quem foi e para qual objeto".
{
  const pagina = await abrir({
    consultaAutomatica: true,
    funcoes: {
      consultarFonte: {
        __fn: `var c = dados.caminho || '';
        if (c === '/emendas/documentos/202612340000') {
          if (Number((dados.parametros || {}).pagina || 1) > 1) return { dados: [] };
          return { dados: [
            { id: 1, data: '08/04/2026', fase: 'Empenho',
              codigoDocumento: '257001000012026NE808376',
              codigoDocumentoResumido: '2026NE808376',
              especieTipo: 'ORIGINAL' },
            { id: 2, data: '02/07/2026', fase: 'Pagamento',
              codigoDocumento: '257001000012026OB800111',
              codigoDocumentoResumido: '2026OB800111',
              especieTipo: 'ORIGINAL' },
          ] };
        }
        // O detalhe vem como objeto, não como lista — e é o código longo que o
        // identifica, não o resumido.
        if (c === '/despesas/documentos/257001000012026NE808376') {
          return { dados: { documento: '257001000012026NE808376',
            documentoResumido: '2026NE808376', data: '08/04/2026', fase: 'Empenho',
            observacao: 'EMPENHO PARA ATENDER A PORTARIA 706',
            funcao: '10 - Saúde', subfuncao: '301 - Atenção básica',
            programa: '5019 - ATENCAO PRIMARIA A SAUDE', acao: '2E89 - INCREMENTO',
            nomeFavorecido: 'MUNICIPIO DE ERECHIM', ufFavorecido: 'RS',
            valor: '4.000.000,00' } };
        }
        if (c === '/despesas/documentos/257001000012026OB800111') {
          return { dados: { documento: '257001000012026OB800111',
            documentoResumido: '2026OB800111', data: '02/07/2026', fase: 'Pagamento',
            observacao: 'PAGAMENTO DA PROPOSTA 11707405000126004 - UF RS - EMENDA: (41160003) TESTE',
            funcao: '10 - Saúde', nomeFavorecido: 'MUNICIPIO DE GRAMADO',
            ufFavorecido: 'RS', valor: '3.000.000,00' } };
        }
        return { dados: [] };`,
      },
    },
  });

  await pagina.goto(`${BASE}/#/orcamento/emendas`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.tabela');
  await pagina.locator('.btn-sanfona').first().click();
  await pagina.waitForTimeout(2500);

  const dentro = (await pagina.locator('.linha-detalhe').first().innerText()).replace(/\s+/g, ' ');
  conferir('o detalhe do documento traz para quem foi',
    /MUNICIPIO DE ERECHIM/.test(dentro) && /MUNICIPIO DE GRAMADO/.test(dentro), dentro);
  conferir('e para qual objeto',
    /PORTARIA 706/.test(dentro), dentro);
  conferir('e quanto, agora com total de verdade',
    /4\.000\.000/.test(dentro) && /7\.000\.000/.test(dentro)
    && !/valores não informados/.test(dentro), dentro);
  conferir('a ação orçamentária diz por qual programa o dinheiro saiu',
    /ATENCAO PRIMARIA A SAUDE/.test(dentro), dentro);
  // A linha de pagamento fica — é a prova de que o dinheiro chegou —, mas a
  // observação dela identifica em vez de descrever, e o objeto vem do empenho.
  // Cada município é um destino, com o objeto herdado do empenho — e a
  // observação burocrática do pagamento não ocupa a coluna de objeto.
  conferir('cada município vira um destino, com o objeto do empenho',
    !/PAGAMENTO DA PROPOSTA/.test(dentro)
    && (dentro.match(/PORTARIA 706/g) || []).length === 2,
    dentro);
  await pagina.close();
}

// Bastava UMA linha ter dado para as outras vinte e seis ficarem congeladas
// vazias para sempre. A conta tem de ser por linha.
{
  const pagina = await abrir({
    consultaAutomatica: true,
    funcoes: {
      consultarFonte: {
        __fn: `var c = dados.caminho || '';
        if (c === '/emendas/documentos/202612340000') {
          if (Number((dados.parametros || {}).pagina || 1) > 1) return { dados: [] };
          return { dados: [
            { id: 1, data: '08/04/2026', fase: 'Empenho',
              codigoDocumento: 'AAA1', codigoDocumentoResumido: '2026NE0001' },
            { id: 2, data: '09/04/2026', fase: 'Liquidação',
              codigoDocumento: 'BBB2', codigoDocumentoResumido: '2026NS0002' },
          ] };
        }
        // Só o primeiro documento responde na primeira rodada; o segundo passa a
        // responder depois, como se a consulta anterior tivesse falhado nele.
        if (c === '/despesas/documentos/AAA1') {
          return { dados: { documento: 'AAA1', data: '08/04/2026', fase: 'Empenho',
            observacao: 'AQUISICAO DE AMBULANCIA', nomeFavorecido: 'MUNICIPIO DE ERECHIM',
            valor: '1.000,00' } };
        }
        if (c === '/despesas/documentos/BBB2' && globalThis.__SEGUNDA_RODADA) {
          return { dados: { documento: 'BBB2', data: '09/04/2026', fase: 'Liquidação',
            observacao: 'AQUISICAO DE AMBULANCIA', nomeFavorecido: 'MUNICIPIO DE GRAMADO',
            valor: '900,00' } };
        }
        return { dados: [] };`,
      },
    },
  });

  await pagina.goto(`${BASE}/#/orcamento/emendas`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.tabela');
  await pagina.locator('.btn-sanfona').first().click();
  await pagina.waitForTimeout(2000);

  const primeira = (await pagina.locator('.linha-detalhe').first().innerText()).replace(/\s+/g, ' ');
  conferir('uma linha completa e outra não é o estado que precisa ser destravado',
    /MUNICIPIO DE ERECHIM/.test(primeira) && !/MUNICIPIO DE GRAMADO/.test(primeira), primeira);

  // Fecha, libera o segundo documento e reabre: o guardado tem uma linha cheia
  // e uma vazia — exatamente o caso em que a versão antiga desistia.
  await pagina.evaluate(() => { globalThis.__SEGUNDA_RODADA = true; });
  await pagina.locator('.btn-sanfona').first().click();
  await pagina.waitForTimeout(300);
  await pagina.locator('.btn-sanfona').first().click();
  await pagina.waitForTimeout(2500);

  const segunda = (await pagina.locator('.linha-detalhe').first().innerText()).replace(/\s+/g, ' ');
  conferir('reabrir completa a linha que faltava, sem refazer a que já estava',
    /MUNICIPIO DE ERECHIM/.test(segunda) && /MUNICIPIO DE GRAMADO/.test(segunda), segunda);
  await pagina.close();
}

// Guardado não é o mesmo que completo: linhas salvas sem quem recebeu e sem
// valor faziam a versão que sabe buscar esse nível nunca rodar.
{
  const pagina = await abrir({
    consultaAutomatica: true,
    funcoes: {
      consultarFonte: {
        __fn: `var c = dados.caminho || '';
        if (c === '/emendas/documentos/202612340000') {
          if (Number((dados.parametros || {}).pagina || 1) > 1) return { dados: [] };
          return { dados: [{ id: 1, data: '08/04/2026', fase: 'Empenho',
            codigoDocumento: '257001000012026NE808376',
            codigoDocumentoResumido: '2026NE808376' }] };
        }
        if (c === '/despesas/documentos/257001000012026NE808376') {
          return { dados: { documento: '257001000012026NE808376', data: '08/04/2026',
            fase: 'Empenho', observacao: 'AQUISICAO DE EQUIPAMENTOS',
            nomeFavorecido: 'MUNICIPIO DE ERECHIM', valor: '1.000,00' } };
        }
        return { dados: [] };`,
      },
    },
  });

  await pagina.goto(`${BASE}/#/orcamento/emendas`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.tabela');
  // Primeira abertura guarda; a segunda leria do guardado.
  await pagina.locator('.btn-sanfona').first().click();
  await pagina.waitForTimeout(2000);
  await pagina.locator('.btn-sanfona').first().click();
  await pagina.waitForTimeout(300);
  await pagina.locator('.btn-sanfona').first().click();
  await pagina.waitForTimeout(1200);

  const dentro = (await pagina.locator('.linha-detalhe').first().innerText()).replace(/\s+/g, ' ');
  conferir('reabrir mostra o que foi guardado, agora completo',
    /MUNICIPIO DE ERECHIM/.test(dentro) && /AQUISICAO DE EQUIPAMENTOS/.test(dentro), dentro);
  await pagina.close();
}

// "R$ 0,00" ao pé de uma emenda de sete milhões lê-se como "nada foi pago" —
// o oposto do que os dados dizem. Sem valor informado, não se afirma total.
{
  const pagina = await abrir({
    consultaAutomatica: true,
    funcoes: {
      consultarFonte: {
        __fn: `var c = dados.caminho || '';
        if (c === '/emendas/documentos/202612340000') {
          if (Number((dados.parametros || {}).pagina || 1) > 1) return { dados: [] };
          return { dados: [
            { id: 1, data: '23/04/2026', fase: 'Empenho', codigoDocumentoResumido: '2026NE000001',
              especieTipo: { descricao: 'Não se aplica' } },
            { id: 2, data: '02/07/2026', fase: 'Pagamento', codigoDocumentoResumido: '2026OB000002',
              especieTipo: { descricao: 'Original' } },
          ] };
        }
        return { dados: [] };`,
      },
    },
  });

  await pagina.goto(`${BASE}/#/orcamento/emendas`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.tabela');
  await pagina.locator('.btn-sanfona').first().click();
  await pagina.waitForTimeout(1800);

  const dentro = (await pagina.locator('.linha-detalhe').first().innerText()).replace(/\s+/g, ' ');
  conferir('sem valor informado, o rodapé não afirma total zero',
    /valores não informados/.test(dentro) && !/R\$ 0,00/.test(dentro), dentro);
  conferir('a espécie do documento não ocupa a coluna de objeto',
    !/Não se aplica/.test(dentro), dentro);
  // Os documentos sem destino resolvido não desaparecem nem viram trinta linhas
  // em branco: viram uma, que diz quantos são. É ela que prova que a execução
  // existe e que permite tentar de novo.
  conferir('documento sem destino resolvido vira uma linha que diz quantos são',
    /2 documento\(s\) de execução, destino a resolver/.test(dentro), dentro);
  conferir('e a tela explica que falta um nível, em vez de parecer quebrada',
    /n[íi]vel abaixo/.test(dentro), dentro);
  await pagina.close();
}

// Zero linhas não prova que a emenda não é especial: prova que ninguém apareceu
// naquela consulta. O código de autor não é o mesmo em toda base, então antes de
// afirmar que não existe é preciso ter perguntado também pelo nome.
{
  const pagina = await abrir({
    consultaAutomatica: true,
    funcoes: { consultarFonte: { __fn: 'return { dados: [] };' } },
  });

  await pagina.goto(`${BASE}/#/orcamento/emendas`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.tabela');
  await pagina.locator('.btn-sanfona').first().click();
  await pagina.waitForTimeout(900);

  const recado = (await pagina.locator('.sanfona-recado').first().innerText().catch(() => ''))
    .replace(/\s+/g, ' ');
  conferir('sem resultado, o recado conta o que foi perguntado antes de concluir',
    /Procurei por código 1234/.test(recado)
    && /nome "Deputada Teste"/.test(recado)
    && /nome "DEPUTADA TESTE"/.test(recado), recado);
  conferir('e não afirma que a emenda não é transferência especial',
    !/não é transferência especial/.test(recado), recado);
  await pagina.close();
}

// Sem a ponte, a sanfona precisa dizer o que fazer em vez de girar para sempre.
{
  const pagina = await abrir({ consultaAutomatica: false });
  await pagina.goto(`${BASE}/#/orcamento/emendas`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.tabela');
  await pagina.locator('.btn-sanfona').first().click();
  await pagina.waitForTimeout(600);
  const recado = await pagina.locator('.sanfona-recado').first().innerText().catch(() => '');
  conferir('sem consulta automática, a sanfona explica em vez de carregar sem fim',
    /consulta autom/i.test(recado), recado.replace(/\s+/g, ' '));
  await pagina.close();
}

// A emenda discriminada, pela ponte: quem recebeu cada parte do dinheiro.
{
  const pagina = await abrir({
    consultaAutomatica: true,
    funcoes: {
      consultarFonte: {
        // A varredura filtra pelo nome do parlamentar, como a base o guarda.
        // O duble só responde a esse filtro: é ele que o botão precisa mandar.
        __fn: `var par = dados.parametros || {};
        if (dados.caminho !== '/transferenciasespeciais/plano_acao_especial') return { dados: [] };
        if (!/Deputada Teste/i.test(String(par.nome_parlamentar_emenda_plano_acao || ''))) return { dados: [] };
        if (Number(par.offset || 0) > 0) return { dados: [] };
        return { dados: [
          { id_plano_acao: 11, ano_emenda_parlamentar_plano_acao: 2026,
            codigo_parlamentar_emenda_plano_acao: 1234,
            sequencial_emenda_parlamentar_plano_acao: 0,
            nome_beneficiario_plano_acao: 'MUNICIPIO DE ERECHIM',
            cnpj_beneficiario_plano_acao: '87.612.917/0001-00',
            uf_beneficiario_plano_acao: 'RS',
            descricao_programacao_orcamentaria_plano_acao: 'Custeio da atencao basica',
            situacao_plano_acao: 'Em execução',
            valor_custeio_plano_acao: '300000' },
          { id_plano_acao: 12, ano_emenda_parlamentar_plano_acao: 2026,
            codigo_parlamentar_emenda_plano_acao: 1234,
            sequencial_emenda_parlamentar_plano_acao: 0,
            nome_beneficiario_plano_acao: 'MUNICIPIO DE GRAMADO',
            uf_beneficiario_plano_acao: 'RS',
            situacao_plano_acao: 'Impedimento técnico',
            motivo_impedimento_plano_acao: 'Dado bancário inválido',
            valor_investimento_plano_acao: '100000' },
        ] };`,
      },
    },
  });

  await pagina.goto(`${BASE}/#/orcamento/transferencias`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.modulo-topo');
  conferir('a aba de transferências existe e oferece o detalhamento',
    (await pagina.getByRole('button', { name: 'Detalhar emendas' }).count()) === 1);

  await pagina.getByRole('button', { name: 'Detalhar emendas' }).click();
  await pagina.waitForTimeout(1200);

  const recado = await pagina.locator('.aviso').last().innerText().catch(() => '');
  conferir('o detalhamento guarda os destinos',
    /2 destinos guardados/.test(recado), recado.replace(/\s+/g, ' '));

  const tabela = (await pagina.locator('.tabela tbody').innerText()).replace(/\s+/g, ' ');
  conferir('a linha mostra quem recebeu e o valor',
    tabela.includes('MUNICIPIO DE ERECHIM') && /300\.000/.test(tabela), tabela);
  conferir('o motivo do impedimento chega até a tela',
    /Dado banc/i.test(tabela), tabela);
  conferir('as transferências agrupam por município',
    (await pagina.locator('.grupo-nome').first().innerText()).includes('ERECHIM'),
    await pagina.locator('.grupo-nome').first().innerText());

  // Rodar de novo não pode duplicar: a chave é a emenda mais o documento.
  const antes = await pagina.locator('.tabela tbody tr').count();
  await pagina.getByRole('button', { name: 'Detalhar emendas' }).click();
  await pagina.waitForTimeout(1200);
  conferir('detalhar de novo atualiza em vez de duplicar',
    (await pagina.locator('.tabela tbody tr').count()) === antes,
    `${antes} linhas`);

  await pagina.close();
}

// A cadeia inteira: plano de ação → executor → meta → empenho, mais o fundo a
// fundo. É o que responde "para onde foi e para quê" — a pergunta que sobrava
// depois de saber só quem recebeu.
{
  const pagina = await abrir({
    consultaAutomatica: true,
    funcoes: {
      consultarFonte: {
        __fn: `var c = dados.caminho || '';
        var par = dados.parametros || {};
        if (c === '/transferenciasespeciais/plano_acao_especial') {
          if (Number(par.offset || 0) > 0) return { dados: [] };
          if (!/Deputada Teste/i.test(String(par.nome_parlamentar_emenda_plano_acao || ''))) return { dados: [] };
          return { dados: [{ id_plano_acao: 11, ano_emenda_parlamentar_plano_acao: 2026,
            codigo_parlamentar_emenda_plano_acao: 1234,
            sequencial_emenda_parlamentar_plano_acao: 0,
            nome_beneficiario_plano_acao: 'MUNICIPIO DE ERECHIM',
            uf_beneficiario_plano_acao: 'RS', situacao_plano_acao: 'CIENTE',
            valor_investimento_plano_acao: '500000' }] };
        }
        if (c === '/transferenciasespeciais/executor_especial') {
          // Comparação literal, sem regex: dentro de um template literal a
          // barra invertida some antes de virar expressão regular.
          if (String(par.id_plano_acao || '') !== 'in.(11)') return { dados: [] };
          return { dados: [
            { id_plano_acao: 11, id_executor: 101, nome_executor: 'SECRETARIA DE SAUDE',
              cnpj_executor: '11.111.111/0001-11', objeto_executor: 'Aquisição de ambulância',
              vl_investimento_executor: '300000' },
            { id_plano_acao: 11, id_executor: 102, nome_executor: 'SECRETARIA DE OBRAS',
              objeto_executor: 'Pavimentação da Rua das Flores',
              vl_custeio_executor: '200000' },
          ] };
        }
        if (c === '/transferenciasespeciais/meta_especial') {
          return { dados: [
            { id_executor: 101, id_meta: 1, nome_meta: 'Ambulância tipo A',
              un_medida_meta: 'unidade', qt_uniade_meta: '1' },
            { id_executor: 102, id_meta: 2, nome_meta: 'Via pavimentada',
              un_medida_meta: 'm2', qt_uniade_meta: '1200' },
          ] };
        }
        if (c === '/transferenciasespeciais/finalidade_especial') {
          return { dados: [{ id_executor: 101, area_politica_publica_pt: 'Saúde' }] };
        }
        if (c === '/transferenciasespeciais/empenho_especial') {
          return { dados: [{ id_plano_acao: 11, numero_empenho: '2026NE000777',
            data_emissao_empenho: '15/03/2026', valor_empenho: '500000' }] };
        }
        if (c === '/fundoafundo/programa_beneficiario') {
          // Pelo nome não acha: é o caso que obriga a procurar pelo número da
          // emenda, que é exato.
          if (par.nome_parlamentar_beneficiario_programa) return { dados: [] };
          return { dados: [{ id_beneficiario_programa: 900, id_programa: 77,
            numero_emenda_beneficiario_programa: '202612340000',
            nome_beneficiario_programa: 'FUNDO MUNICIPAL DE SAUDE DE GRAMADO',
            uf_beneficiario_programa: 'RS', valor_beneficiario_programa: '150000' }] };
        }
        if (c === '/fundoafundo/plano_acao') {
          return { dados: [{ id_programa: 77,
            objetivos_plano_acao: 'Custeio da atenção primária' }] };
        }
        return { dados: [] };`,
      },
    },
  });

  await pagina.goto(`${BASE}/#/orcamento/transferencias`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.modulo-topo');
  await pagina.getByRole('button', { name: 'Detalhar emendas' }).click();
  await pagina.waitForTimeout(2500);

  const recado = (await pagina.locator('.aviso').last().innerText().catch(() => ''))
    .replace(/\s+/g, ' ');
  conferir('a varredura conta o que trouxe de cada nível',
    /3 destinos guardados/.test(recado) && /2 executores/.test(recado)
    && /2 metas/.test(recado) && /1 empenhos/.test(recado)
    && /1 fundo a fundo/.test(recado), recado);

  const tabela = (await pagina.locator('.tabela tbody').innerText()).replace(/\s+/g, ' ');
  // O grão fino é o executor: um plano repartido entre dois vira dois destinos,
  // cada um com seu objeto. Somado de volta ao plano, o "para quê" sumiria.
  conferir('cada executor vira um destino, com objeto próprio',
    /Aquisição de ambulância/.test(tabela) && /Pavimentação da Rua das Flores/.test(tabela),
    tabela.slice(0, 300));
  conferir('as metas físicas chegam à tela, com quantidade e unidade',
    /Ambulância tipo A \(1 unidade\)/.test(tabela) && /Via pavimentada \(1200 m2\)/.test(tabela),
    tabela.slice(0, 400));
  // O nome do parlamentar não bate nessa base; o número da emenda é exato.
  conferir('o fundo a fundo entra pelo número da emenda quando o nome não acha',
    /FUNDO MUNICIPAL DE SAUDE DE GRAMADO/.test(tabela)
    && /Custeio da atenção primária/.test(tabela), tabela.slice(0, 600));

  await pagina.close();
}

// Zero registros é a resposta mais ambígua da consulta: pode ser ausência real,
// nome errado ou filtro não aceito. Precisa virar pergunta respondida.
{
  const pagina = await abrir({
    consultaAutomatica: true,
    funcoes: {
      // Só responde ao nome na forma em que a base o guarda — caixa alta e sem
      // acento —, que é exatamente o que o Portal real faz.
      consultarFonte: {
        __fn: `return dados.parametros && dados.parametros.nomeAutor
          ? { dados: [] }
          : { dados: [
            { codigoEmenda: '1', nomeAutor: 'MARCEL VAN HATTEM', valorEmpenhado: '1,00' },
            { codigoEmenda: '2', nomeAutor: 'OUTRO DEPUTADO', valorEmpenhado: '2,00' },
          ] };`,
      },
    },
  });
  await pagina.goto(`${BASE}/#/orcamento/emendas`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.modulo-topo');
  await pagina.getByRole('button', { name: 'Consultar Portal' }).click();
  await pagina.waitForTimeout(900);
  const d = await pagina.locator('.aviso--erro').first().innerText().catch(() => '');
  conferir('resultado vazio vira diagnóstico com o nome enviado e os da base',
    // Mostra o nome como foi enviado — normalizado —, não como está cadastrado:
    // é esse que a base recusou.
    /Nada encontrado para "DEPUTADA TESTE"/.test(d)
    && /MARCEL VAN HATTEM/.test(d)
    && /codigoEmenda/.test(d), d.replace(/\s+/g, ' '));
  await pagina.close();
}

// A ponte desligada não pode oferecer um botão que só sabe se lamentar.
{
  const pagina = await abrir({ consultaAutomatica: false });
  await pagina.goto(`${BASE}/#/orcamento/emendas`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.modulo-topo');
  conferir('sem a ponte, o botão de consulta não aparece',
    (await pagina.getByRole('button', { name: 'Consultar Portal' }).count()) === 0);
  conferir('mas a importação por planilha continua disponível',
    (await pagina.getByRole('button', { name: /Importar planilha/ }).count()) === 1);
  await pagina.close();
}

// Falha da ponte precisa dizer o que fazer, não repetir um código.
{
  const pagina = await abrir({
    consultaAutomatica: true,
    ignorarConsole: true,
    funcoes: { consultarFonte: { __erro: 'functions/failed-precondition' } },
  });
  await pagina.goto(`${BASE}/#/orcamento/emendas`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.modulo-topo');
  await pagina.getByRole('button', { name: 'Consultar Portal' }).click();
  await pagina.waitForTimeout(700);
  const erro = await pagina.locator('.aviso--erro').first().innerText().catch(() => '');
  conferir('chave ausente vira instrução, não código de erro',
    /chave do Portal/i.test(erro) && /README/.test(erro), erro.replace(/\s+/g, ' '));
  await pagina.close();
}

// Função não implantada chega como "internal", que não diz nada sozinho.
{
  const pagina = await abrir({
    consultaAutomatica: true,
    ignorarConsole: true,
    funcoes: { consultarFonte: { __erro: 'functions/internal' } },
  });
  await pagina.goto(`${BASE}/#/orcamento/emendas`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.modulo-topo');
  await pagina.getByRole('button', { name: 'Consultar Portal' }).click();
  await pagina.waitForTimeout(700);
  const erroInterno = await pagina.locator('.aviso--erro').first().innerText().catch(() => '');
  conferir('"internal" vira a explicação provável, não o código cru',
    /implantad/i.test(erroInterno) && /functions:log/.test(erroInterno),
    erroInterno.replace(/\s+/g, ' '));
  await pagina.close();
}

// ────────── suíte 7: leitura política do voto (sem navegador) ──────────
//
// É a parte mais fácil de errar do sistema inteiro: "Sim" numa retirada de
// pauta é voto CONTRA a matéria. Um histórico que registre só Sim e Não
// descreve o mandato ao contrário na maioria das votações processuais.

console.log('\nLeitura política do voto\n');

{
  const t = await import('../js/temas.js');

  // O erro de origem: os temas foram gravados num texto só, e os nomes oficiais
  // têm vírgula dentro. Repartir por pontuação inventaria temas que não existem.
  conferir('reparte o texto antigo pelo vocabulário oficial',
    JSON.stringify(t.separarTemas('Administração Pública, Economia, Finanças Públicas e Orçamento'))
      === JSON.stringify(['Administração Pública', 'Economia', 'Finanças Públicas e Orçamento']),
    JSON.stringify(t.separarTemas('Administração Pública, Economia, Finanças Públicas e Orçamento')));
  conferir('nome com vírgula continua sendo um tema só',
    JSON.stringify(t.separarTemas('Ciência, Tecnologia e Inovação')) === JSON.stringify(['Ciência, Tecnologia e Inovação']),
    JSON.stringify(t.separarTemas('Ciência, Tecnologia e Inovação')));
  conferir('o nome mais longo vence o mais curto que o prefixa',
    t.separarTemas('Direito Penal e Processual Penal')[0] === 'Direito Penal e Processual Penal');
  conferir('tema fora do vocabulário é preservado, não descartado',
    t.separarTemas('Tema Novo Da Câmara, Saúde').length === 2);
  conferir('a forma curta encurta o que era longo',
    t.temaCurto('Finanças Públicas e Orçamento') === 'Orçamento'
    && t.temaCurto('Viação, Transporte e Mobilidade') === 'Transporte');
  conferir('agrupa por um tema só, o principal',
    t.temaPrincipal('Administração Pública, Saúde') === 'Administração pública');
  conferir('registro sem tema não vira grupo fantasma',
    t.temaPrincipal(null) === null && t.temasCurtos([]).length === 0);

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

// ───────────── suíte 8: as regras cobrem todas as coleções da tela ─────────────
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

// Regra certa publicada no banco errado é indistinguível de regra errada, e
// custou muitas rodadas: o sistema usa um banco nomeado, e o deploy sem
// `database` no firebase.json vai calado para o `(default)`, que ninguém lê.
const config = fs.readFileSync(path.join(RAIZ, 'js', 'config.js'), 'utf8');
const bancoDoApp = /FIRESTORE_DATABASE_ID\s*=\s*'([^']+)'/.exec(config)?.[1];
const firebaseJson = JSON.parse(fs.readFileSync(path.join(RAIZ, 'firebase.json'), 'utf8'));
const alvos = [].concat(firebaseJson.firestore || []).map((f) => f.database);
conferir('o deploy das regras aponta para o banco que o sistema usa',
  !!bancoDoApp && alvos.includes(bancoDoApp),
  `app usa "${bancoDoApp}", firebase.json publica em ${alvos.map((a) => `"${a}"`).join(', ') || '(nenhum banco declarado)'}`);

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
