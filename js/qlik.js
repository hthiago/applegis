/**
 * Conversa com o painel de transferências do SERPRO.
 *
 * O que ele é, de fato: um aplicativo Qlik Sense público, sem login. A página é
 * uma casca — os números não vêm por endereço nenhum, vêm por WebSocket, num
 * protocolo JSON-RPC próprio, endereçados por identificadores de aplicativo e
 * de objeto. Isso soa proibitivo e não é: os identificadores estão escritos no
 * `config.js` do próprio painel, com descrição em português de cada objeto, e
 * WebSocket não passa por CORS. Dá para pedir a tabela direto daqui.
 *
 * O que o painel NÃO é: uma fonte nova. Ele mesmo se descreve como "emendas
 * parlamentares operacionalizadas no Transferegov.br" — a mesma base que o
 * sistema já consulta pela API documentada. O que ele acrescenta é a junção
 * pronta: emenda ligada a instrumento, a beneficiário, a município e a
 * situação, que é justamente o trabalho que custou caro montar à mão.
 *
 * Por isso este caminho é o segundo, e não o primeiro: a API do Transferegov
 * continua sendo a fonte, e isto é a conferência — e o atalho quando a junção
 * pela API não fecha.
 *
 * Escrito sem poder testar contra o serviço real: este ambiente não alcança
 * gov.br. Em troca, o protocolo está isolado em funções puras, exercitadas
 * contra um WebSocket de mentira, e a orquestração relata cada passo — quando
 * falhar, vai falhar dizendo em que chamada e por quê.
 */

/**
 * Identificadores do painel, lidos do `config.js` publicado por ele.
 *
 * Ficam aqui à vista, e não escondidos numa chamada, porque é isto que quebra
 * quando o SERPRO republicar o painel: um lugar só para conferir contra o
 * config deles.
 */
export const PAINEL = {
  host: 'dd-publico.serpro.gov.br',
  apps: {
    discricionarias: '37c409c6-51a4-405a-9098-2d426367c982',
    especiais: '85f3156f-6449-437c-918b-4270a08c27c8',
    fundoAFundo: 'f606d92c-85ef-4971-82e5-00c0079a5d57',
    parlamentar: 'a5d52722-e8d9-49b2-ae75-09d1cf7fba7a',
    transferegov: '5cc78f2a-d402-423b-a056-6085f0da9d3e',
    obras: '8a20f0ce-cdc5-4a3c-ad74-7fe0cde87757',
  },
  objetos: {
    // "Lista de emendas com instrumentos celebrados. Selecione ao menos um
    // Parlamentar, UF, Município ou Órgão para exibir os dados." — a exigência
    // de seleção é do painel, não nossa, e é por isso que a consulta sem
    // parlamentar devolve tabela vazia em vez de erro.
    emendas: 'LhzUJw',
  },
  // O painel tenta várias grafias até uma responder. Copiado de lá porque a
  // lição é a mesma que a do nome de urna no TSE: exigir a grafia exata devolve
  // vazio sem erro, que é o pior modo de falhar.
  camposDoParlamentar: [
    'Nome Parlamentar Emenda',
    'Parlamentar Autor Emenda',
    'Autor Emenda',
    'NOME_PARLAMENTAR_EMENDA',
    'nome_parlamentar',
  ],
};

// ─────────────────────────── o protocolo, em funções puras ───────────────────

/** Uma chamada JSON-RPC do motor do Qlik. */
export function moldarChamada(id, handle, method, params = []) {
  return { jsonrpc: '2.0', id, handle, method, params };
}

/**
 * O handle que uma resposta devolveu.
 *
 * O motor responde objetos por handle numérico, e `qHandle: 0` é um handle
 * legítimo — um `||` aqui trocaria o documento aberto pelo handle global e as
 * chamadas seguintes iriam para o lugar errado, respondendo vazio sem erro.
 */
export function handleDe(resposta) {
  const h = resposta?.result?.qReturn?.qHandle;
  return Number.isInteger(h) ? h : null;
}

