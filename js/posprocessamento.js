import { numeroBr } from './planilha.js';

/**
 * Pós-processamento dos destinos de emenda.
 *
 * O problema que este arquivo resolve: as bases federais respondem em grão de
 * documento contábil, e eu vinha gravando cada documento como se fosse um
 * destino. Uma emenda de saúde executada em doze parcelas gera dezenas de
 * empenhos, liquidações e pagamentos — quase todos sem favorecido e sem valor no
 * índice — e o resultado foram milhares de linhas vazias, um filtro com 5752
 * "sem classificação" e nomes de banco ocupando a coluna de município.
 *
 * A fase aqui é a que faltava entre "buscar" e "mostrar". Ela faz três coisas:
 *
 *   1. Classifica o destino. "MUNICIPIO DE ERECHIM" é um município;
 *      "FUNDO MUNICIPAL DE SAUDE DE ANTA GORDA" também é, com o nome do fundo
 *      guardado à parte; "BANCO DO BRASIL SA" não é destino nenhum — é o
 *      intermediário que operacionaliza o repasse; "ASSOCIACAO BENEFICENTE
 *      HOSPITAL SANTO ANTONIO" é entidade, e seu município não está no nome.
 *
 *   2. Reúne os documentos de um mesmo destino numa linha só, somando por fase.
 *      Empenho, liquidação e pagamento do mesmo dinheiro deixam de ser três
 *      linhas e passam a ser três colunas — que é a leitura de "já foi pago?".
 *
 *   3. Classifica a situação. Toda linha sai daqui com destino e situação
 *      preenchidos, e é isso que faz o filtro voltar a servir para filtrar.
 */

// ───────────────────────── classificação do destino ─────────────────────────

/**
 * Quem aparece como favorecido sem ser destino.
 *
 * Num repasse a município, o favorecido do documento no SIAFI é o banco. Ele
 * não recebeu a emenda: passou o dinheiro adiante. Tratá-lo como destino punha
 * "BANCO DO BRASIL SA" na coluna de município e somava a ele o repasse de
 * dezenas de cidades.
 */
const INTERMEDIARIOS = [
  /^banco\s+(do\s+brasil|da\s+amazonia|do\s+nordeste)/i,
  /^caixa\s+econ[oô]mica/i,
  /^b\.?\s*b\.?\s*s\.?a\.?$/i,
];

/** Padrões que revelam o município dentro do nome do favorecido. */
const DE = '(?:de\\s+|do\\s+|da\\s+|dos\\s+|das\\s+)?';
const NO_NOME = [
  { re: new RegExp(`^munic[íi]pio\\s+${DE}(.+)$`, 'i'), tipo: 'municipio' },
  { re: new RegExp(`^prefeitura(?:\\s+municipal)?\\s+${DE}(.+)$`, 'i'), tipo: 'municipio' },
  { re: new RegExp(`^c[âa]mara\\s+municipal\\s+${DE}(.+)$`, 'i'), tipo: 'municipio' },
  // O fundo municipal é o caixa do município: o destino é a cidade, e o nome do
  // fundo diz por qual porta o dinheiro entrou.
  { re: new RegExp(`^fundo\\s+municipal\\s+.*?\\s+${DE}([^-]+)$`, 'i'), tipo: 'municipio' },
  { re: new RegExp(`^(?:secretaria|fundo)\\s+municipal\\s+${DE}(.+)$`, 'i'), tipo: 'municipio' },
];

const ESTADUAIS = [
  /^estado\s+d/i,
  /^governo\s+d/i,
  /^fundo\s+estadual/i,
  /^secretaria\s+(?:de\s+)?estado/i,
  /^universidade\s+(?:estadual|federal)/i,
];

const ENTIDADES = [
  /associa[çc][ãa]o/i, /funda[çc][ãa]o/i, /instituto/i, /hospital/i, /santa\s+casa/i,
  /sociedade/i, /benefic[êe]nte/i, /benefic[ei]nte/i, /apae/i, /consorcio/i,
  /cons[óo]rcio/i, /coopera/i, /sindicato/i, /igreja/i, /centro\s+(?:social|comunit)/i,
];

const UNIAO = [/^minist[ée]rio/i, /^uni[ãa]o$/i, /^fundo\s+nacional/i, /^ag[êe]ncia\s+nacional/i];

