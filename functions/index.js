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
const CHAVE_CLAUDE = defineSecret('CHAVE_ANTHROPIC');
const CHAVE_OPENAI = defineSecret('CHAVE_OPENAI');

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
   * Onde NÃO está a emenda discriminada, para não se procurar ali de novo:
   * `/emendas/documentos` e `/emendas/documentos-impedimentos` respondem 403 com
   * corpo vazio, que no gateway do Portal significa caminho inexistente — não
   * chave recusada. `/despesas/documentos` existe, mas filtra por data de
   * emissão, não por emenda. Quem publica o detalhamento por beneficiário é o
   * Transferegov, em `transferenciasespeciais/plano_acao_especial`, alcançado
   * pela fonte exploratória abaixo.
   */
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
   * Onde a emenda aparece antes de virar documento de execução.
   *
   * O painel de emendas discricionárias do SERPRO e o SIOP mostram a emenda no
   * nível do orçamento — dotação, empenho por ação, impedimento —, que é um
   * andar acima do que o Portal publica. O gabinete perguntou se dá para puxar
   * dali; daqui não dá nem para olhar, porque o ambiente não alcança gov.br.
   *
   * Estas três entradas existem para a sondagem descobrir do navegador de quem
   * usa: o host continua sendo lista fechada, o caminho é peneirado como nas
   * demais, e nenhuma chave é enviada para eles. Se um deles responder JSON, a
   * integração deixa de ser palpite.
   */
  'serpro-painel': {
    base: 'https://dd-publico.serpro.gov.br',
    permiteSufixo: true,
    parametrosLivres: true,
    cabecalhos: () => ({}),
    exigeChave: false,
  },
  'siop-livre': {
    base: 'https://www.siop.planejamento.gov.br',
    permiteSufixo: true,
    parametrosLivres: true,
    cabecalhos: () => ({}),
    exigeChave: false,
  },
  /**
   * O catálogo federal de dados abertos: quem publica o quê, e em qual arquivo.
   * É a mesma lição do Transferegov — ler o catálogo em vez de adivinhar o
   * endereço —, agora um nível acima: em vez de descobrir o endpoint de uma
   * base, descobrir qual base tem o dado.
   */
  'dados-gov': {
    base: 'https://dados.gov.br',
    permiteSufixo: true,
    parametrosLivres: true,
    cabecalhos: () => ({}),
    exigeChave: false,
  },

  /**
   * A documentação da própria API, que é o fim do adivinhar.
   *
   * O Portal publica um OpenAPI com todos os endereços e todos os parâmetros de
   * cada um. Ele não fica sob `/api-de-dados`, e por isso a fonte acima não o
   * alcança: sair da base declarada é exatamente o que a peneira de caminho
   * impede, e com razão. Uma fonte separada, com a raiz do host, resolve sem
   * afrouxar nada — o host continua sendo o mesmo, e só ele.
   */
  'portal-doc': {
    base: 'https://api.portaldatransparencia.gov.br',
    permiteSufixo: true,
    parametrosLivres: true,
    cabecalhos: () => ({ 'chave-api-dados': CHAVE_PORTAL.value() }),
    exigeChave: true,
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
      // O limite de 40 caracteres no nome era meu, não da fonte, e recusava
      // calado nomes que o Transferegov usa de verdade —
      // `codigo_emenda_parlamentar_formatado_plano_acao` tem 46. Parâmetro
      // descartado em silêncio vira consulta sem filtro, que devolve a tabela
      // inteira e parece "não encontrei". O que precisa ser estreito aqui é o
      // conjunto de hosts, não o comprimento do nome da coluna.
      const aceito = config.parametrosLivres
        ? /^[a-zA-Z_][a-zA-Z0-9_]{0,79}$/.test(chave) && String(valor).length <= 200
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
      // A barra sozinha é um caminho legítimo: é onde um serviço PostgREST
      // publica o catálogo do que ele tem. A regra antiga exigia ao menos um
      // caractere depois dela e recusava calada justamente a consulta que
      // terminaria o adivinhar — o relatório dizia "caminho recusado" e eu li
      // como se a fonte tivesse recusado.
      if (!/^\/[A-Za-z0-9\-_/.]{0,120}$/.test(caminho) || caminho.includes('..')) {
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
      // Fonte fixa que devolve não-JSON é defeito: quem a consulta espera
      // registros. Fonte exploratória é outra coisa — ela existe para descobrir
      // o que há do outro lado, e um painel entrega HTML com o identificador do
      // aplicativo e o endereço do serviço dentro. Recusar esse texto seria
      // recusar justamente a resposta que se foi buscar.
      if (!config.parametrosLivres) {
        throw new HttpsError('internal',
          `${fonte} devolveu algo que não é JSON: ${corpo.slice(0, 200)}`);
      }
      return {
        fonte,
        quantidade: 0,
        dados: null,
        tipo: resposta.headers.get('content-type') || null,
        bruto: corpo.slice(0, 8000),
        tamanho: corpo.length,
      };
    }

    // A URL volta sem a chave — ela nunca entra na query, mas o hábito de
    // conferir o que se devolve vale mais do que a certeza.
    return { fonte, quantidade: Array.isArray(dados) ? dados.length : 1, dados };
  },
);


