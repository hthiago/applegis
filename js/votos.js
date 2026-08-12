/**
 * Leitura política de uma votação.
 *
 * O voto cru — Sim ou Não — não diz nada sozinho. Votar "Sim" num requerimento
 * de retirada de pauta é votar *contra* a matéria que se retira; votar "Não"
 * num requerimento de urgência é *frear* o projeto sem se manifestar sobre o
 * mérito dele. Um histórico que registre apenas Sim e Não descreve o gabinete
 * ao contrário em boa parte das votações processuais — que são a maioria delas.
 *
 * Este arquivo faz duas coisas: descobre do que trata a votação a partir da
 * descrição que a Câmara publica, e traduz o voto em efeito sobre a matéria.
 *
 * As funções são puras de propósito: é a parte do sistema mais fácil de errar e
 * a única que dá para conferir sem depender da rede.
 */

/**
 * Natureza da votação, deduzida da descrição.
 *
 * A ordem importa: "Destaque para votação em separado da Emenda nº 3" é um
 * destaque, não uma emenda, e "Requerimento de retirada de pauta" é retirada de
 * pauta, não um requerimento genérico. A primeira que casar vence.
 */
export const NATUREZAS = [
  { v: 'retirada-pauta', l: 'Retirada de pauta', re: /retirad[ao]\s+de\s+pauta|retirar\s+.{0,25}\bda\s+pauta/i },
  { v: 'inversao-pauta', l: 'Inversão de pauta', re: /invers[ãa]o\s+.{0,15}pauta/i },
  { v: 'adiamento', l: 'Adiamento', re: /adiamento|adiar\s/i },
  { v: 'urgencia', l: 'Urgência', re: /urg[êe]ncia/i },
  { v: 'destaque', l: 'Destaque', re: /destaque|\bDVS\b|vota[çc][ãa]o\s+em\s+separado/i },
  { v: 'prejudicialidade', l: 'Prejudicialidade', re: /prejudicialidade|prejudicad/i },
  { v: 'encerramento', l: 'Encerramento de discussão', re: /encerramento\s+da\s+discuss/i },
  { v: 'recurso', l: 'Recurso', re: /\brecurso\b/i },
  { v: 'redacao-final', l: 'Redação final', re: /reda[çc][ãa]o\s+final/i },
  { v: 'emenda', l: 'Emenda ou substitutivo', re: /\bemenda|substitutivo|subemenda/i },
  { v: 'parecer', l: 'Parecer', re: /parecer/i },
  { v: 'merito', l: 'Mérito', re: /./ },
];

export function naturezaDe(descricao) {
  const texto = String(descricao || '');
  if (!texto.trim()) return 'merito';
  return (NATUREZAS.find((n) => n.re.test(texto)) || { v: 'merito' }).v;
}

export const VOTOS = [
  { v: 'sim', l: 'Sim', cor: 'ok' },
  { v: 'nao', l: 'Não', cor: 'critico' },
  { v: 'abstencao', l: 'Abstenção', cor: 'neutro' },
  { v: 'obstrucao', l: 'Obstrução', cor: 'atencao' },
  { v: 'ausente', l: 'Não registrou voto', cor: 'neutro' },
];

/** Normaliza o que a Câmara devolve em `tipoVoto`. */
export function votoDe(bruto) {
  const t = String(bruto || '').trim().toLowerCase();
  if (!t) return null;
  if (t.startsWith('sim')) return 'sim';
  if (t.startsWith('não') || t.startsWith('nao')) return 'nao';
  if (t.startsWith('absten')) return 'abstencao';
  if (t.startsWith('obstru')) return 'obstrucao';
  // "Artigo 17" é o voto de desempate do Presidente; e há registros de
  // presença sem manifestação. Nenhum dos dois é posição de mérito.
  return 'outro';
}

/**
 * Naturezas em que o "Sim" trava a matéria em vez de aprová-la.
 * Aprovar a retirada de pauta é tirar o projeto de votação.
 */
const SIM_TRAVA = ['retirada-pauta', 'adiamento', 'prejudicialidade'];

/** Naturezas em que o "Sim" empurra a matéria adiante sem julgar o conteúdo. */
const SIM_ACELERA = ['urgencia', 'encerramento', 'inversao-pauta'];

/** Naturezas em que o voto é sobre a matéria em si. */
const SOBRE_O_MERITO = ['merito', 'redacao-final', 'parecer'];