/**
 * O que é aquele nome, e qual município ele implica.
 *
 * Devolver sempre um tipo é o ponto: linha sem classificação virou o filtro de
 * 5752 opções vazias, que não filtra nada. "Indefinido" é uma resposta; ausência
 * de resposta, não.
 */
export function classificarDestino(nome) {
  const bruto = String(nome ?? '').trim().replace(/\s+/g, ' ');
  if (!bruto) return { tipo: 'indefinido', municipio: null, entidade: null };

  if (INTERMEDIARIOS.some((re) => re.test(bruto))) {
    return { tipo: 'intermediario', municipio: null, entidade: bruto };
  }
  if (UNIAO.some((re) => re.test(bruto))) {
    return { tipo: 'uniao', municipio: null, entidade: bruto };
  }
  if (ESTADUAIS.some((re) => re.test(bruto))) {
    return { tipo: 'estado', municipio: null, entidade: bruto };
  }

  for (const { re, tipo } of NO_NOME) {
    const m = re.exec(bruto);
    if (m) {
      const cidade = limparNomeDeCidade(m[1]);
      if (cidade) return { tipo, municipio: cidade, entidade: bruto };
    }
  }

  if (ENTIDADES.some((re) => re.test(bruto))) {
    return { tipo: 'entidade', municipio: null, entidade: bruto };
  }
  return { tipo: 'indefinido', municipio: null, entidade: bruto };
}

/**
 * Tira do nome da cidade o que não é nome de cidade.
 *
 * "MUNICIPIO DE ERECHIM - RS" e "FUNDO MUNICIPAL DE SAUDE DE ANTA GORDA/RS"
 * trazem a UF colada. Um nome de duas letras é UF, não cidade.
 */
export function limparNomeDeCidade(texto) {
  let t = String(texto ?? '').trim()
    .replace(/\s*[-/]\s*[A-Za-z]{2}$/, '')
    .replace(/\s*\(.*?\)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  // "SAUDE DE ANTA GORDA" ainda carrega a área na frente quando o fundo tem nome
  // composto; o que interessa é o trecho depois do último " DE ".
  if (/^(sa[úu]de|educa[çc][ãa]o|assist[êe]ncia\s+social|cultura|esporte)\s+de\s+/i.test(t)) {
    t = t.replace(/^.*?\s+de\s+/i, '').trim();
  }
  if (t.length < 3) return null;
  return t;
}

// ───────────────────── reunião dos documentos por destino ─────────────────────

const FASE = { empenho: 'valorEmpenhado', liquidacao: 'valorLiquidado', pagamento: 'valorPago' };
const IMPEDIDO = /impedi|indefer|cancelad|devolvid/i;

/** Como as fases somadas se traduzem em uma resposta sobre o repasse. */
export function situacaoDaExecucao({
  valorDestinado = 0, valorEmpenhado = 0, valorPago = 0, situacao = '',
}) {
  if (IMPEDIDO.test(situacao || '')) return 'impedido';
  if (valorPago && valorPago >= (valorEmpenhado || valorPago)) return 'pago';
  if (valorPago) return 'pago-parcial';
  if (valorEmpenhado) return 'empenhado';
  if (valorDestinado) return 'destinado';
  return 'sem-execucao';
}

/** A chave do destino: quem recebeu, dentro de qual emenda. */
export function chaveDoDestino(linha) {
  const emenda = String(linha.codigoEmenda || 'sem-emenda').replace(/\D/g, '') || 'sem-emenda';
  const classe = classificarDestino(linha.favorecido);

  // O banco nunca dá nome ao destino.
  //
  // Ninguém destina emenda ao Banco do Brasil — mas no documento de pagamento
  // do SIAFI é o nome dele que aparece, porque é ele quem opera o repasse.
  // A versão anterior caía no nome do favorecido quando não havia município, e
  // o banco virava um destino: como todo repasse passa por ele, virava *o
  // maior* destino do mandato. Um número que ninguém sabe explicar numa
  // reunião é pior que um número ausente.
  //
  // Quando o município é conhecido, a linha se junta a ele. Quando não é, ela
  // se junta às outras linhas de banco da mesma emenda, num grupo que se chama
  // pelo que de fato se sabe: destino não identificado.
  if (classe.tipo === 'intermediario') {
    const onde = linha.municipio || classe.municipio;
    return `${emenda}|${onde ? chavear(onde) : 'SEMDESTINOIDENTIFICADO'}`;
  }

  // Quando o destino é a própria cidade, a chave é a cidade — e não o nome que
  // o documento usou para ela. "MUNICIPIO DE MUÇUM" no empenho e um pagamento
  // via Caixa com município MUÇUM são o mesmo dinheiro em duas fases; com o
  // nome do favorecido como chave, viravam duas linhas e a escada do dinheiro
  // se perdia, que é justamente o que esta reunião existe para evitar.
  if (classe.tipo === 'municipio') {
    const onde = classe.municipio || linha.municipio;
    if (onde) return `${emenda}|${chavear(onde)}`;
  }

  // Fora isso, o favorecido manda: dois executores da mesma cidade são dois
  // destinos, com objetos diferentes.
  const quem = linha.favorecido
    || linha.municipio
    || classe.municipio
    || classe.entidade
    || 'sem-destino';
  return `${emenda}|${chavear(quem)}`;
}

const chavear = (t) => String(t).toUpperCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]/g, '');

