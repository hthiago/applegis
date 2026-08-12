/**
 * Os temas com que a Câmara classifica as proposições.
 *
 * Dois problemas vinham daqui, e o primeiro foi criado por mim: as primeiras
 * importações guardaram os vários temas de uma proposição num texto só,
 * separados por vírgula. Como os nomes oficiais *contêm* vírgula — "Ciência,
 * Tecnologia e Inovação" é um tema, não três —, esse texto não pode ser
 * repartido por pontuação sem destruir o significado. Repartir pelo vocabulário
 * oficial resolve, e resolve também para os registros já gravados, sem precisar
 * baixar tudo de novo.
 *
 * O segundo é de leitura. Os nomes oficiais são longos e começam parecidos, o
 * que faz uma lista de grupos virar uma parede de texto quase idêntico. Cada
 * tema ganha aqui uma forma curta, que é o que aparece na tela; o nome oficial
 * continua sendo o que se guarda e o que se compara.
 */

export const TEMAS = [
  { nome: 'Administração Pública', curto: 'Administração pública' },
  { nome: 'Agricultura, Pecuária, Pesca e Extrativismo', curto: 'Agropecuária' },
  { nome: 'Arte, Cultura e Religião', curto: 'Cultura e religião' },
  { nome: 'Assistência Social', curto: 'Assistência social' },
  { nome: 'Ciência, Tecnologia e Inovação', curto: 'Ciência e tecnologia' },
  { nome: 'Cidades e Desenvolvimento Urbano', curto: 'Cidades' },
  { nome: 'Comunicações', curto: 'Comunicações' },
  { nome: 'Defesa e Segurança', curto: 'Defesa e segurança' },
  { nome: 'Direito Civil e Processual Civil', curto: 'Direito civil' },
  { nome: 'Direito Constitucional', curto: 'Direito constitucional' },
  { nome: 'Direito do Consumidor', curto: 'Consumidor' },
  { nome: 'Direito e Defesa do Consumidor', curto: 'Consumidor' },
  { nome: 'Direito e Justiça', curto: 'Direito e justiça' },
  { nome: 'Direito Penal e Processual Penal', curto: 'Direito penal' },
  { nome: 'Direito Processual Penal', curto: 'Direito penal' },
  { nome: 'Direitos Humanos e Minorias', curto: 'Direitos humanos' },
  { nome: 'Economia', curto: 'Economia' },
  { nome: 'Educação', curto: 'Educação' },
  { nome: 'Energia, Recursos Hídricos e Minerais', curto: 'Energia e recursos' },
  { nome: 'Esporte e Lazer', curto: 'Esporte e lazer' },
  { nome: 'Estrutura Fundiária', curto: 'Estrutura fundiária' },
  { nome: 'Finanças Públicas e Orçamento', curto: 'Orçamento' },
  { nome: 'Homenagens e Datas Comemorativas', curto: 'Homenagens' },
  { nome: 'Indústria, Comércio e Serviços', curto: 'Indústria e comércio' },
  { nome: 'Meio Ambiente e Desenvolvimento Sustentável', curto: 'Meio ambiente' },
  { nome: 'Política, Partidos e Eleições', curto: 'Política e eleições' },
  { nome: 'Previdência e Assistência Social', curto: 'Previdência' },
  { nome: 'Processo Legislativo e Atuação Parlamentar', curto: 'Processo legislativo' },
  { nome: 'Relações Internacionais e Comércio Exterior', curto: 'Relações exteriores' },
  { nome: 'Saúde', curto: 'Saúde' },
  { nome: 'Segurança Pública', curto: 'Segurança pública' },
  { nome: 'Trabalho e Emprego', curto: 'Trabalho' },
  { nome: 'Turismo', curto: 'Turismo' },
  { nome: 'Viação, Transporte e Mobilidade', curto: 'Transporte' },
];

/**
 * Do mais longo para o mais curto. "Direito Penal e Processual Penal" precisa
 * ser reconhecido antes de "Direito", senão a repartição para no meio do nome.
 */
const POR_TAMANHO = [...TEMAS].sort((a, b) => b.nome.length - a.nome.length);

const CURTOS = new Map(TEMAS.map((t) => [t.nome.toLocaleLowerCase('pt-BR'), t.curto]));

/** Comparação que ignora caixa e acento, sem alterar o tamanho do texto. */
function comecaCom(texto, prefixo) {
  if (texto.length < prefixo.length) return false;
  return texto.slice(0, prefixo.length)
    .localeCompare(prefixo, 'pt-BR', { sensitivity: 'base' }) === 0;
}

/**
 * Reparte um valor de tema na lista de temas oficiais que o compõem.
 *
 * Aceita tanto a lista já separada quanto o texto antigo com tudo junto. O que
 * não estiver no vocabulário é preservado como veio — a Câmara pode acrescentar
 * um tema novo, e perder o dado seria pior do que exibi-lo sem forma curta.
 */
export function separarTemas(valor) {
  if (valor === null || valor === undefined || valor === '') return [];
  if (Array.isArray(valor)) return valor.flatMap((v) => separarTemas(v));

  let resto = String(valor).trim();
  const achados = [];

  while (resto) {
    const conhecido = POR_TAMANHO.find((t) => comecaCom(resto, t.nome));
    if (conhecido) {
      achados.push(conhecido.nome);
      resto = resto.slice(conhecido.nome.length);
    } else {
      // Desconhecido: corta na próxima vírgula. Pode partir um nome composto
      // que ainda não conhecemos, e é o melhor palpite possível.
      const corte = resto.indexOf(',');
      achados.push((corte === -1 ? resto : resto.slice(0, corte)).trim());
      resto = corte === -1 ? '' : resto.slice(corte);
    }
    resto = resto.replace(/^\s*,\s*/, '').trim();
  }

  return achados.filter(Boolean);
}

/** A forma curta de um tema, ou o próprio nome quando não é do vocabulário. */
export function temaCurto(nome) {
  return CURTOS.get(String(nome || '').toLocaleLowerCase('pt-BR')) || String(nome || '');
}

/** Todos os temas de um registro, já na forma curta e sem repetição. */
export function temasCurtos(valor) {
  return [...new Set(separarTemas(valor).map(temaCurto))];
}

/**
 * O tema pela qual a proposição é agrupada. A Câmara devolve os temas em
 * ordem, e o primeiro é o principal — usar só ele garante que cada proposição
 * apareça num grupo só.
 */
export function temaPrincipal(valor) {
  return temasCurtos(valor)[0] || null;
}
