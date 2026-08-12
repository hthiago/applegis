import {
  decodificar, lerCsv, chaveDoRotulo, numeroBr, dataBr, mesmoNome, nomeParaBusca,
} from './planilha.js';

/**
 * Importação das emendas parlamentares a partir das planilhas oficiais.
 *
 * Por que planilha, e não consulta direta: a execução de emendas mora no Portal
 * da Transparência, no Transferegov e no Fundo Nacional de Saúde. Nenhum dos
 * três serve os dados a um site no navegador — o Portal exige chave de API, que
 * não pode ficar em código aberto ao público, e nenhum deles libera a chamada
 * de outra origem. Um sistema que dependesse disso só funcionaria com servidor
 * próprio no meio do caminho.
 *
 * A exportação em planilha, por outro lado, é pública, o gabinete já a baixa
 * hoje e ela traz exatamente os mesmos números. Ler o arquivo resolve o
 * problema real — saber o que foi empenhado, liquidado e pago — sem depender de
 * chave, de servidor ou de suposição sobre uma API que eu não consigo alcançar
 * daqui para conferir.
 *
 * Cada sistema nomeia suas colunas de um jeito. O mapa abaixo é a tradução, e é
 * ele que permite jogar qualquer um dos arquivos na mesma tela.
 */

/**
 * Sinônimos de cada campo, por sistema de origem. A comparação é por chave
 * normalizada e por conteúdo: "Valor Empenhado", "VALOR EMPENHADO" e
 * "Empenhado" caem todos no mesmo lugar.
 */
const COLUNAS = {
  codigo: ['codigo da emenda', 'codigo emenda', 'numero da emenda', 'n emenda',
    'no emenda', 'n emenda parlamentar', 'emenda parlamentar', 'nr emenda'],
  ano: ['ano da emenda', 'ano emenda', 'ano'],
  tipoOrigem: ['tipo de emenda', 'tipo emenda', 'modalidade'],
  autor: ['autor da emenda', 'autor', 'nome do parlamentar', 'nome parlamentar', 'parlamentar'],
  beneficiario: ['convenente', 'beneficiario', 'proponente', 'nome do proponente',
    'orgao entidade', 'fundo', 'entidade', 'nome do beneficiario'],
  municipio: ['municipio', 'nome do municipio', 'localidade do gasto', 'municipio beneficiario'],
  uf: ['uf', 'sigla uf', 'uf beneficiario'],
  funcao: ['nome da funcao', 'funcao', 'bloco', 'area'],
  objeto: ['objeto', 'objeto do convenio', 'descricao', 'finalidade'],
  proposta: ['n proposta', 'no proposta', 'numero da proposta', 'nr proposta', 'id proposta'],
  instrumento: ['n convenio', 'no convenio', 'numero do convenio', 'instrumento',
    'n instrumento', 'numero do termo'],
  situacaoOrigem: ['situacao', 'situacao da proposta', 'status'],
  valorIndicado: ['valor da emenda', 'valor global', 'dotacao inicial', 'valor proposta',
    'valor repasse', 'valor indicado', 'dotacao atual'],
  valorEmpenhado: ['valor empenhado', 'empenhado'],
  valorLiquidado: ['valor liquidado', 'liquidado'],
  valorPago: ['valor pago', 'pago'],
  restosInscritos: ['valor restos a pagar inscritos', 'restos a pagar inscritos'],
  restosPagos: ['valor restos a pagar pagos', 'restos a pagar pagos'],
  restosCancelados: ['valor restos a pagar cancelados', 'restos a pagar cancelados'],
  atualizadoNaFonte: ['data da ultima atualizacao', 'data atualizacao', 'data'],
};

/** Descobre em que coluna do arquivo mora cada campo nosso. */
export function mapearColunas(cabecalho) {
  const chaves = cabecalho.map(chaveDoRotulo);
  const mapa = {};

  for (const [campo, sinonimos] of Object.entries(COLUNAS)) {
    // Casamento exato primeiro; só depois por conteúdo, para "ano" não roubar
    // a coluna "ano do empenho" quando existe uma "ano da emenda".
    let posicao = chaves.findIndex((c) => sinonimos.includes(c));
    if (posicao === -1) {
      posicao = chaves.findIndex((c) => sinonimos.some((s) => c.includes(s)));
    }
    if (posicao !== -1) mapa[campo] = posicao;
  }
  return mapa;
}

