const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

/**
 * Ponte entre o gabinete e as bases de execução orçamentária.
 *
 * Ela existe por duas razões, e nenhuma delas se resolve no navegador:
 *
 *   1. O Portal da Transparência exige uma chave de API. Chave em código de
 *      navegador fica visível para qualquer visitante da página — e a cota é do
 *      gabinete. Aqui ela vive como segredo do projeto, nunca sai do servidor e
 *      não aparece em log nenhum.
 *   2. Nenhuma dessas bases autoriza chamada vinda de outra origem. O navegador
 *      recusa antes mesmo de a resposta chegar. Do servidor, essa regra não se
 *      aplica.
 *
 * O que esta função NÃO faz: interpretar dados. Ela repassa o que a fonte
 * devolveu, com o status e o corpo do erro quando há erro. Toda a leitura
 * acontece no cliente, onde dá para conferir com teste. Um proxy que também
 * interpreta esconde de qual dos dois lados veio o problema.
 */

initializeApp();

const CHAVE_PORTAL = defineSecret('CHAVE_PORTAL_TRANSPARENCIA');

/**
 * As fontes que esta ponte aceita, e só elas.
 *
 * Sem esta lista, a função viraria um proxy aberto: qualquer pessoa autenticada
 * poderia mandá-la buscar qualquer endereço da internet, usando o projeto do
 * gabinete como intermediário. Cada fonte declara o que aceita receber, e
 * parâmetro fora da lista é descartado em vez de repassado.
 */
const FONTES = {
  'portal-emendas': {
    base: 'https://api.portaldatransparencia.gov.br/api-de-dados/emendas',
    parametros: ['codigoEmenda', 'numeroEmenda', 'nomeAutor', 'ano', 'tipoEmenda',
      'codigoFuncao', 'codigoSubfuncao', 'pagina'],
    cabecalhos: () => ({ 'chave-api-dados': CHAVE_PORTAL.value() }),
    exigeChave: true,
  },
  /**
   * A emenda discriminada, no Portal: os documentos de execução — empenho,
   * liquidação, pagamento — com o favorecido de cada um. É o nível abaixo do
   * consolidado que /emendas devolve.
   */
  'portal-emenda-documentos': {
    base: 'https://api.portaldatransparencia.gov.br/api-de-dados/emendas/documentos',
    parametros: ['codigoEmenda', 'pagina'],
    cabecalhos: () => ({ 'chave-api-dados': CHAVE_PORTAL.value() }),
    exigeChave: true,
  },
  'portal-emenda-impedimentos': {
    base: 'https://api.portaldatransparencia.gov.br/api-de-dados/emendas/documentos-impedimentos',
    parametros: ['codigoEmenda', 'pagina'],
    cabecalhos: () => ({ 'chave-api-dados': CHAVE_PORTAL.value() }),
    exigeChave: true,
  },
  'portal-convenios': {
    base: 'https://api.portaldatransparencia.gov.br/api-de-dados/convenios',
    parametros: ['codigoIBGE', 'dataInicial', 'dataFinal', 'ufSigla', 'pagina',
      'codigoOrgao', 'numeroConvenio'],
    cabecalhos: () => ({ 'chave-api-dados': CHAVE_PORTAL.value() }),
    exigeChave: true,
  },

  /**
   * Fontes exploratórias: mesmo host, caminho variável.
   *
   * Cada endpoint novo declarado como fonte fixa custa uma implantação para ser
   * testado, e descobrir qual caminho existe numa API que eu não alcanço daqui
   * exige tentar vários. Estas duas entradas trocam a lista fechada de caminhos
   * por uma lista fechada de *hosts*: o proxy continua sem poder buscar
   * endereço arbitrário na internet, mas deixa de exigir um deploy por palpite.
   *
   * O sufixo é validado: só letras, dígitos, hífen e barra, sem "..", sem
   * protocolo, sem host — nada que permita sair da base declarada.
   */
  'portal-livre': {
    base: 'https://api.portaldatransparencia.gov.br/api-de-dados',
    permiteSufixo: true,
    parametrosLivres: true,
    cabecalhos: () => ({ 'chave-api-dados': CHAVE_PORTAL.value() }),
    exigeChave: true,
  },
  'transferegov-livre': {
    base: 'https://api.transferegov.gestao.gov.br',
    permiteSufixo: true,
    parametrosLivres: true,
    cabecalhos: () => ({}),
    exigeChave: false,
  },

  /**
   * O Transferegov serve por PostgREST: o filtro vai no próprio nome do campo,
   * na forma `campo=eq.valor`. Por isso a lista de parâmetros aqui é de nomes
   * de coluna, e não de parâmetros de consulta no sentido usual.
   */
  'transferegov-emendas': {
    base: 'https://api.transferegov.gestao.gov.br/emendas/emenda',
    parametros: ['limit', 'offset', 'order', 'nr_emenda', 'ano_emenda',
      'nome_parlamentar', 'select'],
    cabecalhos: () => ({}),
    exigeChave: false,
  },
  'transferegov-propostas': {
    base: 'https://api.transferegov.gestao.gov.br/convenios/proposta',
    parametros: ['limit', 'offset', 'order', 'id_proposta', 'ano_proposta',
      'uf_proponente', 'identif_proponente', 'select'],
    cabecalhos: () => ({}),
    exigeChave: false,
  },
  'transferegov-especiais': {
    base: 'https://api.transferegov.gestao.gov.br/transferenciasespeciais/programa_transferencia_especial',
    parametros: ['limit', 'offset', 'order', 'ano_programa_transferencia_especial',
      'ni_beneficiario_transferencia_especial'],
    cabecalhos: () => ({}),
    exigeChave: false,
  },
  'transferegov-convenios': {
    base: 'https://api.transferegov.gestao.gov.br/convenios/convenio',
    parametros: ['limit', 'offset', 'order', 'ano_conv', 'id_proposta', 'nr_convenio'],
    cabecalhos: () => ({}),
    exigeChave: false,
  },
};

