import { lerPlanilha, chaveDoRotulo, numeroBr } from './planilha.js';
import { classificarDestino, situacaoDaExecucao } from './posprocessamento.js';
import { normalizarCodigo } from './emendas.js';

/**
 * Importa a planilha exportada do painel de transferências do SERPRO.
 *
 * Por que este caminho existe, depois de tanto esforço em API: o painel tem um
 * botão de exportar, e o que ele exporta é exatamente a junção que custou
 * semanas montar a partir das tabelas cruas — emenda, instrumento, município,
 * proponente, objeto, empenhado e desembolsado, tudo numa linha só, já ligado.
 * Três cliques do gabinete valem mais que qualquer integração que eu escreva às
 * cegas contra um serviço que este ambiente não alcança.
 *
 * O arquivo vem em .xlsx, e era isso que travava: o leitor tratava tudo como
 * texto e devolvia "o arquivo está vazio ou não é uma planilha de texto" — que
 * era verdade e não ajudava, porque o arquivo estava certo.
 *
 * Cada linha do painel é um DESTINO, não uma emenda. Uma emenda aparece em
 * várias linhas, uma por instrumento. Gravar isso como emenda multiplicaria a
 * mesma emenda por dez; por isso a importação escreve nos dois lugares — o
 * destino em `transferencias`, e a emenda consolidada em `emendas`.
 */

/** As colunas do painel, como ele as escreve. */
const COLUNAS = {
  autor: ['autor', 'parlamentar', 'nome parlamentar'],
  codigo: ['n emenda', 'no emenda', 'numero emenda', 'n da emenda', 'emenda'],
  ano: ['ano emenda', 'ano da emenda', 'ano'],
  instrumento: ['n instrumento', 'no instrumento', 'numero instrumento', 'instrumento', 'n convenio'],
  link: ['link', 'url'],
  situacao: ['situacao', 'situacao do instrumento', 'status'],
  modalidade: ['modalidade', 'tipo instrumento'],
  orgao: ['orgao concedente', 'concedente', 'orgao'],
  uf: ['uf', 'sigla uf'],
  municipio: ['municipio', 'nome municipio'],
  favorecido: ['nome proponente', 'proponente', 'convenente', 'beneficiario'],
  objeto: ['objeto', 'descricao do objeto'],
  valorEmpenhado: ['valor empenhado', 'empenhado'],
  // "Desembolsado" é o nome do pago no vocabulário do painel. Sem este sinônimo
  // toda linha entrava com pago zerado e a pergunta "já foi pago?" — que é a
  // razão de existir da aba — respondia errado em silêncio.
  valorPago: ['valor desembolsado', 'desembolsado', 'valor pago', 'pago'],
};

export function mapearColunasDoPainel(cabecalho) {
  const chaves = cabecalho.map(chaveDoRotulo);
  const mapa = {};
  for (const [campo, nomes] of Object.entries(COLUNAS)) {
    let i = chaves.findIndex((c) => nomes.includes(c));
    if (i === -1) i = chaves.findIndex((c) => nomes.some((n) => c === n || c.startsWith(`${n} `)));
    if (i !== -1) mapa[campo] = i;
  }
  return mapa;
}

/** Este arquivo é do painel? Só o layout dele tem instrumento e proponente juntos. */
export function ehDoPainel(cabecalho) {
  const m = mapearColunasDoPainel(cabecalho);
  return m.codigo !== undefined && m.municipio !== undefined
    && m.favorecido !== undefined && m.instrumento !== undefined;
}

/**
 * O código completo da emenda, a partir do número curto do painel.
 *
 * O painel escreve "41160007"; o Portal e o Transferegov escrevem
 * "202341160007" — ano na frente. Sem juntar os dois, a mesma emenda entra
 * duas vezes no sistema e nenhuma das duas bate com a outra fonte.
 */
export function codigoCompleto(numero, ano) {
  const n = String(numero ?? '').replace(/\D/g, '');
  const a = String(ano ?? '').replace(/\D/g, '').slice(0, 4);
  if (!n) return null;
  if (n.length >= 12) return normalizarCodigo(n);
  return a ? `${a}${n.padStart(8, '0')}` : n;
}

const MODALIDADES = [
  { re: /especial/i, v: 'especial' },
  { re: /fundo\s*a\s*fundo/i, v: 'fundoafundo' },
  { re: /conv[êe]nio|contrato\s*de\s*repasse|termo/i, v: 'convenio' },
];

export function modalidadeDe(texto) {
  return (MODALIDADES.find((m) => m.re.test(String(texto || ''))) || {}).v || 'execucao';
}