/** De onde a planilha veio, deduzido das colunas. Serve só para o relato. */
export function origemDaPlanilha(cabecalho) {
  const juntas = cabecalho.map(chaveDoRotulo).join('|');
  if (juntas.includes('restos a pagar')) return 'Portal da Transparência';
  if (juntas.includes('convenente') || juntas.includes('proposta')) return 'Transferegov';
  if (juntas.includes('fundo') || juntas.includes('bloco')) return 'Fundo Nacional de Saúde';
  if (juntas.includes('dotacao')) return 'SIOP';
  return 'origem não identificada';
}

const TIPOS = [
  { v: 'individual', re: /individual/i },
  { v: 'especial', re: /especial|transfer[êe]ncia\s+especial|pix/i },
  { v: 'bancada', re: /bancada/i },
  { v: 'comissao', re: /comiss[ãa]o/i },
  { v: 'relator', re: /relator/i },
];

function tipoDe(texto) {
  const t = String(texto || '');
  return (TIPOS.find((x) => x.re.test(t)) || {}).v || null;
}

/**
 * "ERECHIM - RS" e "RS" são as duas formas que a coluna de localidade assume no
 * Portal da Transparência. Separá-las evita gravar a UF no campo de município.
 */
export function separarLocalidade(texto) {
  const t = String(texto || '').trim();
  if (!t) return { municipio: null, uf: null };

  const comUf = /^(.*?)\s*[-–]\s*([A-Za-z]{2})$/.exec(t);
  if (comUf) return { municipio: comUf[1].trim() || null, uf: comUf[2].toUpperCase() };
  if (/^[A-Za-z]{2}$/.test(t)) return { municipio: null, uf: t.toUpperCase() };
  return { municipio: t, uf: null };
}

/** Só entra no registro o que a planilha de fato trouxe. */
function comValor(alvo, campo, valor) {
  if (valor !== null && valor !== undefined && valor !== '') alvo[campo] = valor;
}

/**
 * O identificador do registro. Código e ano são o par estável entre todas as
 * fontes; sem código, o número da proposta ou do instrumento serve. Uma linha
 * sem nenhum dos três não pode ser conciliada e é contada à parte, em vez de
 * virar duplicata a cada importação.
 */
export function chaveDaLinha({ codigo, ano, proposta, instrumento }) {
  const limpo = (v) => String(v || '').trim().replace(/[^\w.-]+/g, '-').replace(/^-|-$/g, '');
  if (codigo) return `${ano || 'sa'}-${limpo(codigo)}`;
  if (proposta) return `prop-${limpo(proposta)}`;
  if (instrumento) return `inst-${limpo(instrumento)}`;
  return null;
}

/**
 * Grava uma leva de emendas já normalizadas, conciliando com o que existe.
 *
 * É o mesmo caminho para a planilha e para a consulta automática. Duas entradas
 * com duas conciliações seriam duas chances de duplicar o mesmo registro por
 * caminhos diferentes — e a divergência só apareceria meses depois, num número
 * somado em dobro no painel.
 */
async function conciliar(brutas, funil) {
  const { salvarEmLote, listar } = await import('./dados.js');

  const existentes = new Set(
    (await listar('emendas', { recarregar: true })).map((e) => e.id),
  );

  const registros = [];
  const vistos = new Set();

  for (const bruta of brutas) {
    const id = chaveDaLinha(bruta);
    if (!id) { funil.semChave += 1; continue; }
    if (vistos.has(id)) continue;
    vistos.add(id);

    const dados = {};
    for (const [campo, valor] of Object.entries(bruta)) comValor(dados, campo, valor);
    dados.importadoEm = new Date().toISOString().slice(0, 10);

    // A fase é juízo do gabinete e nenhuma fonte a conhece; só se dá um ponto
    // de partida ao registro que está nascendo agora.
    if (!existentes.has(id)) {
      dados.fase = dados.valorPago > 0 ? 'execucao' : (dados.valorEmpenhado > 0 ? 'empenhada' : 'indicada');
      funil.novas += 1;
    } else {
      funil.atualizadas += 1;
    }

    registros.push({ id, dados });
  }

  if (registros.length) {
    const gravacao = await salvarEmLote('emendas', registros);
    if (gravacao.falhas.length) throw gravacao.falhas[0];
  }
  return funil;
}

