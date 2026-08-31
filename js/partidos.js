/**
 * A cor do partido, para o que a tela destaca.
 *
 * O sistema é de um gabinete, e gabinete tem partido. A cor institucional da
 * interface é azul — sóbria, e a mesma para todo mundo, porque a estrutura não
 * é do partido: é do mandato. O que muda é o **destaque**: a aba aberta, a área
 * em que se está, a ação principal. É ali que a identidade aparece, e ali só.
 *
 * As siglas abaixo são a identidade visual pública de cada partido. Onde a sigla
 * não estiver na lista, o destaque cai no azul da própria interface — nunca numa
 * cor inventada, porque cor de partido errada numa tela do gabinete é o tipo de
 * detalhe que alguém nota antes de qualquer outra coisa.
 *
 * As variações claras e escuras saem daqui por `color-mix`, e não por uma
 * segunda tabela escrita à mão: amarelo do PSOL e laranja do NOVO precisam de
 * escurecimentos diferentes para serem legíveis sobre papel, e calcular é mais
 * confiável do que adivinhar quarenta vezes.
 */
export const COR_DO_PARTIDO = {
  NOVO: '#FF6A13',
  PL: '#0D3B85',
  PT: '#C4122F',
  PSDB: '#0067B1',
  MDB: '#0A8F3C',
  UNIAO: '#1B3B6F',
  'UNIÃO': '#1B3B6F',
  PP: '#0F4C9C',
  REPUBLICANOS: '#0B5BA6',
  PSD: '#0E7C4A',
  PDT: '#D6001C',
  PSB: '#B8001F',
  PSOL: '#C9A500',
  PODE: '#0C4DA2',
  PCDOB: '#B01116',
  'PCDOB(*)': '#B01116',
  REDE: '#00A0DF',
  CIDADANIA: '#D4006A',
  AVANTE: '#0E7C4A',
  SOLIDARIEDADE: '#E56A00',
  PV: '#2E7D32',
  PROS: '#E56A00',
  PRD: '#12457E',
  DC: '#0B5BA6',
  PRTB: '#0B5BA6',
  MOBILIZA: '#0E7C4A',
  AGIR: '#0B5BA6',
  UP: '#B01116',
  PMB: '#0E7C4A',
};

/** A sigla como o TSE escreve, sem enfeite, para casar com a tabela. */
export function normalizarSigla(sigla) {
  return String(sigla ?? '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z]/g, '');
}

/** A cor de destaque de um partido, ou `null` quando não se sabe. */
export function corDoPartido(sigla) {
  const chave = normalizarSigla(sigla);
  if (!chave) return null;
  return COR_DO_PARTIDO[chave] || null;
}

/**
 * Pinta o destaque da interface com a cor do partido do gabinete.
 *
 * Escreve numa variável só, no elemento raiz: tudo que destaca — aba aberta,
 * área atual, ação principal, foco do teclado — lê dela. Trocar de gabinete
 * troca a cor da tela inteira sem tocar em nenhuma regra de estilo.
 */
export function aplicarCorDoPartido(gabinete) {
  const raiz = document.documentElement;
  const cor = corDoPartido(gabinete?.partido);
  if (cor) {
    raiz.style.setProperty('--destaque', cor);
    raiz.dataset.partido = normalizarSigla(gabinete.partido);
  } else {
    raiz.style.removeProperty('--destaque');
    delete raiz.dataset.partido;
  }
  return cor;
}
