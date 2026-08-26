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

// ─────────────────────── suíte 2: matriz de permissão ───────────────────────

console.log('\nMatriz de permissão\n');

const TELAS = [
  'administrativo/equipe',
  'legislativo/producao',
  'comunicacao/editorial',
  'administrativo/municipios',
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
conferir('escritório no estado edita administrativo', escritorio['administrativo/equipe']);
conferir('e os municípios, que alimentam a ficha', escritorio['administrativo/municipios']);
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
