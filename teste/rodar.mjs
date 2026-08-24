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

/**
 * O que a base da Câmara responde em /despesas neste caso de teste.
 *
 * Fica aqui, e não numa rota registrada depois, porque rota nova não vence a
 * rota ampla do duble — e um duble que não responde faz o teste acusar a
 * importação quando o problema é a ordem das rotas.
 */
let despesasDoTeste = null;
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

    // A cota entra por aqui, e não por uma rota própria: rota registrada depois
    // não vence esta, e um duble que não responde faz o teste acusar a
    // importação quando o problema é a ordem das rotas.
    if (/\/despesas/.test(url)) {
      dados = despesasDoTeste ? despesasDoTeste(url) : [];
      return rota.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ dados }),
      });
    }

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
    ['orcamento', 'Por município'],
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

// ────────── suíte 6: a planilha do painel, única porta de entrada ──────────
//
// As consultas automáticas saíram: escritas contra bases que este projeto nunca
// conseguiu exercitar de verdade, produziam telas que pareciam funcionar e não
// funcionavam. Sobrou uma fonte, e é esta — a exportação do painel, que chega
// pronta e conferível.

console.log('\nPlanilha do painel\n');

{
  const pagina = await abrir();
  await pagina.goto(`${BASE}/#/orcamento/painel-emendas`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.modulo-topo', { timeout: 15000 });

  // Um botão, e só ele: nenhuma consulta automática sobrou para escolher errado.
  conferir('a tela do orçamento oferece a importação da planilha',
    (await pagina.getByRole('button', { name: /Importar planilha do painel/ }).count()) === 1);
  for (const sumido of ['Consultar Portal', 'Detalhar emendas', 'Sondar fontes', 'Reorganizar', 'Painel do SERPRO']) {
    conferir(`"${sumido}" não existe mais na tela`,
      (await pagina.getByRole('button', { name: sumido }).count()) === 0);
  }

  await pagina.setInputFiles('.modulo-acoes input[type=file]', path.join(RAIZ, 'teste', 'amostras', 'painel-emendas.xlsx'));
  await pagina.waitForTimeout(2500);

  const recado = (await pagina.locator('.aviso').first().innerText().catch(() => '')).replace(/\s+/g, ' ');
  conferir('a planilha do painel entra e o aviso conta o que ela trouxe',
    /196 destinos e 25 emendas/.test(recado) && /117 municípios/.test(recado), recado);
  // Duas linhas eram o mesmo convênio custeado por duas emendas.
  conferir('e avisa que reuniu a linha repetida em vez de somá-la',
    /mesmo convênio custeado por duas emendas/.test(recado), recado);

  await pagina.waitForTimeout(600);
  const tabela = (await pagina.locator('.tabela--municipios').innerText()).replace(/\s+/g, ' ');
  conferir('os municípios da planilha aparecem na tela na hora',
    /MUÇUM/.test(tabela) && /CAMPINA DAS MISSÕES/.test(tabela), tabela.slice(0, 200));
  // O motivo de tudo: ninguém destina emenda ao Banco do Brasil.
  conferir('e nenhum banco aparece como município',
    !/BANCO DO BRASIL|CAIXA ECON/i.test(tabela), tabela.slice(0, 400));

  await pagina.close();
}


// ── bilhete de passagem lido por imagem ──
//
// O que substitui: alguém redigita origem, destino, data, hora, voo e localizador
// em dois lugares. É transcrição, erra em número de voo, e o erro só aparece no
// aeroporto.
{
  const p = await import('../js/passagens.js');

  const trecho = {
    passageiro: 'MARCEL VAN HATTEM', companhia: 'GOL', voo: 'G3 1234',
    origem: 'Porto Alegre', origemSigla: 'POA', destino: 'Brasília', destinoSigla: 'BSB',
    data: '2026-09-02', horaPartida: '6:20', horaChegada: '8:15',
    localizador: 'ABC123', assento: '12A', valor: 1234.5,
  };
  const v = p.viagemDoTrecho(trecho);
  conferir('o trecho lido vira viagem com voo, localizador e horários',
    v.voo === 'G3 1234' && v.localizador === 'ABC123' && v.ida === '2026-09-02'
    && v.horaPartida === '6:20' && v.custo === 1234.5, JSON.stringify(v));
  conferir('origem e destino guardam cidade e sigla, que é como o bilhete traz',
    v.origem === 'Porto Alegre · POA' && v.destino === 'Brasília · BSB');

  // Campo ilegível fica nulo, e não com um palpite: a tela pinta o vazio, e vazio
  // pede atenção enquanto palpite passa por conferido.
  const incerto = p.viagemDoTrecho({ ...trecho, data: '02/09', horaPartida: 'manhã', valor: 0 });
  conferir('data e hora que não vêm no formato esperado ficam vazias, não adivinhadas',
    incerto.ida === null && incerto.horaPartida === null && incerto.custo === null,
    JSON.stringify({ ida: incerto.ida, hora: incerto.horaPartida, custo: incerto.custo }));

  // A captura circula no grupo do gabinete: reenviar não pode criar outra linha.
  conferir('voo mais data são a chave: o mesmo bilhete reenviado não duplica',
    p.chaveDaViagem(v) === 'v-g3-1234-2026-09-02'
    && p.chaveDaViagem({ localizador: 'XYZ9', ida: '2026-09-02' }) === 'l-xyz9-2026-09-02'
    && p.chaveDaViagem({ ida: null, voo: 'G3 1' }) === null);

  const compromisso = p.compromissoDaViagem(v);
  conferir('o voo vira compromisso de agenda com hora e localizador',
    compromisso.inicio === '2026-09-02T06:20' && compromisso.fim === '2026-09-02T08:15'
    && /ABC123/.test(compromisso.observacoes), JSON.stringify(compromisso));
  // Sem hora, bloquear o dia inteiro é o pior caso e o correto: prometer manhã
  // livre com base num horário ilegível é o erro que aparece no aeroporto.
  conferir('sem hora legível, o compromisso bloqueia o dia e avisa por quê',
    p.compromissoDaViagem({ ...v, horaPartida: null }).inicio === '2026-09-02T00:00'
    && /não legível/.test(p.compromissoDaViagem({ ...v, horaPartida: null }).observacoes));
  conferir('trecho sem data não vira compromisso: agenda com data errada é pior que sem',
    p.compromissoDaViagem({ ...v, ida: null }) === null);

  const repartido = p.repartirNoTempo(
    [{ ida: '2026-12-01' }, { ida: '2026-01-01' }, { ida: '2026-08-17' }, { voo: 'X' }],
    '2026-08-17',
  );
  conferir('a lista se reparte em futuras, hoje, passadas e sem data',
    repartido.futuras.length === 1 && repartido.hoje.length === 1
    && repartido.passadas.length === 1 && repartido.semData.length === 1,
    JSON.stringify(Object.fromEntries(Object.entries(repartido).map(([k, x]) => [k, x.length]))));
}

// A confirmação na tela: nada é gravado sem alguém conferir.
{
  const pagina = await abrir({
    consultaAutomatica: true,
    funcoes: {
      lerPassagem: {
        trechos: [{
          passageiro: 'DEPUTADA TESTE', companhia: 'GOL', voo: 'G3 1234',
          origem: 'Porto Alegre', origemSigla: 'POA', destino: 'Brasília', destinoSigla: 'BSB',
          data: '2026-12-02', horaPartida: '06:20', horaChegada: '08:15',
          localizador: 'ABC123', assento: null, valor: 1200,
        }],
        ilegivel: ['assento'],
        provedor: 'openai',
        modelo: 'gpt-4o',
      },
    },
  });

  await pagina.goto(`${BASE}/#/administrativo/viagens`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.modulo-topo');
  conferir('a aba de viagens oferece a leitura do bilhete',
    (await pagina.getByRole('button', { name: 'Ler bilhete' }).count()) === 1);

  // Um PNG de 1x1: o que importa aqui é o caminho, não a imagem.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAIAAABwJOjsAAAAIklEQVR4nGM4MUCAYdTiUYtHLR61eNTiUYtHLR61eORYDABe1FNqhH8OKAAAAABJRU5ErkJggg==',
    'base64',
  );
  await pagina.setInputFiles('.importador input[type=file]', {
    name: 'bilhete.png', mimeType: 'image/png', buffer: png,
  });
  await pagina.waitForSelector('.bilhete-trecho', { timeout: 15000 });

  // O passo a mais é deliberado: o ganho está em não redigitar, não em confiar
  // cegamente numa leitura de imagem.
  conferir('a leitura não grava: abre a confirmação com os campos preenchidos',
    (await pagina.locator('#bilhete-0-voo').inputValue()) === 'G3 1234'
    && (await pagina.locator('#bilhete-0-ida').inputValue()) === '2026-12-02',
    await pagina.locator('#bilhete-0-voo').inputValue());
  conferir('e o campo que a imagem não permitiu ler vem marcado',
    (await pagina.locator('#bilhete-0-assento').getAttribute('class') || '').includes('bilhete-falta'),
    await pagina.locator('#bilhete-0-assento').getAttribute('class'));
  conferir('a tela diz o que ficou ilegível, em vez de deixar descobrir depois',
    /assento/.test(await pagina.locator('.campo-dica').first().innerText()));

  await pagina.getByRole('button', { name: 'Salvar viagens' }).click();
  await pagina.waitForTimeout(1200);

  const recado = (await pagina.locator('.aviso').last().innerText().catch(() => '')).replace(/\s+/g, ' ');
  conferir('confirmar grava a viagem e o compromisso na agenda',
    /1 trecho\(s\) salvos/.test(recado) && /1 na agenda/.test(recado), recado);

  const tabela = (await pagina.locator('.tabela tbody').innerText()).replace(/\s+/g, ' ');
  conferir('a viagem aparece na lista, classificada no tempo',
    /G3 1234/.test(tabela) && /Ainda vai acontecer/.test(tabela), tabela.slice(0, 250));

  await pagina.goto(`${BASE}/#/chefia/agenda`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.tabela');
  const agenda = (await pagina.locator('.tabela tbody').innerText()).replace(/\s+/g, ' ');
  conferir('e o voo está na agenda do deputado, com o trecho no título',
    /G3 1234/.test(agenda) && /POA/.test(agenda), agenda.slice(0, 250));

  await pagina.close();
}

// ── CRM: padronização na entrada ──
//
// As listas do gabinete vêm da campanha, do WhatsApp, de lista de presença. Cada
// uma escreve telefone de um jeito. Importar sem padronizar transfere a bagunça
// para dentro do sistema, onde ela fica pior: dois contatos para a mesma pessoa,
// e buscar "Erechim" não acha "ERECHIM/RS".
{
  const crm = await import('../js/crm.js');

  // A forma guardada tem de ser a comparável, senão a mesma pessoa entra duas
  // vezes na próxima importação.
  const fones = [
    ['(51) 99999-9999', '51999999999'],
    ['5551999999999', '51999999999'],
    ['+55 51 98888-7777', '51988887777'],
    ['051 3333-4444', '5133334444'],
  ];
  const foraDoPadrao = fones.filter(([bruto, esperado]) => crm.telefonePadrao(bruto) !== esperado);
  conferir('telefones em quatro grafias viram a mesma forma comparável',
    foraDoPadrao.length === 0,
    foraDoPadrao.map(([b]) => `${b} → ${crm.telefonePadrao(b)}`).join(' | '));
  conferir('e a exibição volta a ser legível para quem liga',
    crm.telefoneVisivel('51999999999') === '(51) 99999-9999'
    && crm.telefoneVisivel('5133334444') === '(51) 3333-4444');
  // 0800 não tem DDD: formatado como celular virava "(08) 00123-4567".
  conferir('0800 não é tratado como celular com DDD',
    crm.telefoneVisivel(crm.telefonePadrao('0800 123 4567')) === '0800 123 4567',
    crm.telefoneVisivel(crm.telefonePadrao('0800 123 4567')));

  conferir('nome em caixa alta vira caixa de título, com as partículas minúsculas',
    crm.nomePadrao('MARIA DAS DORES DE SOUZA') === 'Maria das Dores de Souza');
  conferir('nome já digitado por gente não é mexido',
    crm.nomePadrao('Ana Paula Ribeiro') === 'Ana Paula Ribeiro');
  conferir('sigla continua sigla',
    crm.nomePadrao('APAE DE ERECHIM') === 'APAE de Erechim'
    && crm.nomePadrao('CTG PORTEIRA VELHA') === 'CTG Porteira Velha');

  const locais = [
    ['ERECHIM/RS', 'Erechim', 'RS'],
    ['Erechim - RS', 'Erechim', 'RS'],
    ['Erechim (RS)', 'Erechim', 'RS'],
    ['Porto Alegre, RS', 'Porto Alegre', 'RS'],
    ['Erechim RS', 'Erechim', 'RS'],
    // A regra que recortava duas letras de onde estivessem inventava um município
    // e um estado: "Santa Maria do Herv" em "AL". Município inventado ainda
    // estragaria o agrupamento por cidade no painel e na ficha.
    ['SANTA MARIA DO HERVAL', 'Santa Maria do Herval', null],
    ['Rio Grande', 'Rio Grande', null],
  ];
  const errados = locais.filter(([bruto, cidade, uf]) => {
    const r = crm.localPadrao(bruto);
    return r.municipio !== cidade || (r.uf || null) !== uf;
  });
  conferir('município e UF se separam, e nome de cidade não é recortado ao meio',
    errados.length === 0,
    errados.map(([b]) => `${b} → ${JSON.stringify(crm.localPadrao(b))}`).join(' | '));

  // Sem dedução, tudo entraria como "cidadão" e a categoria não distinguiria
  // nada — o mesmo defeito dos filtros de orçamento.
  const cats = [
    ['Prefeito de Erechim', 'prefeitura'],
    ['Vereador', 'vereador'],
    ['Presidente da APAE', 'entidade'],
    ['Empresário', 'empresa'],
    ['Delegado de Polícia', 'orgao'],
    ['Agricultor', 'cidadao'],
  ];
  const catsErradas = cats.filter(([t, esperado]) => crm.categoriaDe(t) !== esperado);
  conferir('a categoria é deduzida do cargo, em vez de tudo cair em cidadão',
    catsErradas.length === 0,
    catsErradas.map(([t]) => `${t} → ${crm.categoriaDe(t)}`).join(' | '));

  // O telefone identifica melhor que o nome: homônimo é comum e a mesma pessoa
  // aparece como "José Silva" e "Jose da Silva".
  conferir('o telefone é a chave; sem ele, o e-mail; sem os dois, nome e cidade',
    crm.chaveDoContato({ telefone: '51999999999', nome: 'X' }) === 't-51999999999'
    && crm.chaveDoContato({ email: 'a@b.com' }) === 'e-a-b-com'
    && crm.chaveDoContato({ nome: 'José da Silva', municipio: 'Erechim' }) === 'n-jose-da-silva-erechim'
    && crm.chaveDoContato({}) === null);

  conferir('a coluna é reconhecida mesmo com o nome que a lista usar',
    (() => {
      const m = crm.mapearColunasDeContato(['Nome Completo', 'WhatsApp', 'Cidade/UF', 'Cargo', 'E-mail']);
      return m.nome === 0 && m.telefone === 1 && m.municipio === 2 && m.cargo === 3 && m.email === 4;
    })(),
    JSON.stringify(crm.mapearColunasDeContato(['Nome Completo', 'WhatsApp', 'Cidade/UF', 'Cargo', 'E-mail'])));
}

// A importação pela tela, incluindo o caso comum: reimportar a mesma lista.
{
  const pagina = await abrir();
  await pagina.goto(`${BASE}/#/administrativo/contatos`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.modulo-topo');

  const planilha = [
    'Nome Completo;Cargo;WhatsApp;Cidade/UF;E-mail;Temas',
    'JOAO DA SILVA;Prefeito;(51) 99999-9999;ERECHIM/RS;JOAO@Exemplo.COM;saúde, estradas',
    'MARIA DAS DORES;Vereadora;5551988887777;Santa Maria do Herval;;educação',
    'APAE DE ERECHIM;Presidente;;Erechim - RS;apae@x.org;',
  ].join('\n');

  await pagina.setInputFiles('.importador input[type=file]', {
    name: 'lista.csv', mimeType: 'text/csv', buffer: Buffer.from(planilha, 'utf8'),
  });
  await pagina.waitForTimeout(1200);

  const recado = (await pagina.locator('.aviso').last().innerText().catch(() => '')).replace(/\s+/g, ' ');
  conferir('a lista entra e o aviso conta o que foi classificado',
    /3 contatos novos/.test(recado) && /classificados/.test(recado), recado);

  const tabela = (await pagina.locator('.tabela tbody').innerText()).replace(/\s+/g, ' ');
  conferir('os nomes chegam legíveis, não em caixa alta',
    /Joao da Silva|João da Silva/.test(tabela) && /APAE de Erechim/.test(tabela), tabela.slice(0, 300));
  conferir('e o município separado da UF, para agrupar de verdade',
    /Erechim/.test(tabela) && /Santa Maria do Herval/.test(tabela), tabela.slice(0, 400));

  // Reimportar a mesma lista é o caso comum — a pessoa exporta de novo depois de
  // atualizar dois telefones. Uma importação que só insere viraria três cópias
  // da mesma base em um mês.
  const antes = await pagina.locator('.tabela tbody tr').count();
  await pagina.setInputFiles('.importador input[type=file]', {
    name: 'lista.csv', mimeType: 'text/csv', buffer: Buffer.from(planilha, 'utf8'),
  });
  await pagina.waitForTimeout(1200);
  const depois = (await pagina.locator('.aviso').last().innerText()).replace(/\s+/g, ' ');
  conferir('reimportar atualiza em vez de duplicar',
    (await pagina.locator('.tabela tbody tr').count()) === antes && /3 atualizados/.test(depois),
    `${antes} linhas · ${depois}`);

  await pagina.close();
}

// ── cota parlamentar, conferida contra a base da Câmara ──
//
// A CEAP é publicada lançamento por lançamento. Digitar isso à mão era
// transcrever base pública: erra, atrasa e não acrescenta nada.
{
  const camara = await import('../js/ceap.js');

  // A Câmara nomeia as rubricas por extenso; o sistema filtra por uma lista
  // curta. Treze grafias da mesma rubrica no filtro não filtram nada.
  const rubricas = [
    ['PASSAGENS AÉREAS', 'passagens'],
    ['MANUTENÇÃO DE ESCRITÓRIO DE APOIO À ATIVIDADE PARLAMENTAR', 'escritorio'],
    ['COMBUSTÍVEIS E LUBRIFICANTES.', 'combustivel'],
    ['LOCAÇÃO OU FRETAMENTO DE VEÍCULOS AUTOMOTORES', 'veiculos'],
    ['DIVULGAÇÃO DA ATIVIDADE PARLAMENTAR', 'divulgacao'],
    // Plural: a regra no singular jogava a rubrica inteira no balde "outro".
    ['SERVIÇOS POSTAIS', 'postal'],
    ['CONSULTORIAS, PESQUISAS E TRABALHOS TÉCNICOS', 'consultoria'],
    ['ASSINATURA DE PUBLICAÇÕES', 'material'],
  ];
  const fora = rubricas.filter(([texto, esperado]) => camara.rubricaDe(texto) !== esperado);
  conferir('cada rubrica da Câmara cai na categoria certa do sistema',
    fora.length === 0,
    fora.map(([t]) => `${t} → ${camara.rubricaDe(t)}`).join(' | '));
  conferir('rubrica nova não quebra: cai em "outro" e aparece no filtro',
    camara.rubricaDe('ALGUMA RUBRICA QUE AINDA NÃO EXISTE') === 'outro');

  const gasto = camara.doGastoDaCamara({
    ano: 2025, mes: 3, tipoDespesa: 'PASSAGENS AÉREAS', codDocumento: 7654321,
    tipoDocumento: 'Nota Fiscal', dataDocumento: '2025-03-12T00:00:00', numDocumento: '123',
    valorDocumento: 1500.5, valorLiquido: 1450.5, valorGlosa: 50,
    nomeFornecedor: 'GOL LINHAS AEREAS', cnpjCpfFornecedor: '07575651000159',
    urlDocumento: 'https://camara.leg.br/nota/1',
  });
  // O líquido é o que sai da cota; o valor do documento inclui a glosa, que a
  // Câmara não paga. Usar o bruto inflaria o gasto do gabinete.
  conferir('o lançamento usa o valor líquido, não o do documento',
    gasto.valor === 1450.5 && gasto.valorGlosa === 50, JSON.stringify(gasto));
  conferir('e guarda o link da nota, que é o que fecha a conferência',
    gasto.urlDocumento === 'https://camara.leg.br/nota/1'
    && gasto.fornecedorDoc === '07575651000159');
  conferir('o código do documento é a chave: reimportar não duplica',
    camara.chaveDoGasto({ codDocumento: 7654321 }) === 'cd-7654321');
  conferir('sem código, a combinação que distingue serve de chave',
    camara.chaveDoGasto({
      dataDocumento: '2025-03-12', cnpjCpfFornecedor: '075', numDocumento: '1', valorLiquido: 10,
    }) === 'g-2025-03-12-075-1-1000');
}

// A cota pela tela: buscar na Câmara, e a leitura que ela produz.
{
  const pagina = await abrir();
  despesasDoTeste = (url) => {
    const ano = (/ano=(\d+)/.exec(url) || [])[1];
    const pag = Number((/pagina=(\d+)/.exec(url) || [])[1] || 1);
    if (pag > 1 || ano !== '2026') return [];
    return [
      { ano: 2026, mes: 3, tipoDespesa: 'PASSAGENS AÉREAS', codDocumento: 1,
        dataDocumento: '2026-03-10', numDocumento: 'A1', valorLiquido: 4000,
        nomeFornecedor: 'GOL LINHAS AEREAS', cnpjCpfFornecedor: '075',
        urlDocumento: 'https://camara.leg.br/nota/1' },
      { ano: 2026, mes: 3, tipoDespesa: 'SERVIÇOS POSTAIS', codDocumento: 2,
        dataDocumento: '2026-03-11', numDocumento: 'A2', valorLiquido: 600,
        nomeFornecedor: 'CORREIOS', cnpjCpfFornecedor: '341' },
    ];
  };

  await pagina.goto(`${BASE}/#/administrativo/resumo-cota`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.modulo-topo', { timeout: 15000 });
  await pagina.getByRole('button', { name: 'Buscar na Câmara' }).click();
  await pagina.waitForTimeout(2500);

  const recado = (await pagina.locator('.aviso').last().innerText().catch(() => '')).replace(/\s+/g, ' ');
  conferir('a cota vem da Câmara e o aviso diz quanto veio de cada ano',
    /2 lançamentos novos/.test(recado) && /2026: 2/.test(recado),
    recado);

  const tela = (await pagina.locator('.grade-paineis').innerText()).replace(/\s+/g, ' ');
  conferir('as rubricas aparecem com o nome que a pessoa reconhece',
    /Passagens aéreas/.test(tela) && /Serviços postais/i.test(tela), tela.slice(0, 300));
  conferir('e os fornecedores, para saber para quem o dinheiro foi',
    /GOL LINHAS AEREAS/.test(tela), tela.slice(0, 400));
  // A soma anual esconde o mês em que quase estourou.
  conferir('o gráfico mês a mês tem doze colunas',
    (await pagina.locator('.coluna-mes').count()) === 12);
  // Sem o teto informado não se afirma economia: chamar gasto baixo de economia
  // sem saber o limite seria inventar o número.
  conferir('sem o teto cadastrado, a tela pede o teto em vez de afirmar economia',
    /Informe a cota mensal/.test(await pagina.locator('.campo-dica').first().innerText()),
    await pagina.locator('.campo-dica').first().innerText().catch(() => ''));

  await pagina.close();
}

// ── a exportação do painel: o caminho que realmente funciona ──
//
// O painel tem botão de exportar, e o que ele exporta é a junção que custou
// semanas montar das tabelas cruas: emenda, instrumento, município, proponente,
// objeto, empenhado e desembolsado, numa linha só. O arquivo aqui é o exportado
// pelo gabinete de verdade — 198 linhas do mandato.
{
  const pl = await import('../js/planilha.js');
  const pn = await import('../js/painel.js');
  const bytes = fs.readFileSync(path.join(RAIZ, 'teste', 'amostras', 'painel-emendas.xlsx'));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

  // Isto é o que travava: .xlsx é um ZIP, e o leitor só de texto devolvia "o
  // arquivo está vazio ou não é uma planilha de texto" — verdade que não
  // ajudava, porque o arquivo estava certo.
  const { cabecalho, linhas } = await pl.lerXlsx(buffer);
  conferir('o .xlsx é lido sem biblioteca nenhuma',
    linhas.length === 198 && cabecalho[0] === 'Autor',
    `${linhas.length} linhas, cabeçalho ${cabecalho.slice(0, 3).join('|')}`);
  conferir('e os acentos chegam inteiros',
    linhas.some((l) => l.includes('MUÇUM')) && linhas.some((l) => l.includes('CAMPINA DAS MISSÕES')));
  // "BC12" → 54: sem isso, célula vazia no meio desloca a linha inteira e o
  // valor de uma coluna aparece na outra.
  conferir('a coluna de uma célula é lida da referência dela',
    pl.indiceDaColuna('A1') === 0 && pl.indiceDaColuna('Z9') === 25
    && pl.indiceDaColuna('AA1') === 26 && pl.indiceDaColuna('BC12') === 54);

  conferir('o formato do painel é reconhecido pelo cabeçalho',
    pn.ehDoPainel(cabecalho) === true
    && pn.ehDoPainel(['Autor', 'Valor Empenhado']) === false);

  // O painel escreve "41160007"; o Portal escreve "202341160007". Sem juntar os
  // dois, a mesma emenda entra duas vezes e nenhuma bate com a outra fonte.
  conferir('o número curto do painel vira o código completo, com o ano na frente',
    pn.codigoCompleto('41160007', '2023') === '202341160007'
    && pn.codigoCompleto('202341160007', '2023') === '202341160007'
    && pn.codigoCompleto('', '2023') === null);

  const mapa = pn.mapearColunasDoPainel(cabecalho);
  // "Desembolsado" é como o painel chama o pago. Sem este sinônimo, toda linha
  // entrava com pago zerado e a pergunta "já foi pago?" respondia errado.
  conferir('"Valor Desembolsado" é reconhecido como o valor pago',
    mapa.valorPago === 13 && mapa.valorEmpenhado === 12, JSON.stringify(mapa));

  const lidos = linhas.map((l) => pn.destinoDaLinha(l, mapa)).filter(Boolean);
  conferir('cada linha vira um destino com município, objeto e quem recebeu',
    lidos.length === 198 && lidos[0].municipio === 'CAMPINA DAS MISSÕES'
    && lidos[0].codigoEmenda === '202341160007' && lidos[0].valorPago === 186791.97,
    JSON.stringify(lidos[0]).slice(0, 200));

  // A armadilha do arquivo real: um convênio custeado por duas emendas aparece
  // duas vezes, com os mesmos valores. Somar contaria o mesmo repasse duas
  // vezes — R$ 1.056.193,40 dobrados em Porto Alegre.
  const destinos = pn.reunirPorInstrumento(lidos);
  conferir('linha repetida pelo mesmo convênio é reunida, não somada',
    destinos.length === 196
    && destinos.filter((d) => d.qtdEmendas > 1).length === 2,
    `${destinos.length} instrumentos`);
  const dobrado = destinos.find((d) => d.qtdEmendas > 1);
  conferir('e as duas emendas que custeiam o convênio ficam registradas',
    /202041160002, 202041160011|202041160008, 202041160010/.test(dobrado.emendasDoInstrumento),
    dobrado.emendasDoInstrumento);
  const pagoUmaVez = destinos.reduce((t, d) => t + d.valorPago, 0);
  const pagoDobrado = lidos.reduce((t, d) => t + d.valorPago, 0);
  conferir('o total pago deixa de contar o mesmo real duas vezes',
    Math.round(pagoDobrado - pagoUmaVez) === 1495221,
    `dobrado ${pagoDobrado.toFixed(2)} · uma vez ${pagoUmaVez.toFixed(2)}`);

  conferir('o instrumento é a chave, e ela não colide',
    new Set(destinos.map(pn.chaveDoInstrumento)).size === destinos.length);

  const emendas = pn.emendasDosDestinos(destinos, 'MARCEL VAN HATTEM');
  conferir('as emendas saem consolidadas dos instrumentos',
    emendas.length === 25, `${emendas.length} emendas`);
  // A fonte não diz quanto cada emenda pôs no convênio compartilhado, e
  // repartir seria inventar o número: fica à parte, declarado.
  const comCompartilhado = emendas.filter((e) => e.instrumentosCompartilhados);
  conferir('instrumento compartilhado não entra no total de nenhuma emenda',
    comCompartilhado.length === 4
    && comCompartilhado.every((e) => e.valorCompartilhado > 0),
    JSON.stringify(comCompartilhado.map((e) => [e.codigo, e.valorCompartilhado])));
  // Uma emenda para vinte cidades não tem "um" município: dizer qual seria
  // escolher um por acaso.
  const espalhada = emendas.find((e) => e.qtdMunicipios > 1);
  conferir('emenda espalhada por várias cidades não finge ter uma só',
    espalhada.municipio === null && espalhada.qtdMunicipios > 1,
    `${espalhada.codigo}: ${espalhada.qtdMunicipios} cidades`);

  conferir('o arquivo cobre o mandato inteiro, em municípios distintos',
    new Set(destinos.map((d) => d.municipio)).size === 117);
}

// ── leitura em fluxo: o arquivo do TSE não cabe na memória ──
//
// A votação por município e zona de um estado passa de um milhão de linhas. Lida
// de uma vez, o texto vira uma string do dobro do tamanho do arquivo e a matriz
// de campos vira dezenas de milhões de strings: a aba não trava, morre. Estes
// testes cobrem o leitor que substituiu aquele caminho.
{
  const pl = await import('../js/planilha.js');

  // Um File de mentira: o leitor só usa size e slice().arrayBuffer().
  const arquivoFalso = (texto, { latin1 = false } = {}) => {
    const bytes = latin1
      ? Uint8Array.from([...texto].map((c) => c.charCodeAt(0) & 0xff))
      : new TextEncoder().encode(texto);
    return {
      size: bytes.length,
      slice(a, b) {
        const p = bytes.slice(a, b);
        return { arrayBuffer: async () => p.buffer.slice(p.byteOffset, p.byteOffset + p.byteLength) };
      },
    };
  };

  const csv = 'A;B;C\n1;dois;"tr;es"\n4;cinco;seis\n\n7;oito;nove\n';
  const vistas = [];
  const r = await pl.lerCsvEmFluxo(arquivoFalso(csv), (l) => vistas.push(l), { pedaco: 7 });
  conferir('o cabeçalho sai inteiro mesmo cortado no meio por um pedaço',
    r.cabecalho.join(',') === 'A,B,C' && r.registros === 3, JSON.stringify(r));
  conferir('campo entre aspas com o separador dentro não é repartido',
    vistas[0][2] === 'tr;es', JSON.stringify(vistas[0]));
  conferir('linha em branco no meio do arquivo não vira registro',
    vistas.length === 3 && vistas[2][0] === '7', JSON.stringify(vistas));

  // O cabeçalho do TSE é ASCII puro, então o primeiro pedaço não revela a
  // codificação. Decidir por ele fazia "SÃO JOSÉ" virar losango — e a chave do
  // município saía diferente da que já estava guardada.
  const acentos = 'NM_UE;X\nSÃO JOSÉ DO NORTE;1\nERECHIM;2\n';
  const cortes = [5, 8, 9, 13, 1000];
  let latinOk = true;
  let utf8Ok = true;
  for (const pedaco of cortes) {
    const a = [];
    await pl.lerCsvEmFluxo(arquivoFalso(acentos, { latin1: true }), (l) => a.push(l), { pedaco });
    if (a[0]?.[0] !== 'SÃO JOSÉ DO NORTE') latinOk = false;
    const b = [];
    await pl.lerCsvEmFluxo(arquivoFalso(acentos), (l) => b.push(l), { pedaco });
    if (b[0]?.[0] !== 'SÃO JOSÉ DO NORTE') utf8Ok = false;
  }
  conferir('windows-1252 é reconhecido em qualquer ponto de corte', latinOk);
  conferir('e UTF-8 com caractere partido entre pedaços também', utf8Ok);
  conferir('arquivo sem byte alto não força codificação nenhuma',
    (await pl.descobrirCodificacao(arquivoFalso('A;B\n1;2\n'), 4)) === 'utf-8');

  conferir('aspas dobradas dentro do campo viram uma aspa só',
    pl.dividirLinha('a;"b;c";"d""e"', ';').join('|') === 'a|b;c|d"e');
}

// ── votação do TSE: reduto ou lugar a conquistar ──
//
// O TSE grava o nome de urna, que quase nunca é o nome cadastrado no gabinete.
// Exigir igualdade exata devolveria zero votos sem erro nenhum — que é o pior
// modo de falhar, porque parece resposta.
{
  const tse = await import('../js/tse.js');
  const cabecalho = ['ANO_ELEICAO', 'SG_UF', 'NM_MUNICIPIO', 'DS_CARGO', 'NR_VOTAVEL', 'NM_VOTAVEL', 'SG_PARTIDO', 'QT_VOTOS'];
  const mapa = tse.mapearColunasDoTse(cabecalho);
  const linhas = [
    ['2022', 'RS', 'Erechim', 'DEPUTADO FEDERAL', '3000', 'MARCEL VAN HATTEM', 'NOVO', '5000'],
    ['2022', 'RS', 'Erechim', 'DEPUTADO FEDERAL', '4000', 'OUTRO CANDIDATO', 'XYZ', '6000'],
    ['2022', 'RS', 'Erechim', 'DEPUTADO FEDERAL', '5000', 'TERCEIRO NOME', 'ABC', '2000'],
    ['2022', 'RS', 'Aceguá', 'DEPUTADO FEDERAL', '3000', 'MARCEL VAN HATTEM', 'NOVO', '300'],
    // Outro cargo no mesmo arquivo: contar isto misturaria duas eleições.
    ['2022', 'RS', 'Erechim', 'DEPUTADO ESTADUAL', '30000', 'MARCEL VAN HATTEM', 'NOVO', '9000'],
  ];

  conferir('o cabeçalho do TSE é reconhecido apesar dos prefixos de coluna',
    mapa.municipio === 2 && mapa.votos === 7 && mapa.cargo === 3, JSON.stringify(mapa));
  conferir('o nome de urna casa com o nome cadastrado no gabinete',
    tse.mesmoCandidato('MARCEL VAN HATTEM', 'Marcel van Hattem')
    && !tse.mesmoCandidato('MARCELO VANIN', 'Marcel van Hattem'));

  const apurado = tse.apurarPorMunicipio(linhas, mapa, {
    nomeAutor: 'Marcel van Hattem', cargo: 'DEPUTADO FEDERAL',
  });
  const erechim = apurado.find((m) => m.nome === 'Erechim');
  conferir('os votos são somados por município, sem o cargo errado no meio',
    erechim.votosParlamentar === 5000 && erechim.votosValidos === 13000,
    JSON.stringify(erechim));
  // A colocação é o número que diz se ali é um reduto: sem ela o total de votos
  // não conta história nenhuma.
  conferir('a colocação sai da mesma leitura, contando quem teve mais votos',
    erechim.colocacao === 2 && Math.round(erechim.percentual * 100) / 100 === 38.46,
    JSON.stringify(erechim));
  conferir('cidade pequena com votação própria também entra',
    apurado.find((m) => m.nome === 'Aceguá').colocacao === 1);
  conferir('a chave do município é a mesma da base do gabinete',
    tse.chaveDoMunicipio('Santa Maria do Herval', 'RS') === 'santa-maria-do-herval-rs');

  // ── quem governa a cidade, do arquivo de candidaturas ──
  //
  // Preencher prefeito, vice e Câmara de 497 cidades à mão é trabalho de
  // semanas que envelhece sozinho. O TSE publica os três.
  const cabCand = ['ANO_ELEICAO', 'SG_UF', 'SG_UE', 'NM_UE', 'CD_CARGO', 'DS_CARGO', 'NR_CANDIDATO', 'NM_CANDIDATO', 'NM_URNA_CANDIDATO', 'SG_PARTIDO', 'DS_SIT_TOT_TURNO'];
  const mapaCand = tse.mapearColunasDoTse(cabCand);
  const cand = [
    ['2024', 'RS', '88013', 'ERECHIM', '11', 'PREFEITO', '15', 'PAULO DA SILVA PREFEITO', 'PAULO PREFEITO', 'NOVO', 'ELEITO'],
    ['2024', 'RS', '88013', 'ERECHIM', '12', 'VICE-PREFEITO', '15', 'VERA MARIA VICE', 'VERA VICE', 'NOVO', 'ELEITO'],
    ['2024', 'RS', '88013', 'ERECHIM', '13', 'VEREADOR', '1511', 'ANA DE SOUZA', 'ANA VEREADORA', 'NOVO', 'ELEITO POR QP'],
    ['2024', 'RS', '88013', 'ERECHIM', '13', 'VEREADOR', '1512', 'BRUNO LIMA', 'BRUNO VEREADOR', 'NOVO', 'ELEITO POR MÉDIA'],
    ['2024', 'RS', '88013', 'ERECHIM', '13', 'VEREADOR', '4444', 'CARLOS DE OUTRO', 'CARLOS OUTRO', 'UNIÃO', 'ELEITO'],
    // A armadilha: "NÃO ELEITO" contém "ELEITO". Um includes aqui daria a
    // prefeitura ao perdedor, em todas as cidades, sem erro na tela.
    ['2024', 'RS', '88013', 'ERECHIM', '11', 'PREFEITO', '44', 'PERDEDOR SILVA', 'PERDEDOR', 'UNIÃO', 'NÃO ELEITO'],
    ['2024', 'RS', '88013', 'ERECHIM', '13', 'VEREADOR', '1599', 'SUPLENTE SOUZA', 'SUPLENTE', 'NOVO', 'SUPLENTE'],
  ];

  conferir('"NÃO ELEITO" não passa por eleito, apesar de conter a palavra',
    tse.foiEleito('ELEITO') && tse.foiEleito('ELEITO POR QP') && tse.foiEleito('ELEITO POR MÉDIA')
    && !tse.foiEleito('NÃO ELEITO') && !tse.foiEleito('SUPLENTE') && !tse.foiEleito('2º TURNO'));
  conferir('os três cargos municipais são reconhecidos, e só eles',
    tse.papelDoCargo('PREFEITO') === 'prefeito'
    && tse.papelDoCargo('VICE-PREFEITO') === 'vice'
    && tse.papelDoCargo('VEREADOR') === 'vereador'
    && tse.papelDoCargo('DEPUTADO FEDERAL') === null);

  const eleitos = tse.apurarEleitos(cand, mapaCand, { partidoAliado: 'NOVO' });
  const cidade = eleitos.municipios[0];
  conferir('prefeito e vice saem do arquivo, pelo nome de urna',
    cidade.prefeito === 'Paulo Prefeito' && cidade.vicePrefeito === 'Vera Vice'
    && cidade.partidoPrefeito === 'NOVO', JSON.stringify(cidade));
  // O campo na ficha é "vereadores aliados": despejar os quinze eleitos de cada
  // Câmara faria uma lista que ninguém lê.
  conferir('só os vereadores do partido do parlamentar são guardados',
    cidade.vereadores.join(', ') === 'Ana Vereadora, Bruno Vereador',
    JSON.stringify(cidade.vereadores));
  conferir('o perdedor não vira prefeito e o suplente não vira vereador',
    !/Perdedor|Suplente/.test(JSON.stringify(cidade)), JSON.stringify(cidade));
  conferir('e o funil conta o que veio de cada cargo',
    eleitos.funil.prefeitos === 1 && eleitos.funil.vereadores === 3 && eleitos.funil.aliados === 2,
    JSON.stringify(eleitos.funil));

  // A apuração precisa aguentar o arquivo inteiro sem guardar linha nenhuma: é
  // um acumulador, não uma matriz. Alimentado registro a registro, o resultado
  // tem de ser o mesmo.
  const passoAPasso = tse.apuradorDeEleitos(mapaCand, { partidoAliado: 'NOVO' });
  for (const l of cand) passoAPasso.linha(l);
  conferir('apurar de uma vez e apurar em fluxo dão o mesmo resultado',
    JSON.stringify(passoAPasso.resultado()) === JSON.stringify(eleitos));

  const votosPasso = tse.apuradorDeVotacao(mapa, { nomeAutor: 'Marcel van Hattem', cargo: 'DEPUTADO FEDERAL' });
  for (const l of linhas) votosPasso.linha(l);
  conferir('o mesmo vale para a votação',
    JSON.stringify(votosPasso.resultado()) === JSON.stringify(apurado));
}

// ── renda e produção, do IBGE ──
//
// As tabelas do SIDRA são identificadas por número, e um número errado devolve
// resposta vazia sem erro nenhum. Por isso o módulo descobre a tabela e as
// variáveis pelo nome — e é essa descoberta que se testa aqui.
{
  const ibge = await import('../js/ibge.js');

  const achatado = ibge.achatarCatalogo([
    { nome: 'Produto Interno Bruto dos Municípios', agregados: [{ id: '5938', nome: 'Produto interno bruto a preços correntes e valor adicionado bruto por atividade econômica' }] },
    { nome: 'Censo Demográfico', agregados: [{ id: '9999', nome: 'Rendimento nominal mensal domiciliar per capita' }] },
  ]);
  // O nome do agregado sozinho não diz que é municipal; quem diz é o da
  // pesquisa. Guardar os dois juntos é o que permite achar a tabela certa.
  conferir('o catálogo é achatado com o nome da pesquisa junto',
    ibge.acharAgregado(achatado, /produto interno bruto.*munic/i)?.id === '5938',
    JSON.stringify(achatado.map((a) => a.id)));
  conferir('tabela que não chega ao município é descartada',
    ibge.atendeMunicipio({ nivelTerritorial: { Administrativo: ['N1', 'N3', 'N6'] } })
    && !ibge.atendeMunicipio({ nivelTerritorial: { Administrativo: ['N1', 'N3'] } }));

  const meta = { variaveis: [
    { id: 37, nome: 'PIB a preços correntes', unidade: 'Mil Reais' },
    { id: 513, nome: 'Valor adicionado bruto da Agropecuária, a preços correntes', unidade: 'Mil Reais' },
    { id: 517, nome: 'Valor adicionado bruto da Indústria, a preços correntes', unidade: 'Mil Reais' },
    { id: 6575, nome: 'Valor adicionado bruto dos Serviços, a preços correntes - exceto Administração, defesa, educação e saúde públicas e seguridade social', unidade: 'Mil Reais' },
    { id: 6576, nome: 'Valor adicionado bruto da Administração, defesa, educação e saúde públicas e seguridade social, a preços correntes', unidade: 'Mil Reais' },
    { id: 6543, nome: 'PIB per capita', unidade: 'Reais' },
  ] };
  const achadas = ibge.acharVariaveis(meta, [
    { chave: 'perCapita', re: /per capita/i },
    { chave: 'administracao', re: /valor adicionado.*administra[çc]/i, nao: /exceto/i },
    { chave: 'agropecuaria', re: /valor adicionado.*agropecu/i },
    { chave: 'industria', re: /valor adicionado.*ind[úu]stria/i },
    { chave: 'servicos', re: /valor adicionado.*servi[çc]os/i },
  ]);
  // O nome da variável de serviços contém "exceto Administração": sem a
  // exclusão os dois setores viriam com o mesmo número e serviços viria vazio.
  conferir('serviços não é confundido com administração pela cláusula "exceto"',
    achadas.servicos?.id === '6575' && achadas.administracao?.id === '6576',
    JSON.stringify(Object.fromEntries(Object.entries(achadas).map(([k, v]) => [k, v.id]))));
  conferir('e o per capita é achado com a unidade dele, que não é a das demais',
    achadas.perCapita?.id === '6543' && achadas.perCapita.unidade === 'Reais');

  // A primeira varredura escolheu a tabela do PIB "Referência 2002 (Série
  // encerrada)": ela responde, e responde o retrato de dez anos atrás.
  conferir('série encerrada não é escolhida quando existe série viva',
    ibge.acharAgregado(ibge.achatarCatalogo([
      { nome: 'Produto Interno Bruto dos Municípios', agregados: [
        { id: '21', nome: 'Produto interno bruto - Referência 2002 (Série encerrada)' },
        { id: '5938', nome: 'Produto interno bruto a preços correntes e valor adicionado bruto' },
      ] },
    ]).filter((a) => !/s[ée]rie encerrada/i.test(a.texto)), /produto interno bruto.*munic/i)?.id === '5938');
  conferir('e a tabela mais recente vence pelo fim da série declarado',
    ibge.ultimoPeriodo({ periodicidade: { fim: 2021 } }) === 2021
    && ibge.ultimoPeriodo({ periodicidade: { fim: '2022' } }) === 2022
    && ibge.ultimoPeriodo({}) === 0);

  conferir('"..." e "-" são ausência de dado, não zero',
    ibge.valorIbge('45123') === 45123 && ibge.valorIbge('...') === null
    && ibge.valorIbge('-') === null && ibge.valorIbge('') === null);

  // Listar um setor de 3% ao lado de um de 60% dá aos dois a mesma importância
  // para quem passa o olho na folha.
  conferir('a atividade econômica sai da repartição do valor adicionado',
    ibge.atividadesDoVab({ agropecuaria: 400, industria: 250, servicos: 300, administracao: 50 })
    === 'agropecuária (40%), serviços (30%) e indústria (25%)');
  conferir('setor irrelevante não entra na frase',
    ibge.atividadesDoVab({ agropecuaria: 950, industria: 20, servicos: 30 }) === 'agropecuária (95%)');
  conferir('sem valor adicionado, a frase não é inventada',
    ibge.atividadesDoVab({ agropecuaria: 0, industria: 0 }) === null);

  const dados = ibge.economiaDoMunicipio(
    { ano: '2021', perCapita: 45000, agropecuaria: 400, industria: 250, servicos: 300, administracao: 50 },
    { ano: '2022', rendaMedia: 2100 },
    { pib: { nome: 'PIB dos Municípios' }, renda: { nome: 'Censo' } },
  );
  conferir('o registro do município cita de onde veio cada número',
    dados.pibPerCapita === 45000 && dados.rendaMedia === 2100
    && /PIB dos Municípios \(2021\)/.test(dados.fonteEconomia)
    && /Censo \(2022\)/.test(dados.fonteEconomia), JSON.stringify(dados));
}

/**
 * Malha e nomes do IBGE, de mentira.
 *
 * Ficam aqui, fora dos blocos, porque a malha é guardada em localStorage e o
 * localStorage é do domínio, não da página: dois testes com fixtures diferentes
 * fariam o segundo ler o cache do primeiro e falhar por um motivo que não é o
 * dele. Uma fixture só, e o cache compartilhado passa a ser mais um caminho
 * exercitado em vez de uma armadilha.
 */
const malhaFalsa = {
  type: 'FeatureCollection',
  features: [
    { properties: { codarea: '4306957' }, geometry: { type: 'Polygon', coordinates: [[[-52, -27], [-51, -27], [-51, -28], [-52, -28], [-52, -27]]] } },
    { properties: { codarea: '4300034' }, geometry: { type: 'Polygon', coordinates: [[[-54, -31], [-53, -31], [-53, -32], [-54, -32], [-54, -31]]] } },
    { properties: { codarea: '4309050' }, geometry: { type: 'Polygon', coordinates: [[[-51, -29], [-50, -29], [-50, -30], [-51, -30], [-51, -29]]] } },
  ],
};
const nomesFalsos = [
  {
    id: 4306957,
    nome: 'Erechim',
    microrregiao: { nome: 'Erechim', mesorregiao: { nome: 'Noroeste Rio-Grandense', UF: { sigla: 'RS' } } },
    'regiao-imediata': { nome: 'Erechim' },
  },
  { id: 4300034, nome: 'Aceguá' },
  { id: 4309050, nome: 'Gramado' },
];

// ── ficha de apresentação: o município em uma folha ──
//
// Para que serve: o deputado vai a Erechim na quinta e alguém monta, na quarta, a
// folha com o que o mandato fez ali e o que está travado. O teste confere que a
// folha se monta e — mais importante — que ela não inventa o que não tem.
{
  const pagina = await abrir();
  await pagina.route(/servicodados\.ibge\.gov\.br.*malhas/, (r) => r.fulfill({
    status: 200,
    contentType: 'application/geo+json',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(malhaFalsa),
  }));
  await pagina.route(/servicodados\.ibge\.gov\.br.*localidades/, (r) => r.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(nomesFalsos),
  }));
  await pagina.route(/servicodados\.ibge\.gov\.br.*agregados/, (r) => r.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify([{ resultados: [{ series: [{ serie: { 2022: '105705' } }] }] }]),
  }));

  await pagina.goto(`${BASE}/#/administrativo/ficha`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.ficha-secao', { timeout: 15000 });
  const folha = (await pagina.locator('.ficha').innerText()).replace(/\s+/g, ' ');

  conferir('a ficha abre já no município que o gabinete conhece',
    /Erechim/.test(folha), folha.slice(0, 120));
  conferir('traz o retrato da cidade, que dá escala ao valor da emenda',
    /105\.705/.test(folha) && /Noroeste Rio-Grandense/.test(folha), folha.slice(0, 400));
  // Um milhão em Aceguá não é um milhão em Porto Alegre: é o por habitante que
  // torna comparável o incomparável.
  conferir('e o valor por habitante, que é o que compara cidades diferentes',
    /por habitante/i.test(folha), folha.slice(0, 600));
  conferir('as emendas do município entram na folha',
    /Emendas do mandato/.test(folha) && /R\$/.test(folha), folha.slice(0, 600));
  // Lacuna dita é lacuna. Preencher buraco com suposição numa folha que vai para
  // uma reunião é pior que a folha incompleta.
  conferir('contato inexistente é dito como ausência, não preenchido por suposição',
    /Nenhum contato deste município/.test(folha), folha.slice(-300));
  conferir('e a folha declara de onde veio e que nada é estimado',
    /Nada aqui é estimado/.test(folha), folha.slice(-200));

  // O que nenhuma API entrega e o gabinete cadastrou à mão. Sem isto a ficha é
  // um extrato de execução orçamentária, não uma ficha de apresentação.
  conferir('quem governa a cidade entra na folha, com o partido',
    /Paulo Prefeito \(NOVO\)/.test(folha) && /Carlos Presidente/.test(folha),
    folha.slice(0, 700));
  conferir('e os vereadores aliados, que é com quem se fala antes de viajar',
    /Ana Vereadora/.test(folha) && /Bruno Vereador/.test(folha), folha.slice(0, 800));
  // Não existe base pública que diga quem está sentado na cadeira hoje: entre a
  // eleição e a visita cabem renúncia, cassação e o vice assumindo. A folha não
  // afirma mais do que sabe.
  conferir('quem não foi conferido aparece como "Prefeito eleito", não "Prefeito"',
    /Prefeito eleito/.test(folha), folha.slice(0, 800));
  conferir('e a folha diz onde se registra a conferência',
    /Confirmado pelo gabinete/.test(folha), folha.slice(0, 1000));
  // Reduto ou lugar a conquistar: é o que muda a conversa de uma visita.
  conferir('a votação do parlamentar na cidade, com percentual e colocação',
    /5\.000/.test(folha) && /38,5%|38\.5%/.test(folha) && /2º/.test(folha),
    folha.slice(0, 900));
  conferir('o resumo de renda e produção sai dos campos, não de texto gerado',
    /agroindústria e metalmecânica/.test(folha) && /2\.100/.test(folha)
    && /distrito industrial/.test(folha), folha.slice(0, 1200));
  // Pedido explícito do gabinete: numa folha levada a uma reunião, o código do
  // IBGE ocupa linha e não responde pergunta nenhuma.
  conferir('o código do IBGE não aparece mais na folha',
    !/Código IBGE/.test(folha) && !/4306957/.test(folha), folha.slice(0, 500));

  // O minimapa: onde a cidade fica no estado. Vale, numa folha impressa, o que
  // três linhas de texto não valem.
  conferir('o minimapa desenha o estado e destaca a cidade',
    (await pagina.locator('.minimapa .minimapa-cidade').count()) === 1,
    String(await pagina.locator('.ficha-minimapa').count()));

  // A folha vira mensagem sem virar outra coisa: mesma fonte, três saídas.
  const envio = await pagina.evaluate(async () => {
    const f = await import('/js/ficha.js');
    const ficha = f.dadosDaFicha({
      nome: 'Erechim',
      uf: 'RS',
      lugar: null,
      retrato: { nome: 'Erechim', uf: 'RS', populacao: 105705 },
      cadastro: { prefeito: 'Paulo Prefeito', partidoPrefeito: 'NOVO', vereadores: ['Ana Vereadora'], votosParlamentar: 5000, votosValidos: 13000, colocacao: 2, anoEleicao: 2022, atividades: 'agroindústria' },
      contatos: [],
    });
    return {
      texto: f.textoDaFicha(ficha),
      link: f.linkDoWhatsapp('(54) 99999-0000', 'oi'),
      semNumero: f.linkDoWhatsapp('', 'oi'),
      comDdi: f.linkDoWhatsapp('5554999990000', 'oi'),
      destinatarios: f.destinatariosPossiveis({
        gabinete: { deputado: 'Deputada Teste', whatsappParlamentar: '54999990000' },
        equipe: [
          { nome: 'Ana Assessora', cargo: 'Secretária parlamentar', telefone: '(54) 98888-0000', situacao: 'ativo' },
          // Quem saiu do gabinete não recebe documento interno do gabinete.
          { nome: 'Zeca Exonerado', telefone: '(54) 97777-0000', situacao: 'desligado' },
          // Sem número não há para onde mandar; oferecê-lo abriria o seletor de
          // contatos do WhatsApp, que é a porta que esta lista fecha.
          { nome: 'Bia Sem Telefone', situacao: 'ativo' },
        ],
      }),
      // O CRM não entra: a ficha traz pendências e leitura interna, e um toque
      // errado num seletor de trezentos contatos viraria vazamento.
      semEquipe: f.destinatariosPossiveis({ gabinete: {}, equipe: [] }),
    };
  });

  conferir('a mensagem de WhatsApp traz o que se responde na porta da prefeitura',
    /Erechim\/RS/.test(envio.texto) && /Paulo Prefeito \(NOVO\)/.test(envio.texto)
    && /5\.000 votos/.test(envio.texto) && /2º lugar/.test(envio.texto),
    envio.texto.slice(0, 300));
  conferir('sem emenda registrada, a mensagem diz a ausência em vez de omitir',
    /nenhuma registrada/.test(envio.texto), envio.texto);
  conferir('o link do WhatsApp completa o DDI e não o duplica',
    envio.link.startsWith('https://wa.me/5554999990000?text=')
    && envio.comDdi.startsWith('https://wa.me/5554999990000?text='),
    `${envio.link} | ${envio.comDdi}`);
  conferir('sem número, o link abre o seletor de contatos do próprio WhatsApp',
    envio.semNumero.startsWith('https://wa.me/?text='), envio.semNumero);
  // A ficha é feita para o parlamentar: obrigá-lo a procurar o próprio nome no
  // meio de trezentos contatos seria o oposto do que esta tela existe para fazer.
  conferir('o parlamentar vem primeiro na lista de envio',
    envio.destinatarios[0].grupo === 'Parlamentar'
    && envio.destinatarios[0].telefone === '54999990000',
    JSON.stringify(envio.destinatarios[0]));
  // A ficha não é material de divulgação: ela traz o que está impedido e a
  // leitura que o gabinete faz da cidade. Sai o CRM, fica a equipe.
  conferir('depois dele, só a equipe do gabinete — e nenhum contato do CRM',
    envio.destinatarios.length === 2
    && envio.destinatarios[1].nome === 'Ana Assessora'
    && envio.destinatarios[1].grupo === 'Equipe do gabinete',
    JSON.stringify(envio.destinatarios));
  conferir('quem saiu do gabinete e quem não tem número ficam de fora',
    !envio.destinatarios.some((d) => /Exonerado|Sem Telefone/.test(d.nome)),
    JSON.stringify(envio.destinatarios.map((d) => d.nome)));
  conferir('sem ninguém cadastrado, a lista fica vazia em vez de abrir o seletor',
    envio.semEquipe.length === 0, JSON.stringify(envio.semEquipe));

  // Pela tela: o seletor não pode oferecer um caminho de saída que a regra
  // fecha — número livre ou "escolher no WhatsApp" tornariam a restrição
  // decorativa.
  await pagina.getByRole('button', { name: 'Enviar por WhatsApp' }).click();
  await pagina.waitForSelector('.modal select', { timeout: 5000 });
  const opcoes = await pagina.locator('.modal select option').allInnerTexts();
  conferir('o seletor de envio traz o parlamentar e a equipe, e nada mais',
    opcoes.length === 2 && /Deputada Teste/.test(opcoes[0]) && /Ana Assessora/.test(opcoes[1]),
    JSON.stringify(opcoes));
  conferir('e não oferece número livre nem o seletor do próprio WhatsApp',
    !opcoes.some((o) => /Digitar|Escolher no WhatsApp/i.test(o))
    && (await pagina.locator('.modal input[type="tel"]').count()) === 0,
    JSON.stringify(opcoes));

  await pagina.close();
}

// Sem o IBGE, a ficha ainda serve: o que falta é dito, não inventado.
{
  const pagina = await abrir();
  await pagina.route(/servicodados\.ibge\.gov\.br/, (r) => r.abort());
  await pagina.goto(`${BASE}/#/administrativo/ficha`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.ficha-secao', { timeout: 15000 });
  const folha = (await pagina.locator('.ficha').innerText()).replace(/\s+/g, ' ');
  conferir('sem o IBGE, o retrato é declarado ausente e o resto da folha fica',
    /IBGE não respondeu/.test(folha) && /Emendas do mandato/.test(folha), folha.slice(0, 300));
  await pagina.close();
}

// ── o dashboard: onde o mandato chegou, e onde não chegou ──
//
// Duas malhas de mentira, uma que responde e outra que não. O mapa é o caminho
// bom; a lista é o que garante que uma indisponibilidade do IBGE não leve embora
// a resposta.
{
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

  // O endereço antigo do dashboard tem de continuar respondendo: fundir duas
  // telas é melhoria, quebrar o link que já circula no gabinete não é.
  conferir('o endereço /dashboard leva à mesma tela, agora única',
    /Por município/.test(await pagina.locator('.modulo-titulo h1').innerText()),
    await pagina.locator('.modulo-titulo h1').innerText());
  // Mapa e tabela na mesma tela: o mapa responde "onde chegou", a tabela
  // responde "quanto foi para Erechim". Eram duas abas para um trabalho só.
  conferir('a mesma tela traz o mapa e a tabela por município',
    (await pagina.locator('.tabela--municipios').count()) === 1);

  await pagina.locator('.mapa-municipio--com-emenda').first().click();
  await pagina.waitForTimeout(500);
  // Clicar no mapa não abre um segundo painel de detalhe — leva à linha
  // daquele município, já aberta. Duas telas de detalhe para o mesmo dado é
  // como as duas abas divergiam sem ninguém perceber.
  const alvo = (await pagina.locator('.linha-municipio--alvo').innerText()).replace(/\s+/g, ' ');
  conferir('clicar no município leva à linha dele, marcada',
    /Erechim/i.test(alvo), alvo.slice(0, 120));
  const aberto = (await pagina.locator('.linha-detalhe:not([hidden])').first().innerText()).replace(/\s+/g, ' ');
  conferir('e com as emendas dele já abertas',
    /emenda|R\$/i.test(aberto), aberto.slice(0, 200));

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
  // O mapa é o que torna a leitura instantânea, não o que a torna possível: a
  // tabela por município responde tudo mesmo com o IBGE fora do ar.
  conferir('e a tabela por município responde de qualquer jeito',
    (await pagina.locator('.tabela--municipios tbody tr').count()) > 0
    && /Erechim/.test(await pagina.locator('.tabela--municipios').innerText()),
    (await pagina.locator('.tabela--municipios').innerText()).replace(/\s+/g, ' ').slice(0, 120));
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
  // O banco é o caminho, não quem recebeu — nem quando é o único nome que o
  // documento traz.
  conferir('e o banco fica registrado como caminho, não como recebedor',
    reunidos[0].favorecidoIntermediario === 'BANCO DO BRASIL SA'
    && reunidos[0].favorecido !== 'BANCO DO BRASIL SA',
    `recebeu ${reunidos[0].favorecido} · via ${reunidos[0].favorecidoIntermediario}`);

  // ── ninguém destina emenda ao Banco do Brasil ──
  //
  // No documento de pagamento do SIAFI o favorecido é o banco, porque é ele
  // quem opera o repasse. Tratá-lo como destino fazia dele o MAIOR destino do
  // mandato — todo repasse passa por lá. Um número que ninguém sabe explicar
  // numa reunião é pior que um número ausente.
  const comBanco = pp.reunirDestinos([
    { codigoEmenda: '202341160007', favorecido: 'BANCO DO BRASIL SA', tipo: 'pagamento', valor: 500000, documento: 'D1' },
    { codigoEmenda: '202341160007', favorecido: 'BANCO DO BRASIL SA', tipo: 'pagamento', valor: 300000, documento: 'D2' },
    { codigoEmenda: '202341160006', favorecido: 'BANCO DO BRASIL SA', tipo: 'pagamento', valor: 900000, documento: 'D3' },
    { codigoEmenda: '202341160007', favorecido: 'MUNICIPIO DE GRAMADO', tipo: 'empenho', valor: 250000, documento: 'D4' },
  ]);
  conferir('banco sem município não vira destino nem aparece como recebedor',
    comBanco.every((d) => d.favorecido !== 'BANCO DO BRASIL SA'),
    JSON.stringify(comBanco.map((d) => d.favorecido)));
  const naoIdentificado = comBanco.filter((d) => d.destinoTipo === 'intermediario');
  conferir('as linhas de banco viram "destino não identificado", uma por emenda',
    naoIdentificado.length === 2
    && naoIdentificado.every((d) => /destino final não informado/.test(d.objeto || '')),
    JSON.stringify(naoIdentificado.map((d) => [d.codigoEmenda, d.valorPago])));
  // O total não pode encolher em silêncio: o dinheiro saiu, só não se sabe para
  // onde. Sumir com a linha trocaria um erro por outro.
  conferir('e o dinheiro continua somado, sem sumir da conta',
    comBanco.reduce((t, d) => t + d.valorPago, 0) === 1700000);

  // O empenho nomeia a prefeitura e o pagamento sai pelo banco: é o mesmo
  // dinheiro em duas fases, e virava duas linhas.
  const duasFases = pp.reunirDestinos([
    { codigoEmenda: '202341160005', favorecido: 'MUNICIPIO DE MUÇUM', tipo: 'empenho', valor: 70000, documento: 'E1' },
    { codigoEmenda: '202341160005', favorecido: 'CAIXA ECONOMICA FEDERAL', municipio: 'MUÇUM', tipo: 'pagamento', valor: 70000, documento: 'P1' },
  ]);
  conferir('empenho da prefeitura e pagamento pelo banco são uma linha só',
    duasFases.length === 1 && duasFases[0].valorEmpenhado === 70000
    && duasFases[0].valorPago === 70000 && duasFases[0].municipio === 'MUÇUM',
    JSON.stringify(duasFases.map((d) => [d.municipio, d.valorEmpenhado, d.valorPago])));

  // Duas entidades da mesma cidade continuam sendo dois destinos, com objetos
  // diferentes — e nenhuma delas é "Município".
  const duasEntidades = pp.reunirDestinos([
    { codigoEmenda: '202341160009', favorecido: 'ASSOCIACAO BENEFICENTE DE MUCUM', municipio: 'MUÇUM', tipo: 'empenho', valor: 20000, documento: 'A1' },
    { codigoEmenda: '202341160009', favorecido: 'HOSPITAL SANTO ANTONIO', municipio: 'MUÇUM', tipo: 'empenho', valor: 30000, documento: 'A2' },
  ]);
  conferir('entidade com município conhecido não vira "Município" no filtro',
    duasEntidades.length === 2 && duasEntidades.every((d) => d.destinoTipo === 'entidade'),
    JSON.stringify(duasEntidades.map((d) => [d.favorecido, d.destinoTipo])));

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