/** O texto mais informativo entre os candidatos: o mais longo que não é vazio. */
function maisDescritivo(valores) {
  return valores
    .filter((v) => typeof v === 'string' && v.trim())
    .sort((a, b) => b.length - a.length)[0] || null;
}

/**
 * Reúne os documentos de um mesmo destino numa linha só.
 *
 * Uma emenda de saúde paga em doze parcelas gerava dezenas de linhas, quase
 * todas sem nada além de fase e data. Aqui elas viram uma linha por destino, com
 * as fases somadas em colunas próprias — e a contagem de documentos preservada,
 * porque "foi pago em doze parcelas" é informação, não ruído.
 */
export function reunirDestinos(linhas) {
  const grupos = new Map();

  for (const linha of linhas) {
    const chave = chaveDoDestino(linha);
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(linha);
  }

  const saida = [];
  for (const [chave, doGrupo] of grupos) {
    const classe = classificarDestino(
      doGrupo.map((l) => l.favorecido).find(Boolean) || '',
    );
    const municipio = doGrupo.map((l) => l.municipio).find(Boolean) || classe.municipio || null;
    // A regra é por linha, não por grupo: nenhuma linha cujo favorecido seja
    // banco contribui para "quem recebeu". Se sobrar alguém de verdade no
    // grupo, é ele; se não sobrar ninguém, não se sabe quem recebeu — e é isso
    // que a linha vai dizer.
    const daLinha = (l) => classificarDestino(l.favorecido).tipo === 'intermediario';
    const recebedor = doGrupo.filter((l) => !daLinha(l)).map((l) => l.favorecido).find(Boolean) || null;
    const banco = doGrupo.filter(daLinha).map((l) => l.favorecido).find(Boolean) || null;
    // Só é "destino não identificado" quando não se sabe nem quem nem onde. Um
    // pagamento via banco com o município conhecido é um repasse àquela cidade
    // — o banco é o caminho, não a incógnita.
    const viaBanco = !recebedor && !!banco && !municipio;

    const destino = {
      id: `d-${chave.toLowerCase().replace(/\|/g, '-').slice(0, 120)}`,
      codigoEmenda: doGrupo.map((l) => l.codigoEmenda).find(Boolean) || null,
      modalidade: doGrupo.map((l) => l.modalidade || l.tipo).find((t) => t && !FASE[t]) || 'execucao',
      // O tipo diz o que é quem recebeu; o município diz onde.
      //
      // Quando o nome já revela a natureza — associação, hospital, estado —,
      // ela manda: marcar como "Município" todo destino com cidade conhecida
      // punha o Hospital Santo Antônio no mesmo balde da prefeitura, e o filtro
      // "Tipo de destino" deixava de separar as duas coisas que o gabinete mais
      // precisa separar.
      //
      // Quando o nome não revela nada — banco, ou nome irreconhecível —, o que
      // se sabe é a cidade, e é ela que classifica. Um repasse a Erechim pago
      // pelo Banco do Brasil é um repasse a Erechim.
      destinoTipo: (classe.tipo === 'intermediario' || classe.tipo === 'indefinido') && municipio
        ? 'municipio'
        : classe.tipo,
      municipio,
      uf: doGrupo.map((l) => l.uf).find(Boolean) || null,
      // Quem recebeu fica vazio quando só se sabe por qual banco passou. Pôr o
      // nome do banco ali é responder "quem recebeu?" com uma informação que
      // não é a resposta — e que soma, ordena e engana.
      favorecido: recebedor,
      favorecidoIntermediario: banco
        || doGrupo.map((l) => l.favorecidoIntermediario).find(Boolean) || null,
      favorecidoDoc: doGrupo.map((l) => l.favorecidoDoc).find(Boolean) || null,
      objeto: maisDescritivo(doGrupo.map((l) => l.objeto)),
      metas: maisDescritivo(doGrupo.map((l) => l.metas)),
      area: doGrupo.map((l) => l.area).find(Boolean) || null,
      subfuncao: doGrupo.map((l) => l.subfuncao).find(Boolean) || null,
      acao: doGrupo.map((l) => l.acao).find(Boolean) || null,
      localizador: doGrupo.map((l) => l.localizador).find(Boolean) || null,
      processo: doGrupo.map((l) => l.processo).find(Boolean) || null,
      proposta: doGrupo.map((l) => l.proposta).find(Boolean) || null,
      situacao: maisDescritivo(doGrupo.map((l) => l.situacao)),
      valorDestinado: 0,
      valorEmpenhado: 0,
      valorLiquidado: 0,
      valorPago: 0,
      valorCusteio: doGrupo.reduce((s, l) => s + (numeroBr(l.valorCusteio) || 0), 0) || null,
      valorInvestimento: doGrupo.reduce((s, l) => s + (numeroBr(l.valorInvestimento) || 0), 0) || null,
      qtdDocumentos: 0,
      documentos: null,
      primeiraData: null,
      ultimaData: null,
      fonte: doGrupo.map((l) => l.fonte).find(Boolean) || null,
    };

    const numeros = [];
    const datas = [];
    for (const l of doGrupo) {
      const valor = numeroBr(l.valor) || 0;
      const campo = FASE[l.tipo];
      if (campo) destino[campo] += valor;
      else destino.valorDestinado += valor;
      if (l.documento) { numeros.push(l.documento); destino.qtdDocumentos += 1; }
      if (l.data) datas.push(l.data);
    }

    datas.sort();
    destino.primeiraData = datas[0] || null;
    destino.ultimaData = datas[datas.length - 1] || null;
    destino.documentos = numeros.length ? [...new Set(numeros)].slice(0, 40).join(' · ') : null;
    destino.valor = destino.valorPago || destino.valorEmpenhado || destino.valorDestinado || null;
    destino.situacaoExecucao = situacaoDaExecucao(destino);

    // O dinheiro passou pelo banco e a linha fica — tirá-la faria o total
    // encolher sem explicação. O que muda é o que ela diz de si: não "o Banco
    // do Brasil recebeu", e sim "saiu por este banco, e a fonte não informou
    // para quem". A diferença é entre um número errado e um número honesto.
    if (viaBanco) {
      destino.destinoTipo = 'intermediario';
      // Uma linha em branco com R$ 900 mil ao lado é pior que o nome do banco:
      // parece defeito. "Destino não identificado" não é nome de ninguém — é a
      // resposta certa para "quem recebeu?" quando a fonte não informou.
      destino.favorecido = 'Destino não identificado';
      destino.objeto = destino.objeto
        || `Repasse operado por ${destino.favorecidoIntermediario || 'instituição financeira'} — destino final não informado no documento`;
    }

    saida.push(destino);
  }

  return saida.sort((a, b) => (b.valor || 0) - (a.valor || 0));
}

/**
 * Linha que não informa nada e não soma nada.
 *
 * Só é descartada quando as duas coisas são verdade ao mesmo tempo: sem valor em
 * fase alguma e sem quem recebeu. Um empenho sem valor mas com favorecido ainda
 * prova que houve empenho para alguém; um valor sem favorecido ainda é dinheiro
 * que saiu. É a conjunção que não informa nada.
 */
export function vazia(destino) {
  const semValor = !destino.valorDestinado && !destino.valorEmpenhado
    && !destino.valorLiquidado && !destino.valorPago;
  // Intermediário sem município é um carimbo de banco sem destino conhecido:
  // não diz quem recebeu. É esse o caso que enchia a tela de linhas em branco.
  const semQuem = !destino.municipio
    && (!destino.favorecido || destino.destinoTipo === 'intermediario');
  // Mas os documentos não se jogam fora. Reunidos, catorze empenhos sem destino
  // identificado são UMA linha que diz "catorze documentos, destino a resolver"
  // — e é ela que permite tentar de novo. Descartá-los faria a falha de uma
  // consulta apagar em definitivo a prova de que a execução existe.
  return semValor && semQuem && !destino.qtdDocumentos;
}
