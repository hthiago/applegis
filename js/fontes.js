import { CONSULTA_AUTOMATICA } from './config.js';

/**
 * Se as Cloud Functions estão no ar.
 *
 * Aqui morava a ponte de consulta às bases de execução orçamentária. Ela saiu
 * junto com as importações automáticas de emenda: as emendas passaram a entrar
 * por uma planilha exportada do painel de transferências, que chega pronta e
 * conferível, sem chave, sem cota e sem um serviço no meio do caminho.
 *
 * O que sobrou depende do servidor por um motivo só, e é um motivo que não tem
 * saída: a leitura de bilhete usa uma chave de API que não pode ficar em código
 * de navegador. Quem faz essa chamada é `passagens.js`; este arquivo só responde
 * se vale a pena oferecer o botão.
 */
export const disponivel = () => CONSULTA_AUTOMATICA;