/**
 * A votação decide o conteúdo, e não o rito?
 *
 * Numa legislatura, requerimentos e questões de procedimento são a maioria
 * esmagadora do que se vota, e quase nada disso diz o que o mandato pensa sobre
 * um assunto. Peneirar por aqui — antes de gastar uma consulta por votação —
 * é o que torna o histórico viável de montar e legível de ler.
 */
export function ehMerito(natureza) {
  return SOBRE_O_MERITO.includes(natureza);
}

export const SENTIDOS = [
  { v: 'a-favor', l: 'A favor da matéria', cor: 'ok' },
  { v: 'contra', l: 'Contra a matéria', cor: 'critico' },
  { v: 'avancou', l: 'Favoreceu o andamento', cor: 'info' },
  { v: 'freou', l: 'Freou o andamento', cor: 'atencao' },
  { v: 'obstruiu', l: 'Obstrução', cor: 'atencao' },
  { v: 'absteve', l: 'Absteve-se', cor: 'neutro' },
  { v: 'ausente', l: 'Não registrou voto', cor: 'neutro' },
  { v: 'depende', l: 'Depende do teor', cor: 'neutro' },
];

/**
 * O que o voto fez com a matéria.
 *
 * Devolve `depende` — e não um palpite — quando a natureza não determina o
 * efeito: num destaque ou numa emenda, o sentido está no teor do que se
 * destacou, que a descrição não carrega. Errar para o lado da omissão é o
 * certo aqui: uma leitura política inventada é pior do que leitura nenhuma.
 */
export function sentidoDo(voto, natureza) {
  if (voto === 'ausente') return 'ausente';
  if (voto === 'obstrucao') return 'obstruiu';
  if (voto === 'abstencao') return 'absteve';
  if (voto !== 'sim' && voto !== 'nao') return 'depende';

  const sim = voto === 'sim';
  if (SIM_TRAVA.includes(natureza)) return sim ? 'freou' : 'avancou';
  if (SIM_ACELERA.includes(natureza)) return sim ? 'avancou' : 'freou';
  if (SOBRE_O_MERITO.includes(natureza)) return sim ? 'a-favor' : 'contra';
  return 'depende';
}

/**
 * Uma frase que diz o que aconteceu, para quem lê a lista sem abrir o item.
 * É o que transforma "Sim / Requerimento" em informação utilizável.
 */
/** O gênero das siglas, para a frase sair em português e não em formulário. */
const ARTIGOS = {
  PEC: 'a', MPV: 'a', MP: 'a', EMC: 'a', EMP: 'a', EMS: 'a', INC: 'a', PET: 'a',
};

const CONTRACOES = { 'de o': 'do', 'de a': 'da', 'em o': 'no', 'em a': 'na' };

function alvoDa(proposicao) {
  if (!proposicao) return { artigo: 'a', nome: 'matéria' };
  const sigla = String(proposicao).trim().split(/\s|\d/)[0].toUpperCase();
  return { artigo: ARTIGOS[sigla] || 'o', nome: String(proposicao) };
}

export function resumoDo({ voto, natureza, proposicao }) {
  const { artigo, nome } = alvoDa(proposicao);
  const alvo = `${artigo} ${nome}`;
  const com = (prep) => `${CONTRACOES[`${prep} ${artigo}`]} ${nome}`;
  const rotulo = (NATUREZAS.find((n) => n.v === natureza) || {}).l || 'Mérito';
  const sentido = sentidoDo(voto, natureza);

  const frases = {
    'a-favor': `Votou a favor ${com('de')}.`,
    contra: `Votou contra ${alvo}.`,
    freou: `Votou de modo a travar ${alvo} (${rotulo.toLowerCase()}).`,
    avancou: `Votou de modo a fazer ${alvo} avançar (${rotulo.toLowerCase()}).`,
    obstruiu: `Registrou obstrução ${com('em')}.`,
    absteve: `Absteve-se ${com('em')}.`,
    ausente: `Não registrou voto ${com('em')}.`,
    depende: `${rotulo} sobre ${alvo} — o efeito depende do teor.`,
  };
  return frases[sentido];
}

/**
 * O parlamentar acompanhou a orientação da própria bancada?
 * Devolve nulo quando não há orientação registrada, que é diferente de ter
 * seguido ou contrariado.
 */
export function seguiuOrientacao(voto, orientacao) {
  const o = votoDe(orientacao);
  if (!o || o === 'outro' || !voto || voto === 'ausente') return null;
  return voto === o;
}
