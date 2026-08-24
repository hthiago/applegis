const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

/**
 * O que o gabinete precisa do servidor — e só isso.
 *
 * Aqui existia também uma ponte de consulta às bases de execução orçamentária:
 * Portal da Transparência, Transferegov, SIOP, painel do SERPRO. Ela saiu junto
 * com as importações automáticas de emenda. As emendas passaram a entrar por
 * uma planilha exportada do painel, que chega pronta e conferível, e uma ponte
 * que ninguém chama é superfície de ataque sem contrapartida — mesmo fechada
 * por lista de hosts e por lista de autorizados.
 *
 * Sobra a leitura de bilhete, que não tem como sair do servidor: a chave da API
 * não pode ficar em código de navegador.
 *
 * Depois de implantar isto, a chave do Portal pode ser removida do projeto:
 *   firebase functions:secrets:destroy CHAVE_PORTAL_TRANSPARENCIA
 */

initializeApp();

const CHAVE_CLAUDE = defineSecret('CHAVE_ANTHROPIC');
const CHAVE_OPENAI = defineSecret('CHAVE_OPENAI');

/** Quem pode usar: a mesma lista que abre o sistema, e mais ninguém. */
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


// ───────────────────── leitura de bilhete de passagem ─────────────────────

/**
 * Extrai os dados de uma passagem a partir da imagem do bilhete.
 *
 * O que isto substitui: alguém do gabinete recebe por WhatsApp a captura do
 * e-ticket e redigita origem, destino, data, hora, voo e localizador em dois
 * lugares — na planilha de viagens e na agenda. É transcrição, erra em número de
 * voo e horário, e o erro só aparece no aeroporto.
 *
 * Por que no servidor: a chave da API não pode ficar em código de navegador —
 * ficaria visível para qualquer visitante da página, com o custo correndo por
 * conta do gabinete.
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