/** Uma linha do painel vira um destino do jeito que a aba Destinos já entende. */
export function destinoDaLinha(linha, mapa) {
  const campo = (nome) => (mapa[nome] === undefined ? '' : String(linha[mapa[nome]] ?? '').trim());

  const codigoEmenda = codigoCompleto(campo('codigo'), campo('ano'));
  if (!codigoEmenda) return null;

  const favorecido = campo('favorecido');
  const municipio = campo('municipio');
  const empenhado = numeroBr(campo('valorEmpenhado')) || 0;
  const pago = numeroBr(campo('valorPago')) || 0;
  const situacao = campo('situacao') || null;

  // O painel já diz o município, então não é preciso deduzi-lo do nome de quem
  // recebeu — que é onde a dedução erra. A classificação segue servindo para
  // separar prefeitura de entidade privada, que muda a conversa da visita.
  const classe = classificarDestino(favorecido);

  return {
    codigoEmenda,
    favorecido: favorecido || null,
    municipio: municipio || null,
    uf: campo('uf') || null,
    objeto: campo('objeto') || null,
    situacao,
    modalidade: modalidadeDe(campo('modalidade')),
    destinoTipo: classe.tipo === 'indefinido' && municipio ? 'entidade' : classe.tipo,
    valorEmpenhado: empenhado,
    valorPago: pago,
    // Empenhado zero com desembolso é comum aqui: o instrumento foi pago por
    // restos a pagar de um empenho de outro exercício. O valor que representa o
    // destino é o maior dos dois, e não a soma — somar contaria o mesmo real
    // duas vezes.
    valor: Math.max(empenhado, pago),
    situacaoExecucao: situacaoDaExecucao({ valorEmpenhado: empenhado, valorPago: pago, situacao }),
    instrumento: campo('instrumento') || null,
    proposta: campo('instrumento') || null,
    orgao: campo('orgao') || null,
    link: campo('link') || null,
    fonte: 'Painel de transferências (SERPRO/Transferegov)',
    importadoEm: new Date().toISOString().slice(0, 10),
  };
}

/**
 * A chave do destino nesta importação: o instrumento.
 *
 * Aqui ela não precisa ser deduzida como nas outras fontes — o painel dá o
 * número do instrumento, que é o identificador que o próprio governo usa. É a
 * chave mais estável que este projeto conseguiu até agora, e é o que garante
 * que reimportar atualize em vez de duplicar.
 */
export function chaveDoInstrumento(destino) {
  const inst = String(destino.instrumento || '').replace(/\D/g, '');
  if (inst) return `pnl-${inst}`;
  const quem = String(destino.favorecido || destino.municipio || 'sem-destino')
    .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').slice(0, 60);
  return `pnl-${String(destino.codigoEmenda || '').replace(/\D/g, '')}-${quem}`;
}

/**
 * Junta as linhas que são o mesmo instrumento.
 *
 * Um convênio pode ser custeado por duas emendas, e o painel repete a linha
 * inteira — mesmos valores — uma vez para cada. Somar as duas contaria o mesmo
 * repasse duas vezes: no arquivo do gabinete, R$ 1.056.193,40 da Secretaria da
 * Segurança apareciam dobrados em Porto Alegre.
 *
 * O dinheiro é do instrumento e se conta uma vez. As emendas que o custearam
 * ficam registradas todas — perder essa ligação seria trocar um erro por outro.
 */
export function reunirPorInstrumento(destinos) {
  const porChave = new Map();
  for (const d of destinos) {
    const chave = chaveDoInstrumento(d);
    if (!porChave.has(chave)) {
      porChave.set(chave, { ...d, codigos: new Set([d.codigoEmenda]) });
      continue;
    }
    const j = porChave.get(chave);
    j.codigos.add(d.codigoEmenda);
    // Os valores não se somam: a linha repetida traz os mesmos números. Fica o
    // maior, que cobre o caso de o painel truncar um deles.
    j.valorEmpenhado = Math.max(j.valorEmpenhado || 0, d.valorEmpenhado || 0);
    j.valorPago = Math.max(j.valorPago || 0, d.valorPago || 0);
    j.valor = Math.max(j.valorEmpenhado, j.valorPago);
  }

  return [...porChave.values()].map((d) => {
    const codigos = [...d.codigos].sort();
    const { codigos: _, ...resto } = d;
    return {
      ...resto,
      codigoEmenda: codigos[0],
      emendasDoInstrumento: codigos.length > 1 ? codigos.join(', ') : null,
      qtdEmendas: codigos.length,
      situacaoExecucao: situacaoDaExecucao({
        valorEmpenhado: resto.valorEmpenhado, valorPago: resto.valorPago, situacao: resto.situacao,
      }),
    };
  });
}

/**
 * A emenda consolidada a partir dos instrumentos dela.
 *
 * Instrumento custeado por mais de uma emenda não entra no total de nenhuma: o
 * painel não diz quanto cada emenda pôs, e repartir seria inventar o número.
 * Ele é contado à parte e declarado — a emenda mostra o que é dela com certeza,
 * e diz quantos instrumentos divide com outras.
 */