/** Os títulos das colunas, na ordem em que os dados vêm. */
export function colunasDoLayout(layout) {
  const cubo = layout?.qHyperCube || layout?.qLayout?.qHyperCube || {};
  const nomes = (info) => (info || []).map((c) => c.qFallbackTitle || c.qGroupFallbackTitles?.[0] || '');
  // A ordem interna do Qlik não é dimensões-e-depois-medidas: é a que
  // `qColumnOrder` declara. Ignorá-la troca o valor pelo município em silêncio.
  const titulos = [...nomes(cubo.qDimensionInfo), ...nomes(cubo.qMeasureInfo)];
  const ordem = cubo.qEffectiveInterColumnSortOrder;
  return { titulos, linhas: cubo.qSize?.qcy || 0, colunas: cubo.qSize?.qcx || titulos.length, ordem };
}

/** As linhas de uma página de dados, já como texto. */
export function lerMatriz(resposta) {
  const paginas = resposta?.result?.qDataPages || resposta?.qDataPages || [];
  const saida = [];
  for (const pagina of paginas) {
    for (const linha of pagina.qMatrix || []) {
      saida.push(linha.map((celula) => {
        if (celula?.qText != null && celula.qText !== '') return celula.qText;
        if (celula?.qNum != null && celula.qNum !== 'NaN') return String(celula.qNum);
        return '';
      }));
    }
  }
  return saida;
}

/**
 * Quantas linhas cabem numa página.
 *
 * O motor recusa páginas acima de dez mil células. Pedir mais volta como erro
 * de protocolo no meio da varredura, e não no começo — por isso o cálculo é
 * feito a partir da largura real da tabela, e não fixado num número.
 */
export function alturaDaPagina(colunas, teto = 10000) {
  return Math.max(1, Math.floor(teto / Math.max(1, colunas)));
}