/** Quem pode usar a ponte: a mesma lista que abre o sistema, e mais ninguém. */
async function conferirAcesso(auth) {
  if (!auth?.token?.email) {
    throw new HttpsError('unauthenticated', 'Entre no sistema para consultar.');
  }
  const email = String(auth.token.email).toLowerCase();
  const bd = getFirestore(process.env.FIRESTORE_DATABASE_ID || '(default)');
  const doc = await bd.collection('autorizados').doc(email).get();

  if (!doc.exists || doc.data().ativo === false) {
    throw new HttpsError('permission-denied', 'Esta conta não tem acesso ao sistema.');
  }
  return doc.data();
}

exports.consultarFonte = onCall(
  {
    region: 'southamerica-east1',
    secrets: [CHAVE_PORTAL],
    timeoutSeconds: 120,
    memory: '256MiB',
    // A consulta é sob demanda e rara; manter instância acesa custaria mais do
    // que a espera de alguns segundos ao clicar.
    maxInstances: 3,
  },
  async (request) => {
    await conferirAcesso(request.auth);

    const { fonte, parametros = {} } = request.data || {};
    const config = FONTES[fonte];
    if (!config) {
      throw new HttpsError('invalid-argument', `Fonte desconhecida: ${fonte}.`);
    }
    if (config.exigeChave && !CHAVE_PORTAL.value()) {
      throw new HttpsError('failed-precondition',
        'A chave do Portal da Transparência não foi cadastrada no projeto.');
    }

    const busca = new URLSearchParams();
    for (const [chave, valor] of Object.entries(parametros)) {
      if (valor === null || valor === undefined || valor === '') continue;
      const aceito = config.parametrosLivres
        ? /^[a-zA-Z_][a-zA-Z0-9_]{0,40}$/.test(chave) && String(valor).length <= 120
        : (config.parametros || []).includes(chave);
      if (aceito) busca.set(chave, String(valor));
    }

    // O sufixo só existe nas fontes exploratórias, e passa por uma peneira
    // estreita: sem protocolo, sem host, sem subir de diretório. O que sobra é
    // um caminho dentro da base declarada, e nada mais.
    const { caminho = '' } = request.data || {};
    let sufixo = '';
    if (caminho) {
      if (!config.permiteSufixo) {
        throw new HttpsError('invalid-argument', `A fonte ${fonte} não aceita caminho.`);
      }
      if (!/^\/[A-Za-z0-9\-_/]{1,120}$/.test(caminho) || caminho.includes('..')) {
        throw new HttpsError('invalid-argument', `Caminho recusado: ${caminho}`);
      }
      sufixo = caminho;
    }

    const url = `${config.base}${sufixo}?${busca}`;
    let resposta;
    try {
      resposta = await fetch(url, {
        headers: { Accept: 'application/json', ...config.cabecalhos() },
      });
    } catch (erro) {
      throw new HttpsError('unavailable', `A fonte não respondeu: ${erro.message}`);
    }

    const corpo = await resposta.text();

    if (!resposta.ok) {
      // O motivo vem da fonte, recortado. Devolver só o número transforma um
      // erro que se conserta em minutos num enigma — já custou caro uma vez.
      //
      // Chave recusada tem uma armadilha própria: trocar o segredo não basta,
      // porque a função fica presa à versão do segredo que existia quando ela
      // foi implantada. Quem troca e não reimplanta vê o mesmo 401 e conclui
      // que a chave nova também está errada.
      // 401 é chave recusada. 403 com corpo vazio, numa fonte cuja chave funciona
      // em outro caminho, é o gateway recusando o próprio caminho — dizer
      // "confira a chave" ali manda procurar no lugar errado, como já mandou.
      let dica = '';
      if (config.exigeChave && resposta.status === 401) {
        dica = ' — confira o valor guardado com `firebase functions:secrets:access CHAVE_PORTAL_TRANSPARENCIA`;'
          + ' se precisar trocá-lo, reimplante a função depois, senão ela continua usando o valor antigo.';
      } else if (resposta.status === 403 && !corpo.trim()) {
        dica = ' — 403 sem explicação costuma ser caminho inexistente:'
          + ` a fonte não reconhece ${sufixo || config.base.split('/').pop()}.`;
      }

      throw new HttpsError('unavailable',
        `${fonte} respondeu ${resposta.status}: ${corpo.slice(0, 300)}${dica}`);
    }

    let dados;
    try {
      dados = JSON.parse(corpo);
    } catch {
      throw new HttpsError('internal',
        `${fonte} devolveu algo que não é JSON: ${corpo.slice(0, 200)}`);
    }

    // A URL volta sem a chave — ela nunca entra na query, mas o hábito de
    // conferir o que se devolve vale mais do que a certeza.
    return { fonte, quantidade: Array.isArray(dados) ? dados.length : 1, dados };
  },
);