/**
 * Lê a planilha e concilia com o que já está guardado.
 *
 * Os arquivos do Portal da Transparência trazem as emendas de todos os
 * parlamentares — meio milhão de linhas. Filtrar pelo nome do autor é o que
 * torna a importação possível, e é também o passo que mais falha em silêncio,
 * porque o nome parlamentar nem sempre é o nome do gabinete. Por isso ele é
 * contado e relatado.
 */
export async function importarPlanilha(arquivo, { nomeAutor = null } = {}) {
  const texto = decodificar(await arquivo.arrayBuffer());
  const { cabecalho, linhas } = lerCsv(texto);

  if (!cabecalho.length) throw new Error('O arquivo está vazio ou não é uma planilha de texto.');

  const mapa = mapearColunas(cabecalho);
  const origem = origemDaPlanilha(cabecalho);

  if (mapa.valorEmpenhado === undefined && mapa.valorIndicado === undefined) {
    throw new Error(`Não encontrei colunas de valor em "${cabecalho.slice(0, 6).join(', ')}…". Confira se é a exportação de emendas.`);
  }

  const funil = {
    origem,
    linhas: linhas.length,
    deOutroAutor: 0,
    semChave: 0,
    novas: 0,
    atualizadas: 0,
    temColunaAutor: mapa.autor !== undefined,
    nomeUsado: nomeAutor || null,
  };

  const campo = (linha, nome) => (mapa[nome] === undefined ? null : String(linha[mapa[nome]] ?? '').trim());
  const brutas = [];

  for (const linha of linhas) {
    if (mapa.autor !== undefined && nomeAutor && !mesmoNome(campo(linha, 'autor'), nomeAutor)) {
      funil.deOutroAutor += 1;
      continue;
    }

    const local = separarLocalidade(campo(linha, 'municipio'));
    brutas.push({
      codigo: campo(linha, 'codigo'),
      ano: numeroBr(campo(linha, 'ano')),
      tipo: tipoDe(campo(linha, 'tipoOrigem')),
      autorNaFonte: campo(linha, 'autor'),
      beneficiario: campo(linha, 'beneficiario'),
      municipio: local.municipio || campo(linha, 'municipio'),
      uf: local.uf || campo(linha, 'uf'),
      funcao: campo(linha, 'funcao'),
      objeto: campo(linha, 'objeto'),
      proposta: campo(linha, 'proposta'),
      instrumento: campo(linha, 'instrumento'),
      situacaoNaFonte: campo(linha, 'situacaoOrigem'),
      valorIndicado: numeroBr(campo(linha, 'valorIndicado')),
      valorEmpenhado: numeroBr(campo(linha, 'valorEmpenhado')),
      valorLiquidado: numeroBr(campo(linha, 'valorLiquidado')),
      valorPago: numeroBr(campo(linha, 'valorPago')),
      restosInscritos: numeroBr(campo(linha, 'restosInscritos')),
      restosPagos: numeroBr(campo(linha, 'restosPagos')),
      restosCancelados: numeroBr(campo(linha, 'restosCancelados')),
      atualizadoNaFonte: dataBr(campo(linha, 'atualizadoNaFonte')),
      fonte: origem,
    });
  }

  return conciliar(brutas, funil);
}

// ─────────────────────── consulta automática ───────────────────────

/**
 * Teto de páginas da consulta ao Portal.
 *
 * A API pagina de quinze em quinze e não informa o total — a única forma de
 * saber que acabou é receber uma página vazia. Eu parava quando a página vinha
 * com menos de cem itens, número que tirei de outra API; como a primeira já vem
 * com quinze, a consulta terminava na primeira página e um mandato inteiro
 * virava quinze emendas.
 *
 * O teto existe só para que um comportamento inesperado da fonte não vire um
 * laço infinito. Quatrocentas páginas cobrem seis mil emendas, muito além do
 * que um mandato produz.
 */