/** A tabela do painel no formato que o importador de planilhas já lê. */
export function paraCsv(titulos, linhas) {
  const escapar = (v) => {
    const t = String(v ?? '');
    return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return [titulos, ...linhas].map((l) => l.map(escapar).join(';')).join('\n');
}

// ─────────────────────────────── a conversa ──────────────────────────────────

/**
 * Um canal JSON-RPC sobre WebSocket, com as respostas casadas por id.
 *
 * O motor responde fora de ordem e intercala avisos sem `id` (mudança de
 * seleção, sessão expirando). Casar por id em vez de assumir ordem é o que
 * impede uma resposta de `GetLayout` ser lida como resposta de `Select`.
 */
export function canal(socket, { tempoLimite = 30000 } = {}) {
  const pendentes = new Map();
  let proximo = 0;
  let encerrado = null;

  socket.addEventListener('message', (evento) => {
    let msg;
    try { msg = JSON.parse(evento.data); } catch { return; }
    const espera = pendentes.get(msg.id);
    if (!espera) return;
    pendentes.delete(msg.id);
    if (msg.error) espera.rejeitar(new Error(`${msg.error.message || 'erro'} (código ${msg.error.code})`));
    else espera.resolver(msg);
  });

  const derrubar = (motivo) => {
    encerrado = encerrado || new Error(motivo);
    for (const { rejeitar } of pendentes.values()) rejeitar(encerrado);
    pendentes.clear();
  };
  socket.addEventListener('close', () => derrubar('A conexão com o painel caiu.'));
  socket.addEventListener('error', () => derrubar('A conexão com o painel falhou.'));

  return {
    chamar(handle, metodo, params = []) {
      if (encerrado) return Promise.reject(encerrado);
      proximo += 1;
      const id = proximo;
      const promessa = new Promise((resolver, rejeitar) => {
        const relogio = setTimeout(() => {
          pendentes.delete(id);
          rejeitar(new Error(`O painel não respondeu a ${metodo} em ${Math.round(tempoLimite / 1000)}s.`));
        }, tempoLimite);
        pendentes.set(id, {
          resolver: (m) => { clearTimeout(relogio); resolver(m); },
          rejeitar: (e) => { clearTimeout(relogio); rejeitar(e); },
        });
      });
      socket.send(JSON.stringify(moldarChamada(id, handle, metodo, params)));
      return promessa;
    },
    fechar() { try { socket.close(); } catch { /* já fechado */ } },
  };
}

/** Abre o WebSocket e espera ele ficar pronto. */
export function abrirSocket(url, Construtor) {
  const Ws = Construtor || (typeof WebSocket !== 'undefined' ? WebSocket : null);
  if (!Ws) throw new Error('Este navegador não tem WebSocket.');
  const socket = new Ws(url);
  return new Promise((resolver, rejeitar) => {
    const pronto = () => resolver(socket);
    socket.addEventListener('open', pronto, { once: true });
    socket.addEventListener('error', () => rejeitar(new Error(`Não foi possível abrir ${url}.`)), { once: true });
    setTimeout(() => rejeitar(new Error(`O painel não abriu a conexão em 20s (${url}).`)), 20000);
  });
}

/**
 * Baixa uma tabela do painel, filtrada pelo parlamentar.
 *
 * A seleção é obrigatória, e não uma conveniência: a própria descrição do
 * objeto diz "selecione ao menos um Parlamentar, UF, Município ou Órgão para
 * exibir os dados". Sem ela a tabela vem vazia — e vazia sem explicação é o
 * relato que faz procurar defeito onde não há.
 */
export async function baixarTabela({
  app = PAINEL.apps.discricionarias,
  objeto = PAINEL.objetos.emendas,
  parlamentar = null,
  host = PAINEL.host,
  aoAndar = null,
  WebSocketCtor = null,
  maximoDeLinhas = 20000,
} = {}) {
  const url = `wss://${host}/app/${app}`;
  const passos = [];
  const socket = await abrirSocket(url, WebSocketCtor);
  const c = canal(socket);

  try {
    const doc = handleDe(await c.chamar(-1, 'OpenDoc', [app]));
    if (doc == null) throw new Error('O painel não abriu o aplicativo.');
    passos.push(`aplicativo ${app} aberto`);

    if (parlamentar) {
      let selecionou = null;
      for (const nome of PAINEL.camposDoParlamentar) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const campo = handleDe(await c.chamar(doc, 'GetField', [nome]));
          if (campo == null) continue;
          // eslint-disable-next-line no-await-in-loop
          const r = await c.chamar(campo, 'Select', [parlamentar, false, 0]);
          if (r?.result?.qReturn === true) { selecionou = nome; break; }
        } catch { /* grafia seguinte */ }
      }
      if (!selecionou) {
        throw new Error(`O painel não aceitou "${parlamentar}" em nenhum dos campos de parlamentar (${PAINEL.camposDoParlamentar.join(', ')}). O nome precisa ser exatamente como a base do Transferegov o escreve.`);
      }
      passos.push(`selecionado por ${selecionou}`);
    }

    const alvo = handleDe(await c.chamar(doc, 'GetObject', [objeto]));
    if (alvo == null) throw new Error(`O painel não tem o objeto ${objeto}.`);

    const layout = (await c.chamar(alvo, 'GetLayout', [])).result?.qLayout;
    const { titulos, linhas: totalLinhas, colunas } = colunasDoLayout({ qHyperCube: layout?.qHyperCube });
    if (!titulos.length) throw new Error('O objeto respondeu sem colunas — não é uma tabela.');
    passos.push(`${totalLinhas} linha(s), ${colunas} coluna(s)`);

    const altura = alturaDaPagina(colunas);
    const linhas = [];
    for (let topo = 0; topo < Math.min(totalLinhas, maximoDeLinhas); topo += altura) {
      // eslint-disable-next-line no-await-in-loop
      const pagina = await c.chamar(alvo, 'GetHyperCubeData', ['/qHyperCubeDef', [{
        qTop: topo, qLeft: 0, qHeight: altura, qWidth: colunas,
      }]]);
      const lote = lerMatriz(pagina);
      if (!lote.length) break;
      linhas.push(...lote);
      if (aoAndar) aoAndar(linhas.length, Math.min(totalLinhas, maximoDeLinhas));
    }

    return { titulos, linhas, passos, truncado: totalLinhas > maximoDeLinhas };
  } finally {
    c.fechar();
  }
}

/**
 * A tabela do painel como arquivo, para o importador de planilhas já existente.
 *
 * Reaproveitar o importador não é economia de código: é o que garante que o
 * dado vindo do painel passe pela mesma conciliação por código e ano do dado
 * vindo da planilha — reimportar atualiza, não duplica.
 */
export async function planilhaDoPainel(opcoes = {}) {
  const { titulos, linhas, passos, truncado } = await baixarTabela(opcoes);
  const csv = paraCsv(titulos, linhas);
  const arquivo = new File([csv], 'painel-emendas.csv', { type: 'text/csv' });
  return { arquivo, titulos, quantidade: linhas.length, passos, truncado };
}
