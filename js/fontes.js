import { funcoes, httpsCallable } from './firebase.js';
import { CONSULTA_AUTOMATICA } from './config.js';

/**
 * Chamada às bases externas, sempre pela ponte no servidor.
 *
 * O navegador não alcança o Portal da Transparência nem o Transferegov: o
 * primeiro exige uma chave que não pode ficar em código público, e nenhum dos
 * dois autoriza chamada vinda de outra origem. A função no servidor resolve as
 * duas coisas — e este arquivo é o único lugar do cliente que sabe disso.
 */

export const disponivel = () => CONSULTA_AUTOMATICA;

/** Recados das falhas previsíveis, dizendo o que fazer em cada uma. */
const RECADOS = {
  unauthenticated: 'Sua sessão expirou. Entre novamente.',
  'permission-denied': 'Esta conta não está autorizada a consultar as bases externas.',
  'failed-precondition':
    'A chave do Portal da Transparência ainda não foi cadastrada no projeto. Veja o README, seção "Consulta automática".',
  'not-found':
    'A função de consulta não foi encontrada. Confira se ela foi implantada e se a região em js/config.js é a mesma de functions/index.js.',
  'deadline-exceeded': 'A fonte demorou demais para responder. Tente de novo em instantes.',
  // "internal" é o que o SDK devolve quando a chamada nem chega à função —
  // tipicamente porque ela ainda não foi implantada. O código sozinho não diz
  // nada a quem está do outro lado da tela.
  internal:
    'A ponte no servidor não respondeu. Se as Cloud Functions ainda não foram implantadas, é isso — veja o README, seção "Consulta automática". Se já foram, o log mostra a causa: firebase functions:log',
};

export async function consultarFonte(fonte, parametros = {}, caminho = null) {
  if (!CONSULTA_AUTOMATICA) {
    throw new Error('A consulta automática está desligada. Ligue CONSULTA_AUTOMATICA em js/config.js depois de implantar as funções.');
  }

  try {
    const chamar = httpsCallable(funcoes, 'consultarFonte');
    const r = await chamar({ fonte, parametros, caminho });
    return r.data;
  } catch (erro) {
    // A mensagem da função já vem pronta e diz o que a fonte respondeu; só as
    // falhas de infraestrutura precisam de tradução.
    const recado = RECADOS[erro.code?.replace('functions/', '')];
    throw new Error(recado || erro.message || 'Não foi possível consultar a fonte.');
  }
}