// ───────────────────── leitura de bilhete de passagem ─────────────────────

/**
 * Extrai os dados de uma passagem a partir da imagem do bilhete.
 *
 * O que isto substitui: alguém do gabinete recebe por WhatsApp a captura do
 * e-ticket e redigita origem, destino, data, hora, voo e localizador em dois
 * lugares — na planilha de viagens e na agenda. É transcrição, erra em número de
 * voo e horário, e o erro só aparece no aeroporto.
 *
 * Por que no servidor: a chave da API não pode ficar em código de navegador, pela
 * mesma razão que a do Portal não pode. E por que uma função separada da ponte de
 * consulta: aquela é um repassador que não interpreta nada, e esta interpreta —
 * misturá-las faria a mais perigosa das duas herdar a superfície da outra.
 *
 * O que a função NÃO faz: gravar. Ela devolve o que leu, com o grau de certeza de
 * cada campo, e quem confirma é a pessoa na tela. Leitura de imagem erra, e uma
 * viagem gravada sozinha com a data errada é pior que uma viagem não gravada.
 */
const ESQUEMA_PASSAGEM = {
  type: 'object',
  properties: {
    trechos: {
      type: 'array',
      description: 'Um por voo, na ordem em que aparecem. Ida e volta são dois trechos.',
      items: {
        type: 'object',
        properties: {
          passageiro: { type: ['string', 'null'] },
          companhia: { type: ['string', 'null'] },
          voo: { type: ['string', 'null'] },
          origem: { type: ['string', 'null'], description: 'Cidade ou aeroporto de partida, como escrito' },
          origemSigla: { type: ['string', 'null'], description: 'Sigla IATA de três letras, se visível' },
          destino: { type: ['string', 'null'] },
          destinoSigla: { type: ['string', 'null'] },
          data: { type: ['string', 'null'], description: 'AAAA-MM-DD. Se o ano não aparecer, deixe nulo em vez de supor.' },
          horaPartida: { type: ['string', 'null'], description: 'HH:MM em 24 horas' },
          horaChegada: { type: ['string', 'null'] },
          localizador: { type: ['string', 'null'], description: 'Código de reserva, localizador ou e-ticket' },
          assento: { type: ['string', 'null'] },
          valor: { type: ['number', 'null'], description: 'Em reais, só se estiver escrito na imagem' },
        },
        required: ['passageiro', 'companhia', 'voo', 'origem', 'origemSigla', 'destino',
          'destinoSigla', 'data', 'horaPartida', 'horaChegada', 'localizador', 'assento', 'valor'],
        additionalProperties: false,
      },
    },
    ilegivel: {
      type: 'array',
      description: 'Campos que a imagem não permite ler com segurança. Preferir listar aqui a adivinhar.',
      items: { type: 'string' },
    },
  },
  required: ['trechos', 'ilegivel'],
  additionalProperties: false,
};

const INSTRUCAO_PASSAGEM = [
  'Você recebe a imagem de um bilhete aéreo, cartão de embarque ou e-ticket brasileiro.',
  'Extraia os dados exatamente como estão escritos. Não converta moeda, não traduza nomes de cidade,',
  'não complete o ano de uma data que não o mostra e não deduza o voo de volta a partir da ida.',
  'Campo que a imagem não permite ler com segurança vai em "ilegivel" e fica nulo — quem confere é uma',
  'pessoa, e um campo adivinhado passa por conferido enquanto um campo vazio pede atenção.',
].join(' ');

/**
 * Quem lê a imagem.
 *
 * Duas implementações, escolhidas pela chave que estiver cadastrada — OpenAI
 * primeiro, porque é a que o gabinete usa agora. Manter as duas custa pouco: a
 * parte difícil é o esquema e a instrução, que são as mesmas, e o que muda é o
 * formato do envelope. Arrancar uma para trocar de provedor obrigaria a
 * reescrever tudo na próxima troca — e "momentaneamente" é uma palavra que
 * costuma durar.
 *
 * O que as duas têm em comum, e é o que importa: a resposta é forçada a vir no
 * esquema declarado. Prosa livre obrigaria alguém a interpretar texto, e é aí que
 * uma data errada passa por conferida.
 */
