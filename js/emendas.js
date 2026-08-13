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
/** Primeiro ano de emenda impositiva individual. Antes disso não há o que buscar. */
const ANO_INICIAL = 2019;

/** Percorre as páginas de uma consulta até a fonte se esgotar. */
async function paginarPortal({ consultarFonte, parametros, jaVistos, funil, aoProgredir, rotulo }) {
  const achadas = [];

  for (let pagina = 1; pagina <= PAGINAS_MAXIMAS; pagina += 1) {
    const r = await consultarFonte('portal-emendas', { ...parametros, pagina });
    const lote = Array.isArray(r.dados) ? r.dados : [];
    funil.paginas += 1;

    // Página vazia é o fim da lista. Página que só repete o que já veio
    // significa que a fonte ignorou o número da página — sem essa guarda, a
    // consulta giraria para sempre queimando a cota do gabinete.
    if (!lote.length) break;

    let novasNaPagina = 0;
    for (const bruto of lote) {
      const chave = String(bruto.codigoEmenda ?? bruto.id ?? JSON.stringify(bruto));
      if (jaVistos.has(chave)) continue;
      jaVistos.add(chave);
      novasNaPagina += 1;
      achadas.push(bruto);
    }

    funil.linhas += lote.length;
    aoProgredir({ rotulo, paginas: funil.paginas, trazidas: jaVistos.size });
    if (!novasNaPagina) break;
  }

  return achadas;
}

/**
 * Consulta o Portal da Transparência pela ponte no servidor.
 *
 * A consulta é feita ano a ano, e não de uma vez. Sem o filtro de ano, a base
 * devolveu cinquenta registros para um mandato que atravessa sete exercícios —
 * comportamento que não está documentado e que eu não tenho como investigar
 * daqui. Pedir cada ano explicitamente contorna qualquer recorte que a fonte
 * aplique por conta própria, e custa poucas páginas a mais.
 *
 * A varredura sem filtro vem primeiro, de propósito: se o ano não for um filtro
 * aceito, ela sozinha já traz o que houver, e as demais só repetem — o que a
 * deduplicação absorve sem gravar nada em dobro.
 */