const PAGINAS_MAXIMAS = 400;

/**
 * Traduz um registro do Portal da Transparência.
 *
 * Os nomes dos campos vêm da documentação da API, que eu não consigo alcançar
 * do meu ambiente para conferir. Por isso cada campo é lido por mais de um
 * nome possível e o registro cru fica guardado quando algo não casa: um campo
 * renomeado do outro lado precisa aparecer como pergunta, não como zero.
 */
export function doPortal(r) {
  const pegar = (...nomes) => {
    for (const n of nomes) {
      if (r[n] !== undefined && r[n] !== null && r[n] !== '') return r[n];
    }
    return null;
  };

  const local = separarLocalidade(pegar('localidadeDoGasto', 'localidade', 'municipio'));
  const funcaoBruta = pegar('funcao', 'nomeFuncao');

  return {
    codigo: pegar('codigoEmenda', 'codigo'),
    ano: numeroBr(pegar('ano', 'anoEmenda')),
    tipo: tipoDe(pegar('tipoEmenda', 'tipo')),
    autorNaFonte: pegar('nomeAutor', 'autor'),
    municipio: local.municipio,
    uf: local.uf,
    funcao: typeof funcaoBruta === 'object' ? funcaoBruta?.descricao : funcaoBruta,
    valorEmpenhado: numeroBr(pegar('valorEmpenhado')),
    valorLiquidado: numeroBr(pegar('valorLiquidado')),
    valorPago: numeroBr(pegar('valorPago')),
    restosInscritos: numeroBr(pegar('valorRestoInscrito', 'valorRestosInscritos')),
    restosPagos: numeroBr(pegar('valorRestoPago', 'valorRestosPagos')),
    restosCancelados: numeroBr(pegar('valorRestoCancelado', 'valorRestosCancelados')),
    subfuncao: pegar('subfuncao'),
    numeroNaFonte: pegar('numeroEmenda'),
    fonte: 'Portal da Transparência',
  };
}

/**
 * Consulta o Portal da Transparência pela ponte no servidor.
 *
 * A API pagina de cem em cem e não informa o total, então a única forma de
 * saber que acabou é receber uma página menor que a anterior. O teto de páginas
 * existe para que um comportamento inesperado da fonte não vire um laço infinito
 * consumindo a cota do gabinete.
 */