export function emendasDosDestinos(instrumentos, autor) {
  const porCodigo = new Map();
  const garantir = (codigo, uf) => {
    if (!porCodigo.has(codigo)) {
      porCodigo.set(codigo, {
        codigo,
        ano: Number(String(codigo).slice(0, 4)) || null,
        autor: autor || null,
        uf: uf || null,
        valorEmpenhado: 0,
        valorPago: 0,
        valorCompartilhado: 0,
        destinos: 0,
        instrumentosCompartilhados: 0,
        municipios: new Set(),
      });
    }
    return porCodigo.get(codigo);
  };

  for (const d of instrumentos) {
    const codigos = d.emendasDoInstrumento ? d.emendasDoInstrumento.split(', ') : [d.codigoEmenda];
    for (const codigo of codigos) {
      const e = garantir(codigo, d.uf);
      e.destinos += 1;
      if (d.municipio) e.municipios.add(d.municipio);
      if (codigos.length > 1) {
        e.instrumentosCompartilhados += 1;
        e.valorCompartilhado += Math.max(d.valorEmpenhado || 0, d.valorPago || 0);
      } else {
        e.valorEmpenhado += d.valorEmpenhado || 0;
        e.valorPago += d.valorPago || 0;
      }
    }
  }

  return [...porCodigo.values()].map((e) => {
    const { municipios, ...resto } = e;
    const lista = [...municipios];
    return {
      ...resto,
      // Uma emenda para vinte cidades não tem "um" município: dizer qual seria
      // escolher um por acaso. O número de cidades responde melhor.
      municipio: lista.length === 1 ? lista[0] : null,
      qtdMunicipios: lista.length,
      fase: resto.valorPago ? 'execucao' : 'liberada',
      fonte: 'Painel de transferências (SERPRO/Transferegov)',
    };
  });
}

/**
 * Lê o arquivo e grava.
 *
 * O autor não é filtrado: o painel já exporta a seleção que a pessoa fez nele.
 * Filtrar de novo aqui, por um nome que pode estar grafado de outro jeito no
 * cadastro do gabinete, só criaria uma forma nova de a importação devolver zero
 * sem explicar por quê.
 */
export async function importarDoPainel(arquivo) {
  const { cabecalho, linhas } = await lerPlanilha(arquivo);
  if (!cabecalho.length) throw new Error('O arquivo está vazio.');

  const mapa = mapearColunasDoPainel(cabecalho);
  if (!ehDoPainel(cabecalho)) {
    throw new Error(`Não reconheci o formato do painel em "${cabecalho.slice(0, 6).join(', ')}…". Esperava as colunas Nº Emenda, Nº Instrumento, Município e Nome Proponente — é a exportação da tabela "Lista de emendas com instrumentos celebrados".`);
  }

  const lidos = linhas.map((l) => destinoDaLinha(l, mapa)).filter(Boolean);
  if (!lidos.length) throw new Error('O arquivo tem cabeçalho reconhecido, mas nenhuma linha com número de emenda.');
  const destinos = reunirPorInstrumento(lidos);

  const autor = (() => {
    const i = mapa.autor;
    if (i === undefined) return null;
    const nomes = [...new Set(linhas.map((l) => String(l[i] ?? '').trim()).filter(Boolean))];
    return nomes.length === 1 ? nomes[0] : null;
  })();

  const emendas = emendasDosDestinos(destinos, autor);
  const { salvarEmLote } = await import('./dados.js');

  const gravaDestinos = await salvarEmLote('transferencias',
    destinos.map((d) => ({ id: chaveDoInstrumento(d), dados: d })));
  if (gravaDestinos.falhas.length) throw gravaDestinos.falhas[0];

  const gravaEmendas = await salvarEmLote('emendas',
    emendas.map((e) => ({ id: e.codigo, dados: e })));
  if (gravaEmendas.falhas.length) throw gravaEmendas.falhas[0];

  return {
    linhas: linhas.length,
    destinos: destinos.length,
    emendas: emendas.length,
    autor,
    // Dito em vez de silenciado: "198 linhas viraram 196 destinos" parece perda
    // de dado se ninguém explicar que duas linhas eram o mesmo convênio.
    repetidos: lidos.length - destinos.length,
    compartilhados: destinos.filter((d) => d.qtdEmendas > 1).length,
    municipios: new Set(destinos.map((d) => d.municipio).filter(Boolean)).size,
    empenhado: destinos.reduce((t, d) => t + (d.valorEmpenhado || 0), 0),
    pago: destinos.reduce((t, d) => t + (d.valorPago || 0), 0),
    semMunicipio: destinos.filter((d) => !d.municipio).length,
  };
}