export async function consultarPortal({ nomeAutor, aoProgredir = () => {} }) {
  if (!nomeAutor) throw new Error('Informe o nome do parlamentar em Acessos → Dados do gabinete.');

  const { consultarFonte } = await import('./fontes.js');

  // O Portal casa o nome pela forma exata em que o guarda: caixa alta, sem
  // acento. Mandar como o gabinete escreve devolve zero sem erro nenhum.
  const nomeNaBase = nomeParaBusca(nomeAutor);

  const funil = {
    origem: 'Portal da Transparência (consulta direta)',
    linhas: 0,
    deOutroAutor: 0,
    semChave: 0,
    novas: 0,
    atualizadas: 0,
    temColunaAutor: true,
    nomeUsado: nomeNaBase,
    paginas: 0,
    reconhecidos: 0,
    porAno: {},
  };

  const jaVistos = new Set();
  const bruteza = [];
  let amostra = null;

  const anos = [null];
  for (let a = ANO_INICIAL; a <= new Date().getFullYear(); a += 1) anos.push(a);

  for (const ano of anos) {
    const achadas = await paginarPortal({
      consultarFonte,
      parametros: { nomeAutor: nomeNaBase, ano },
      jaVistos,
      funil,
      aoProgredir,
      rotulo: ano ? String(ano) : 'todos os anos',
    });
    if (!amostra && achadas.length) [amostra] = achadas;
    bruteza.push(...achadas);
  }

  const brutas = [];
  for (const bruto of bruteza) {
    const normalizado = doPortal(bruto);

    // Reconhecido é o registro do qual se conseguiu tirar o código da emenda.
    // Nenhum reconhecido em toda a consulta não é "não achou nada": é a forma
    // dos campos ter mudado, e as duas coisas exigem providências opostas.
    if (normalizado.codigo) funil.reconhecidos += 1;

    // A API filtra por nome, mas com casamento parcial: conferir de novo aqui
    // evita trazer um homônimo por engano.
    if (!mesmoNome(normalizado.autorNaFonte, nomeAutor)) { funil.deOutroAutor += 1; continue; }

    // A distribuição por ano é o que denuncia um exercício faltando — que é
    // exatamente o que um total sozinho esconde.
    if (normalizado.ano) funil.porAno[normalizado.ano] = (funil.porAno[normalizado.ano] || 0) + 1;
    brutas.push(normalizado);
  }

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
      const r = await consultarFonte('portal-emendas', { pagina: 1 });
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
//
// O Portal da Transparência não publica o detalhamento por emenda — os
// caminhos que tentei responderam 403, que no gateway dele significa caminho
// inexistente. Quem publica é o Transferegov, em `plano_acao_especial`: uma
// linha por beneficiário, com o que cada um recebeu de custeio e investimento,
// a situação e, quando há, o motivo do impedimento.
//
// Vale só para transferências especiais — a emenda que vai direto ao município,
// sem convênio. As de finalidade definida moram noutro módulo, e a sondagem
// mostrou que existe um `fundoafundo` com estrutura parecida, ainda por ligar.

const ESPECIAIS = '/transferenciasespeciais/plano_acao_especial';

/**
 * O código de doze dígitos que o Portal usa, remontado a partir das partes que
 * o Transferegov guarda separadas: ano, código do parlamentar e sequencial.
 * É o que permite pendurar cada plano de ação na emenda certa.
 */
export function codigoDaEmenda({ ano, parlamentar, sequencial }) {
  const n = (v, tamanho) => String(v ?? '').replace(/\D/g, '').padStart(tamanho, '0');
  if (!ano || !parlamentar) return null;
  return `${n(ano, 4)}${n(parlamentar, 4)}${n(sequencial, 4)}`;
}

/** As partes de um código de emenda, para consultar o Transferegov. */
export function partesDoCodigo(codigo) {
  const limpo = String(codigo || '').replace(/\D/g, '');
  if (limpo.length < 12) return null;
  return {
    ano: Number(limpo.slice(0, 4)),
    parlamentar: Number(limpo.slice(4, 8)),
    sequencial: Number(limpo.slice(8, 12)),
  };
}

/** "MUNICIPIO DE ERECHIM" é o beneficiário; "Erechim" é o município. */
export function municipioDoBeneficiario(nome) {
  const t = String(nome || '').trim();
  if (!t) return null;
  const m = /^(?:munic[íi]pio|prefeitura(?:\s+municipal)?)\s+(?:de\s+|do\s+|da\s+|dos\s+|das\s+)?(.+)$/i.exec(t);
  return (m ? m[1] : t).trim();
}

/** Traduz um plano de ação do Transferegov para uma transferência nossa. */
export function doPlanoAcao(r) {
  const custeio = numeroBr(r.valor_custeio_plano_acao);
  const investimento = numeroBr(r.valor_investimento_plano_acao);
  const total = (custeio || 0) + (investimento || 0);

  return {
    codigoEmenda: codigoDaEmenda({
      ano: r.ano_emenda_parlamentar_plano_acao,
      parlamentar: r.codigo_parlamentar_emenda_plano_acao,
      sequencial: r.sequencial_emenda_parlamentar_plano_acao,
    }) || r.codigo_emenda_parlamentar_formatado_plano_acao || null,
    documento: r.codigo_plano_acao ? `PA ${r.codigo_plano_acao}` : (r.id_plano_acao ? `PA ${r.id_plano_acao}` : null),
    tipo: 'especial',
    ano: Number(r.ano_plano_acao) || Number(r.ano_emenda_parlamentar_plano_acao) || null,
    favorecido: r.nome_beneficiario_plano_acao || null,
    favorecidoDoc: r.cnpj_beneficiario_plano_acao || null,
    municipio: municipioDoBeneficiario(r.nome_beneficiario_plano_acao),
    uf: r.uf_beneficiario_plano_acao || null,
    objeto: r.descricao_programacao_orcamentaria_plano_acao
      || r.codigo_descricao_areas_politicas_publicas_plano_acao || null,
    // Impedimento é a informação mais acionável desta base: é o que trava o
    // repasse, e é sobre isso que a prefeitura liga para o gabinete.
    situacao: r.motivo_impedimento_plano_acao
      ? `${r.situacao_plano_acao || 'Impedida'} — ${r.motivo_impedimento_plano_acao}`
      : (r.situacao_plano_acao || null),
    valor: total || null,
    valorCusteio: custeio,
    valorInvestimento: investimento,
    idPlanoAcao: r.id_plano_acao ?? null,
    fonte: 'Transferegov — transferências especiais',
  };
}

/** A chave de uma transferência: o plano de ação identifica sozinho. */
export function chaveDaTransferencia({ idPlanoAcao, codigoEmenda, documento, favorecido, data }) {
  const limpo = (v) => String(v || '').trim().replace(/[^\w.-]+/g, '-').replace(/^-|-$/g, '');
  if (idPlanoAcao) return `pa-${limpo(idPlanoAcao)}`;
  if (codigoEmenda && documento) return `${limpo(codigoEmenda)}-${limpo(documento)}`;
  if (documento) return `doc-${limpo(documento)}`;
  if (codigoEmenda && favorecido) {
    return `${limpo(codigoEmenda)}-${limpo(data)}-${limpo(favorecido).slice(0, 40)}`;
  }
  return null;
}

/** Grava um lote de planos de ação já traduzidos. */
async function guardarTransferencias(planos) {
  const { salvarEmLote } = await import('./dados.js');
  const registros = [];
  const vistos = new Set();

  for (const t of planos) {
    const id = chaveDaTransferencia(t);
    if (!id || vistos.has(id)) continue;
    vistos.add(id);
    const dados = {};
    for (const [campo, valor] of Object.entries(t)) comValor(dados, campo, valor);
    dados.importadoEm = new Date().toISOString().slice(0, 10);
    registros.push({ id, dados });
  }

  if (registros.length) {
    const gravacao = await salvarEmLote('transferencias', registros);
    if (gravacao.falhas.length) throw gravacao.falhas[0];
  }
  return registros.map((r) => ({ id: r.id, ...r.dados }));
}

/**
 * Os planos de ação de uma emenda só. É a unidade da sanfona: abrir uma linha
 * custa uma consulta, e ela usa as três partes do código para filtrar.
 */
export async function detalharEmenda(codigo) {
  const { consultarFonte } = await import('./fontes.js');
  const partes = partesDoCodigo(codigo);
  if (!partes) return { transferencias: [], camposRecebidos: null };

  // O filtro vai só por ano e parlamentar, e o sequencial é conferido aqui.
  // Não sei se a base guarda o sequencial como número ou como texto com zeros
  // à esquerda, e `eq.1` não encontra `0001`. Um ano de emendas de um único
  // parlamentar são poucas dezenas de linhas — barato de peneirar do lado de cá,
  // e imune ao formato.
  const r = await consultarFonte('transferegov-livre', {
    ano_emenda_parlamentar_plano_acao: `eq.${partes.ano}`,
    codigo_parlamentar_emenda_plano_acao: `eq.${partes.parlamentar}`,
    limit: 1000,
  }, ESPECIAIS);

  const lote = Array.isArray(r.dados) ? r.dados : [];
  const planos = lote
    .map(doPlanoAcao)
    .filter((t) => String(t.codigoEmenda) === String(codigo))
    .filter((t) => t.favorecido || t.valor);

  return {
    transferencias: await guardarTransferencias(planos),
    // Registro que chega e não vira nada aponta nome de campo diferente, não
    // ausência de dados — e a tela precisa dizer qual dos dois é.
    camposRecebidos: (lote.length && !planos.length) ? Object.keys(lote[0]) : null,
  };
}

/**
 * Todos os planos de ação do parlamentar, de uma vez.
 *
 * Uma consulta por emenda seriam duzentas; filtrar pelo nome do parlamentar
 * traz tudo em poucas páginas. O nome vai como comparação insensível a caixa,
 * porque a grafia entre as bases federais não é a mesma.
 */
const PAGINAS_ESPECIAIS = 40;

/** As grafias a tentar para um nome, da mais fiel à mais tolerante. */
export function grafiasDoNome(nome) {
  const limpo = String(nome || '').trim().replace(/\s+/g, ' ');
  if (!limpo) return [];
  // `ilike` resolve a caixa, não o acento: se a base grava "José" e mandamos
  // "JOSE", o resultado volta vazio — e vazio parece "não tem emenda". Tentar as
  // duas grafias custa uma consulta a mais e evita concluir errado.
  return [...new Set([limpo, nomeParaBusca(limpo)])].filter(Boolean);
}

export async function detalharEmendas({ nomeAutor, aoProgredir = () => {} } = {}) {
  const { consultarFonte } = await import('./fontes.js');
  if (!nomeAutor) throw new Error('Informe o nome do parlamentar em Acessos → Dados do gabinete.');

  const funil = { linhas: 0, gravadas: 0, paginas: 0, emendas: 0, procurado: null };
  const porPagina = 500;
  const encontrados = [];
  let amostra = null;

  for (const grafia of grafiasDoNome(nomeAutor)) {
    for (let pagina = 0; pagina < PAGINAS_ESPECIAIS; pagina += 1) {
      const r = await consultarFonte('transferegov-livre', {
        nome_parlamentar_emenda_plano_acao: `ilike.*${grafia}*`,
        limit: porPagina,
        offset: pagina * porPagina,
      }, ESPECIAIS);

      const lote = Array.isArray(r.dados) ? r.dados : [];
      funil.paginas += 1;
      funil.linhas += lote.length;
      if (!amostra && lote.length) [amostra] = lote;

      encontrados.push(...lote.map(doPlanoAcao).filter((t) => t.favorecido || t.valor));
      aoProgredir({ ...funil, procurado: grafia });

      if (lote.length < porPagina) break;
    }
    if (funil.linhas) { funil.procurado = grafia; break; }
  }

  const gravadas = await guardarTransferencias(encontrados);
  funil.gravadas = gravadas.length;
  funil.emendas = new Set(gravadas.map((t) => t.codigoEmenda).filter(Boolean)).size;
  if (funil.linhas && !gravadas.length) funil.camposRecebidos = Object.keys(amostra || {});
  return funil;
}

// ───────────────────────── sondagem de fontes ─────────────────────────

/**
 * Caminhos candidatos para o detalhamento de uma emenda.
 *
 * Escrevi o primeiro pela documentação e ele respondeu 403 — que no gateway do
 * Portal significa caminho inexistente, não chave inválida. Como não alcanço
 * essas APIs do meu ambiente, adivinhar de novo custaria uma implantação por
 * palpite. A sondagem tenta todos de uma vez e diz qual responde.
 */
export const CAMINHOS_CANDIDATOS = [
  // As tabelas que o próprio serviço declarou existir. Os nomes já contam a
  // estrutura: o programa é a emenda, o plano de ação é a repartição por
  // beneficiário, e empenho, ordem bancária e histórico são a execução.
  // Falta saber os nomes das colunas — e por qual delas se liga na emenda.
  { fonte: 'transferegov-livre', caminho: '/transferenciasespeciais/plano_acao_especial' },
  { fonte: 'transferegov-livre', caminho: '/transferenciasespeciais/programa_especial' },
  { fonte: 'transferegov-livre', caminho: '/transferenciasespeciais/empenho_especial' },
  { fonte: 'transferegov-livre', caminho: '/transferenciasespeciais/ordem_pagamento_ordem_bancaria_especial' },
  { fonte: 'transferegov-livre', caminho: '/transferenciasespeciais/historico_pagamento_especial' },
  { fonte: 'transferegov-livre', caminho: '/transferenciasespeciais/executor_especial' },
  { fonte: 'transferegov-livre', caminho: '/transferenciasespeciais/finalidade_especial' },
  { fonte: 'transferegov-livre', caminho: '/transferenciasespeciais/meta_especial' },
  { fonte: 'transferegov-livre', caminho: '/transferenciasespeciais/documento_habil_especial' },
  { fonte: 'transferegov-livre', caminho: '/transferenciasespeciais/plano_trabalho_especial' },

  // Outros módulos da plataforma, para achar as emendas de finalidade definida
  // — as que passam por convênio em vez de ir direto ao município.
  { fonte: 'transferegov-livre', caminho: '/transferenciasvoluntarias', raiz: true },
  { fonte: 'transferegov-livre', caminho: '/transferenciafinalidadedefinida', raiz: true },
  { fonte: 'transferegov-livre', caminho: '/fundoafundo', raiz: true },
  { fonte: 'transferegov-livre', caminho: '/siconv', raiz: true },
  { fonte: 'transferegov-livre', caminho: '/parlamentar', raiz: true },
];

/**
 * Tenta cada caminho e relata o que aconteceu em cada um.
 *
 * Devolve, para os que responderam, quantos registros vieram e quais campos —
 * que é exatamente o que falta para escrever o leitor certo de primeira.
 */
/**
 * O catálogo de tabelas que um serviço PostgREST publica na própria raiz.
 *
 * É o que transforma "erramos o nome da tabela" em "aqui está a lista dos
 * nomes". Um serviço assim descreve a si mesmo em OpenAPI, e as chaves de
 * `paths` são exatamente as tabelas consultáveis.
 */
export function tabelasDe(dados) {
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) return null;
  const nomes = dados.paths ? Object.keys(dados.paths) : (dados.definitions && Object.keys(dados.definitions));
  if (!nomes) return null;
  return nomes.map((n) => String(n).replace(/^\//, '')).filter(Boolean);
}

export async function sondarFontes(codigoEmenda) {
  const { consultarFonte } = await import('./fontes.js');
  const achados = [];

  for (const candidato of CAMINHOS_CANDIDATOS) {
    const parametros = {};
    if (candidato.usa === 'codigoEmenda' && codigoEmenda) parametros.codigoEmenda = codigoEmenda;
    // O Transferegov é PostgREST: o filtro vai como `campo=eq.valor`.
    if (candidato.usa === 'nr_emenda' && codigoEmenda) parametros.nr_emenda = `eq.${codigoEmenda}`;
    if (candidato.raiz) { /* a raiz não leva parâmetro nenhum */ }
    else if (candidato.fonte === 'transferegov-livre') parametros.limit = 3;
    else parametros.pagina = 1;

    try {
      const r = await consultarFonte(candidato.fonte, parametros, candidato.caminho);
      const tabelas = tabelasDe(r.dados);
      const lote = Array.isArray(r.dados) ? r.dados : [r.dados].filter(Boolean);
      achados.push({
        caminho: candidato.caminho,
        ok: true,
        tabelas,
        quantidade: lote.length,
        campos: tabelas ? [] : Object.keys(lote[0] || {}),
      });
    } catch (erro) {
      achados.push({ caminho: candidato.caminho, ok: false, erro: String(erro.message || erro).slice(0, 320) });
    }
  }

  return achados;
}