const PROVEDORES = {
  openai: {
    disponivel: () => !!CHAVE_OPENAI.value(),
    modelo: () => process.env.MODELO_LEITURA || 'gpt-4o',
    async ler({ imagemBase64, tipoMime }) {
      const modelo = PROVEDORES.openai.modelo();
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${CHAVE_OPENAI.value()}`,
        },
        // Sem teto de tokens de propósito: o nome do parâmetro mudou entre
        // gerações de modelo, e a resposta já é limitada pelo esquema. Um
        // parâmetro recusado devolveria 400 sem relação com o bilhete.
        body: JSON.stringify({
          model: modelo,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: INSTRUCAO_PASSAGEM },
              { type: 'image_url', image_url: { url: `data:${tipoMime};base64,${imagemBase64}` } },
            ],
          }],
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'passagem', strict: true, schema: ESQUEMA_PASSAGEM },
          },
        }),
      });

      const corpo = await r.text();
      if (!r.ok) {
        throw new HttpsError('unavailable', `A leitura falhou (${r.status}): ${corpo.slice(0, 300)}`);
      }
      const dados = JSON.parse(corpo);
      const escolha = dados.choices?.[0]?.message;
      if (escolha?.refusal) {
        throw new HttpsError('failed-precondition', `A leitura foi recusada: ${escolha.refusal}`);
      }
      if (!escolha?.content) {
        throw new HttpsError('internal',
          'Não foi possível ler o bilhete nesta imagem. Tente uma captura mais nítida, ou preencha à mão.');
      }
      return { ...JSON.parse(escolha.content), modelo: dados.model || modelo };
    },
  },

  anthropic: {
    disponivel: () => !!CHAVE_CLAUDE.value(),
    modelo: () => process.env.MODELO_LEITURA || 'claude-opus-5',
    async ler({ imagemBase64, tipoMime }) {
      const modelo = PROVEDORES.anthropic.modelo();
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': CHAVE_CLAUDE.value(),
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: modelo,
          max_tokens: 4096,
          tools: [{
            name: 'registrar_passagem',
            description: 'Registra os trechos lidos do bilhete.',
            strict: true,
            input_schema: ESQUEMA_PASSAGEM,
          }],
          // Ferramenta forçada: é o que garante que a resposta volte no formato
          // que a tela sabe preencher, em vez de prosa que alguém teria de ler.
          tool_choice: { type: 'tool', name: 'registrar_passagem' },
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: tipoMime, data: imagemBase64 } },
              { type: 'text', text: INSTRUCAO_PASSAGEM },
            ],
          }],
        }),
      });

      const corpo = await r.text();
      if (!r.ok) {
        throw new HttpsError('unavailable', `A leitura falhou (${r.status}): ${corpo.slice(0, 300)}`);
      }
      const dados = JSON.parse(corpo);
      const uso = dados.content?.find((b) => b.type === 'tool_use');
      if (!uso?.input) {
        throw new HttpsError('internal',
          'Não foi possível ler o bilhete nesta imagem. Tente uma captura mais nítida, ou preencha à mão.');
      }
      return { ...uso.input, modelo: dados.model || modelo };
    },
  },
};

exports.lerPassagem = onCall(
  {
    region: 'southamerica-east1',
    secrets: [CHAVE_CLAUDE, CHAVE_OPENAI],
    timeoutSeconds: 120,
    memory: '512MiB',
    maxInstances: 3,
  },
  async (request) => {
    await conferirAcesso(request.auth);

    const { imagemBase64, tipoMime } = request.data || {};
    if (!imagemBase64 || typeof imagemBase64 !== 'string') {
      throw new HttpsError('invalid-argument', 'Envie a imagem do bilhete.');
    }
    // 5 MB em base64 são ~6,7 MB de texto. Acima disso não é captura de bilhete,
    // e o limite existe para a função não virar canal de upload.
    if (imagemBase64.length > 7_000_000) {
      throw new HttpsError('invalid-argument', 'A imagem é grande demais. Envie uma captura de tela do bilhete, não o PDF inteiro.');
    }
    const aceitos = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
    if (!aceitos.includes(tipoMime)) {
      throw new HttpsError('invalid-argument', `Formato não aceito: ${tipoMime}. Use PNG, JPEG ou WebP.`);
    }

    // A ordem é a preferência; a escolha é de quem cadastrou a chave. Dizer qual
    // provedor respondeu é o que permite entender uma leitura ruim depois.
    const escolhido = ['openai', 'anthropic'].find((n) => PROVEDORES[n].disponivel());
    if (!escolhido) {
      throw new HttpsError('failed-precondition',
        'Nenhuma chave de leitura cadastrada. Cadastre CHAVE_OPENAI ou CHAVE_ANTHROPIC no projeto e reimplante — veja o README, seção "Leitura de bilhetes".');
    }

    try {
      const lido = await PROVEDORES[escolhido].ler({ imagemBase64, tipoMime });
      return { ...lido, provedor: escolhido };
    } catch (erro) {
      if (erro instanceof HttpsError) throw erro;
      throw new HttpsError('unavailable', `A leitura não respondeu: ${erro.message}`);
    }
  },
);