export async function consultarPortal({ nomeAutor, ano = null, aoProgredir = () => {} }) {
  if (!nomeAutor) throw new Error('Informe o nome do parlamentar em Acessos → Dados do gabinete.');

  const { consultarFonte } = await import('./fontes.js');

  const funil = {
    origem: 'Portal da Transparência (consulta direta)',
    linhas: 0,
    deOutroAutor: 0,
    semChave: 0,
    novas: 0,
    atualizadas: 0,
    temColunaAutor: true,
    nomeUsado: nomeAutor,
    paginas: 0,
    reconhecidos: 0,
  };

  // O Portal casa o nome pela forma exata em que o guarda: caixa alta, sem
  // acento. Mandar como o gabinete escreve devolve zero sem erro nenhum.
  const nomeNaBase = nomeParaBusca(nomeAutor);

  const brutas = [];
  let amostra = null;
  const jaVistos = new Set();

  for (let pagina = 1; pagina <= PAGINAS_MAXIMAS; pagina += 1) {
    const r = await consultarFonte('portal-emendas', { nomeAutor: nomeNaBase, ano, pagina });
    const lote = Array.isArray(r.dados) ? r.dados : [];
    funil.paginas = pagina;
    if (!amostra && lote.length) amostra = lote[0];

    // Página vazia é o fim da lista. Página que só repete o que já veio
    // significa que a fonte ignorou o número da página — sem essa guarda, a
    // consulta giraria para sempre queimando a cota do gabinete.
    if (!lote.length) break;
    const antesDaPagina = jaVistos.size;
    lote.forEach((x) => jaVistos.add(String(x.codigoEmenda ?? x.id ?? JSON.stringify(x))));
    if (jaVistos.size === antesDaPagina) break;

    funil.linhas += lote.length;

    for (const bruto of lote) {
      const normalizado = doPortal(bruto);

      // Reconhecido é o registro do qual se conseguiu tirar o código da emenda.
      // Nenhum reconhecido em toda a consulta não é "não achou nada": é a forma
      // dos campos ter mudado, e as duas coisas exigem providências opostas.
      if (normalizado.codigo) funil.reconhecidos += 1;

      // A API filtra por nome, mas com casamento parcial: conferir de novo aqui
      // evita trazer um homônimo por engano.
      if (!mesmoNome(normalizado.autorNaFonte, nomeAutor)) { funil.deOutroAutor += 1; continue; }
      brutas.push(normalizado);
    }

    aoProgredir({ pagina, trazidas: funil.linhas });
  }

  // Se a fonte respondeu mas nada foi reconhecido, o problema é de nome de
  // campo — a API mudou, ou eu li a documentação errado. Dizer quais campos
  // vieram transforma uma tarde de adivinhação num conserto de uma linha.
  if (funil.linhas && !funil.reconhecidos) {
    funil.camposRecebidos = Object.keys(amostra || {});
  }

  // Nenhum registro é a resposta mais ambígua que essa consulta pode dar: pode
  // ser que o parlamentar não tenha emendas no período, que o nome enviado não
  // seja o que a base usa, ou que o filtro por nome nem seja aceito. Uma única
  // consulta sem filtro separa as três — mostra quantos registros existem, com
  // que nomes de campo e como a base escreve os autores.
  if (!funil.linhas) {
    try {
      const r = await consultarFonte('portal-emendas', { pagina: 1, ano });
      const lote = Array.isArray(r.dados) ? r.dados : [];
      funil.diagnostico = {
        enviamos: nomeNaBase,
        semFiltro: lote.length,
        campos: Object.keys(lote[0] || {}),
        autores: [...new Set(lote.map((x) => x.nomeAutor ?? x.autor ?? '(sem campo de autor)'))]
          .filter(Boolean).slice(0, 6),
      };
    } catch (erro) {
      funil.diagnostico = { enviamos: nomeNaBase, falhou: erro.message };
    }
  }

  return conciliar(brutas, funil);
}

// ───────────────────── a emenda discriminada ─────────────────────

/**
 * Traduz um documento de execução do Portal.
 *
 * Cada emenda vira várias linhas aqui: um empenho, uma liquidação, um
 * pagamento — cada um com o favorecido, que é a informação que o consolidado
 * esconde. "Quanto foi para Gramado, para quê" só se responde neste nível.
 *
 * Como em `doPortal`, cada campo é lido por mais de um nome possível: não
 * consigo alcançar essa API do meu ambiente, e é melhor tentar três nomes do
 * que gravar vazio quando a fonte usa o segundo.
 */
export function doDocumento(r, codigoEmenda) {
  const pegar = (...nomes) => {
    for (const n of nomes) {
      const v = n.split('.').reduce((o, k) => (o == null ? o : o[k]), r);
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return null;
  };

  const local = separarLocalidade(pegar('municipio', 'localidade', 'localidadeDoGasto'));
  const data = dataBr(pegar('data', 'dataEmissao', 'dataDocumento'));

  return {
    codigoEmenda: pegar('codigoEmenda') || codigoEmenda || null,
    documento: pegar('documentoResumido', 'documento', 'numeroDocumento', 'codigoDocumento'),
    tipo: tipoDoDocumento(pegar('fase', 'tipoDocumento', 'especieDocumento')),
    data,
    ano: data ? Number(data.slice(0, 4)) : numeroBr(pegar('ano')),
    favorecido: pegar('nomeFavorecido', 'favorecido.nome', 'favorecido', 'nomeBeneficiario'),
    favorecidoDoc: pegar('codigoFavorecido', 'favorecido.cnpjFormatado', 'cnpjFavorecido', 'cpfCnpjFavorecido'),
    municipio: local.municipio,
    uf: local.uf || pegar('uf', 'siglaUf'),
    orgao: pegar('nomeOrgao', 'orgao.nome', 'orgaoSuperior', 'unidadeGestora'),
    objeto: pegar('observacao', 'objeto', 'descricao', 'historico'),
    valor: numeroBr(pegar('valor', 'valorDocumento', 'valorEmpenhado', 'valorPago')),
    situacao: pegar('situacao', 'status'),
    fonte: 'Portal da Transparência',
  };
}

/** A fase da execução, como o Portal a escreve, reduzida ao que a lista mostra. */
function tipoDoDocumento(texto) {
  const t = String(texto || '').toLowerCase();
  if (t.includes('pagamento') || t.startsWith('ob')) return 'pagamento';
  if (t.includes('liquida')) return 'liquidacao';
  if (t.includes('empenho') || t.startsWith('ne')) return 'empenho';
  if (t.includes('conv')) return 'convenio';
  if (t.includes('proposta')) return 'proposta';
  if (t.includes('especial')) return 'especial';
  return 'empenho';
}

/** A chave de uma transferência: a emenda mais o documento que a executou. */
export function chaveDaTransferencia({ codigoEmenda, documento, favorecido, data }) {
  const limpo = (v) => String(v || '').trim().replace(/[^\w.-]+/g, '-').replace(/^-|-$/g, '');
  if (codigoEmenda && documento) return `${limpo(codigoEmenda)}-${limpo(documento)}`;
  if (documento) return `doc-${limpo(documento)}`;
  if (codigoEmenda && favorecido && data) {
    return `${limpo(codigoEmenda)}-${limpo(data)}-${limpo(favorecido).slice(0, 40)}`;
  }
  return null;
}

/**
 * Busca, para cada emenda já importada, as transferências que a executaram.
 *
 * É uma consulta por emenda — não há como pedir todas de uma vez —, então o
 * trabalho é gravado a cada punhado em vez de no fim: uma varredura longa que
 * só grava no último instante perde tudo se a aba fechar, erro que já cometi
 * uma vez neste projeto.
 */
export async function detalharEmendas({ aoProgredir = () => {} } = {}) {
  const { salvarEmLote, listar } = await import('./dados.js');
  const { consultarFonte } = await import('./fontes.js');

  const emendas = (await listar('emendas', { recarregar: true })).filter((e) => e.codigo);
  if (!emendas.length) {
    throw new Error('Importe as emendas primeiro — é delas que sai a lista a detalhar.');
  }

  const funil = {
    emendas: emendas.length,
    consultadas: 0,
    linhas: 0,
    reconhecidas: 0,
    semChave: 0,
    gravadas: 0,
  };
  let amostra = null;
  let acumulado = [];

  const descarregar = async () => {
    if (!acumulado.length) return;
    const gravacao = await salvarEmLote('transferencias', acumulado);
    if (gravacao.falhas.length) throw gravacao.falhas[0];
    funil.gravadas += acumulado.length;
    acumulado = [];
  };

  for (const emenda of emendas) {
    try {
      for (let pagina = 1; pagina <= 30; pagina += 1) {
        const r = await consultarFonte('portal-emenda-documentos', {
          codigoEmenda: emenda.codigo, pagina,
        });
        const lote = Array.isArray(r.dados) ? r.dados : [];
        if (!lote.length) break;
        if (!amostra) [amostra] = lote;
        funil.linhas += lote.length;

        for (const bruto of lote) {
          const t = doDocumento(bruto, emenda.codigo);
          const id = chaveDaTransferencia(t);
          if (!id) { funil.semChave += 1; continue; }
          if (t.favorecido || t.valor !== null) funil.reconhecidas += 1;

          const dados = {};
          for (const [campo, valor] of Object.entries(t)) comValor(dados, campo, valor);
          dados.importadoEm = new Date().toISOString().slice(0, 10);
          acumulado.push({ id, dados });
        }
      }
    } catch (erro) {
      console.error(`Não detalhou a emenda ${emenda.codigo}`, erro);
    } finally {
      funil.consultadas += 1;
      if (acumulado.length >= 200) await descarregar();
      aoProgredir({ ...funil });
    }
  }

  await descarregar();

  // Mesmo raciocínio da consulta principal: linhas que chegam e não são
  // reconhecidas apontam nomes de campo diferentes, não ausência de dados.
  if (funil.linhas && !funil.reconhecidas) {
    funil.camposRecebidos = Object.keys(amostra || {});
  }
  return funil;
}
