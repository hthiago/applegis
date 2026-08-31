import { lerPlanilha, chaveDoRotulo, numeroBr } from './planilha.js';

/**
 * As duas planilhas de emenda, e o encontro entre elas.
 *
 * A planilha do gabinete é a fonte primária, e isto é uma correção de rumo: por
 * meses eu tratei o portal como verdade e ela como "especificações extras". Os
 * números dizem o contrário. Ela tem 764 destinações, 293 municípios e 67
 * emendas, de 2019 a 2026; a exportação do painel tem 198, 117 e 25. Todos os
 * municípios do painel já estão nela, e só uma emenda existe lá e não aqui.
 *
 * A razão é estrutural, não acidental: o painel só enxerga o que virou convênio
 * celebrado. Ele não vê a Segurança Pública — 137 destinações a delegacias, ao
 * IGP, à Polícia Civil —, não vê o fundo a fundo da Saúde, não vê 2019 inteiro.
 *
 * Então o papel de cada uma:
 *
 *   · O gabinete diz o que existe: cidade, beneficiário, objeto, região,
 *     endereço, valor destinado, e o que já se sabe do andamento.
 *   · O governo confirma o oficial nas 153 linhas que casam: empenhado, pago,
 *     número do instrumento e o link da página do convênio.
 *
 * Quando os dois discordam, ninguém decide sozinho: a linha é marcada como
 * divergente e alguém do gabinete escolhe qual vale, com o motivo registrado.
 * Conciliação automática foi o que produziu, nas versões anteriores desta área,
 * número que ninguém sabia defender numa reunião.
 */

// ─────────────────────────── a planilha do gabinete ───────────────────────────

const COLUNAS_GABINETE = {
  ano: ['ano'],
  regiao: ['regiao'],
  endereco: ['endereco'],
  beneficiario: ['beneficiario'],
  cnpj: ['cnpj beneficiario', 'cnpj'],
  instituicao: ['instituicao'],
  numeroEmenda: ['n da emenda', 'no da emenda', 'numero da emenda', 'n emenda'],
  areaAlocacao: ['area de alocacao'],
  area: ['area'],
  modalidade: ['modalidade'],
  valorDestinado: ['valores destinados', 'valor destinado', 'valor'],
  observacoes: ['observacao', 'observacoes'],
  tipo: ['tipo da emenda', 'tipo'],
  situacao: ['situacao'],
  objeto: ['informacoes adicionais', 'objeto'],
  andamento: ['andamento'],
};

/**
 * Onde mora cada campo — inclusive o município, que não tem cabeçalho.
 *
 * A coluna B da planilha está sem título e é a mais importante de todas. Em vez
 * de exigir que alguém a batize, ela é reconhecida pela posição: a coluna sem
 * nome entre "Ano" e "Região". Pedir que a planilha mude para caber no sistema
 * é inverter quem serve a quem.
 */
export function mapearColunasDoGabinete(cabecalho) {
  const chaves = cabecalho.map(chaveDoRotulo);
  const mapa = {};
  for (const [campo, nomes] of Object.entries(COLUNAS_GABINETE)) {
    const i = chaves.findIndex((c) => nomes.includes(c));
    if (i !== -1) mapa[campo] = i;
  }
  const municipio = chaves.findIndex((c) => c === 'municipio');
  if (municipio !== -1) mapa.municipio = municipio;
  else if (mapa.ano !== undefined && !chaves[mapa.ano + 1]) mapa.municipio = mapa.ano + 1;
  return mapa;
}

export function ehDoGabinete(cabecalho) {
  const m = mapearColunasDoGabinete(cabecalho);
  return m.ano !== undefined && m.municipio !== undefined && m.beneficiario !== undefined;
}

/**
 * O número da emenda, saindo da notação científica do Excel.
 *
 * A planilha guarda "4.1160005E7", que é 41160005 escrito como o Excel entende.
 * Comparar isso com o "41160005" do painel dá falso negativo em todas as linhas.
 */
export function numeroDaEmenda(bruto) {
  const t = String(bruto ?? '').trim();
  if (!t) return null;
  if (/^[\d.]+e[+-]?\d+$/i.test(t)) {
    const n = Number(t);
    return Number.isFinite(n) ? String(Math.round(n)) : null;
  }
  const so = t.replace(/\D/g, '');
  return so || null;
}

const semAcento = (t) => String(t ?? '').toUpperCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

/**
 * O estado, separado do histórico.
 *
 * A coluna "Situação" da planilha tem 54 valores distintos, e três respondem por
 * 90%: "Recurso pago", "Empenhado", "Indicado". O resto não é estado — é
 * andamento escrito no lugar errado: "Prefeitura submeteu proposta ao Ministério
 * em 02/05/2024", "Pago parcialmente: R$ 94.500,00, saldo a receber".
 *
 * É por isso que a coluna "Andamento" estava preenchida em só 11% das linhas: as
 * pessoas escreviam onde parecia caber. Aqui o estado vira lista curta e o texto
 * original é preservado inteiro — jogá-lo fora seria perder justamente o que a
 * planilha tem que o painel não tem.
 */
export function situacaoDaFrase(texto) {
  const t = semAcento(texto);
  if (!t) return null;
  if (/PERDIDO/.test(t)) return 'perdido';
  if (/IMPEDI|INDEFER|CANCELAD|DEVOLVID/.test(t)) return 'impedido';
  if (/PARCIAL/.test(t)) return 'pagoParcial';
  if (/PAGO|PAGA|PAGAMENTO REALIZADO/.test(t)) return 'pago';
  if (/EMPENHAD|EMPENHO/.test(t)) return 'empenhado';
  if (/INDICAD/.test(t)) return 'indicado';
  // Licitação, pregão, proposta submetida: o dinheiro foi indicado e ainda anda.
  if (/LICITA|PREGAO|PROPOSTA|SUBMET|ANALISE|TRAMIT/.test(t)) return 'indicado';
  return null;
}

/** Individual ou bancada — e se veio por processo seletivo, que é outra coisa. */
export function tipoEProcesso(texto) {
  const t = semAcento(texto);
  return {
    tipo: /BANCADA/.test(t) ? 'bancada' : (t ? 'individual' : null),
    processoSeletivo: /PROCESSO SELETIVO/.test(t) || null,
  };
}

const AREAS = [
  { re: /SAUDE/, v: 'saude' },
  { re: /SEGURANCA/, v: 'seguranca' },
  { re: /TURIS/, v: 'turismo' },
  { re: /INFRA/, v: 'infraestrutura' },
  { re: /EDUCA/, v: 'educacao' },
  { re: /DEFESA CIVIL/, v: 'defesaCivil' },
];

export function areaDaFrase(texto) {
  const t = semAcento(texto);
  if (!t) return null;
  return (AREAS.find((a) => a.re.test(t)) || {}).v || 'outra';
}

const MODALIDADES = [
  { re: /^PAP CUSTEIO/, v: 'papCusteio' },
  { re: /^PAP INVEST/, v: 'papInvestimento' },
  { re: /^MAC CUSTEIO/, v: 'macCusteio' },
  { re: /^MAC INVEST/, v: 'macInvestimento' },
  { re: /ESPECIAL/, v: 'especial' },
  { re: /MISTO/, v: 'misto' },
  { re: /INVESTIMENTO/, v: 'investimento' },
  { re: /CUSTEIO/, v: 'custeio' },
];

export function modalidadeDaFrase(texto) {
  const t = semAcento(texto);
  if (!t) return null;
  return (MODALIDADES.find((m) => m.re.test(t)) || {}).v || null;
}

/**
 * A chave de uma destinação, e por que ela precisa de tanto.
 *
 * A planilha não tem identificador de linha, então a chave é derivada do
 * conteúdo — e nenhum campo sozinho distingue. A mesma emenda vai para vinte
 * cidades; a mesma cidade recebe de cinco emendas; e o mesmo beneficiário, na
 * mesma cidade, pela mesma emenda, aparece cinco vezes com objetos diferentes:
 * o Instituto Geral de Perícias em 2020 são cinco compras distintas de
 * equipamento sob a emenda 41160008.
 *
 * Por isso a base é ano + emenda + município + beneficiário + objeto. Sobram
 * grupos em que nem o objeto distingue — quatro repasses de custeio ao mesmo
 * hospital, com valores diferentes —, e aí entra a numeração dentro do grupo.
 *
 * O valor de propósito NÃO entra na chave: se entrasse, corrigir um centavo na
 * planilha criaria registro novo e deixaria o antigo órfão, com o andamento
 * escrito nele. Numerando por ordem de valor, a correção atualiza a linha certa.
 *
 * Sem número de emenda a chave continua funcionando: 144 das 758 linhas estão
 * nessa situação — foram indicadas e ainda não viraram emenda formal —, e
 * exigir o número deixaria de fora quase um quinto do trabalho do gabinete.
 */
export function chaveBase(d) {
  const pedaco = (t, tamanho = 28) => semAcento(t).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, tamanho) || 'sem';
  return [
    d.ano || 'sem-ano',
    d.numeroEmenda || 'sem-emenda',
    pedaco(d.municipio),
    pedaco(d.beneficiario || d.instituicao),
    pedaco(d.objeto, 36),
  ].join('-');
}

/**
 * Numera as destinações dentro de cada grupo de chave repetida.
 *
 * A ordem é a do valor, e não a da planilha: reordenar linhas num arquivo é
 * comum, e uma chave que dependesse da posição faria toda reimportação após um
 * reordenamento duplicar o grupo inteiro.
 */
export function numerarDestinacoes(lista) {
  const grupos = new Map();
  for (const d of lista) {
    const base = chaveBase(d);
    if (!grupos.has(base)) grupos.set(base, []);
    grupos.get(base).push(d);
  }
  const saida = [];
  for (const [base, doGrupo] of grupos) {
    doGrupo.sort((a, b) => (a.valorDestinado || 0) - (b.valorDestinado || 0));
    doGrupo.forEach((d, i) => saida.push({
      ...d,
      id: doGrupo.length > 1 ? `${base}-${i + 1}` : base,
    }));
  }
  return saida;
}

/** Uma linha da planilha do gabinete, do jeito que o sistema guarda. */
export function destinacaoDaLinha(linha, mapa) {
  const campo = (nome) => (mapa[nome] === undefined ? '' : String(linha[mapa[nome]] ?? '').trim());

  const municipio = campo('municipio');
  if (!municipio) return null;

  const bruta = campo('situacao');
  const { tipo, processoSeletivo } = tipoEProcesso(campo('tipo'));

  return {
    ano: Math.round(numeroBr(campo('ano'))) || null,
    municipio,
    regiao: campo('regiao') || null,
    endereco: campo('endereco') || null,
    beneficiario: campo('beneficiario') || null,
    instituicao: campo('instituicao') || null,
    cnpj: campo('cnpj') || null,
    numeroEmenda: numeroDaEmenda(campo('numeroEmenda')),
    area: areaDaFrase(campo('area') || campo('areaAlocacao')),
    areaAlocacao: campo('areaAlocacao') || null,
    modalidade: modalidadeDaFrase(campo('modalidade')),
    valorDestinado: numeroBr(campo('valorDestinado')) || 0,
    tipo,
    processoSeletivo,
    objeto: campo('objeto') || null,
    situacao: situacaoDaFrase(bruta) || 'indicado',
    // O texto original fica inteiro: é nele que está o que só o gabinete sabe,
    // e reduzi-lo à lista curta jogaria fora a informação, não o ruído.
    situacaoOriginal: bruta || null,
    andamento: campo('andamento') || null,
    observacoes: campo('observacoes') || null,
    fonte: 'Mapa de emendas do gabinete',
    importadoEm: new Date().toISOString().slice(0, 10),
  };
}

// ────────────────── a aba de conciliação, feita no gabinete ──────────────────

/**
 * A auditoria do mapa contra as fontes públicas, linha a linha.
 *
 * É a aba que o gabinete montou conferindo o Mapa contra SIGA-Brasil,
 * Transferegov e o painel de transferências especiais — o trabalho que o painel
 * do SERPRO não entrega e que este sistema não tem como fazer sozinho. Ela vem
 * no mesmo arquivo do Mapa e alinhada linha a linha com ele, o que resolve de
 * graça o problema mais difícil de casar duas planilhas: a coluna "Linha no
 * novo mapa" é o número da linha, e não uma chave derivada do conteúdo.
 */
const COLUNAS_CONCILIACAO = {
  linhaNoMapa: ['linha no novo mapa', 'linha no mapa', 'linha'],
  ano: ['ano'],
  municipio: ['municipio'],
  beneficiario: ['beneficiario'],
  numeroEmendaNoMapa: ['n emenda no mapa', 'no emenda no mapa', 'numero emenda no mapa'],
  emendaConciliada: ['n emenda conciliado', 'no emenda conciliado', 'numero emenda conciliado'],
  valorNoMapa: ['valor no mapa'],
  sigaPagoFavorecido: ['siga pago ao favorecido municipio', 'siga pago ao favorecido'],
  statusPix: ['status pix'],
  cnpjPublico: ['cnpj publico candidato', 'cnpj publico'],
  resultado: ['resultado da conciliacao'],
  prioridade: ['prioridade'],
  correcaoSugerida: ['correcao atualizacao sugerida', 'correcao sugerida'],
  notaEvidencia: ['nota de evidencia'],
  urlPublica: ['url publica'],
};

export function mapearColunasDaConciliacao(cabecalho) {
  const chaves = cabecalho.map(chaveDoRotulo);
  const mapa = {};
  for (const [campo, nomes] of Object.entries(COLUNAS_CONCILIACAO)) {
    const i = chaves.findIndex((c) => nomes.includes(c));
    if (i !== -1) mapa[campo] = i;
  }
  return mapa;
}

export function ehConciliacao(cabecalho) {
  const m = mapearColunasDaConciliacao(cabecalho);
  return m.linhaNoMapa !== undefined && m.resultado !== undefined;
}

/**
 * Quanto o resultado da conciliação pede atenção.
 *
 * A prioridade é escrita por extenso na planilha; aqui ela vira ordem, para que
 * a tela possa mostrar o mais grave primeiro sem depender de acentuação nem de
 * caixa. CRÍTICA é uma linha só nas 764 — e é justamente a de R$ 15,3 milhões.
 */
export const PESO_PRIORIDADE = { critica: 3, alta: 2, media: 1, baixa: 0 };

export function prioridadeDaFrase(texto) {
  const t = semAcento(texto).toLowerCase().trim();
  if (!t) return null;
  if (t.startsWith('crit')) return 'critica';
  if (t.startsWith('alta')) return 'alta';
  if (t.startsWith('med')) return 'media';
  if (t.startsWith('baix')) return 'baixa';
  return null;
}

/** Uma linha da aba de conciliação, do jeito que o sistema guarda. */
export function conciliacaoDaLinha(linha, mapa) {
  const campo = (nome) => (mapa[nome] === undefined ? '' : String(linha[mapa[nome]] ?? '').trim());
  const numeroLinha = Math.round(numeroBr(campo('linhaNoMapa')));
  if (!numeroLinha) return null;

  return {
    linhaNoMapa: numeroLinha,
    // Guardados só para conferir se as duas abas falam da mesma linha. Alinhar
    // pelo número da linha é exato quando as abas vêm do mesmo arquivo, e um
    // desastre silencioso quando não vêm.
    ano: Math.round(numeroBr(campo('ano'))) || null,
    municipio: campo('municipio') || null,
    valorNoMapa: numeroBr(campo('valorNoMapa')) || 0,

    emendaConciliada: campo('emendaConciliada') || null,
    resultadoConciliacao: campo('resultado') || null,
    prioridadeConciliacao: prioridadeDaFrase(campo('prioridade')),
    correcaoSugerida: campo('correcaoSugerida') || null,
    notaEvidencia: campo('notaEvidencia') || null,
    urlPublica: campo('urlPublica') || null,
    cnpjPublico: campo('cnpjPublico') || null,
    sigaPagoFavorecido: numeroBr(campo('sigaPagoFavorecido')) || 0,
    statusPix: campo('statusPix') || null,
    auditadoEm: new Date().toISOString().slice(0, 10),
  };
}

/**
 * A conciliação colada na destinação certa — ou em nenhuma.
 *
 * O número da linha alinha; o ano e o município conferem. Uma aba de
 * conciliação de outro arquivo, ou de uma versão anterior do mapa, alinharia
 * mesmo assim e escreveria a evidência de uma linha na destinação de outra —
 * silenciosamente, que é o pior jeito de errar. Por isso o que não confere não
 * é aplicado, e é contado para aparecer no aviso.
 */
export function juntarConciliacao(destinacoes, conciliacoes) {
  const porLinha = new Map(conciliacoes.map((c) => [c.linhaNoMapa, c]));
  let aplicadas = 0;
  let discordantes = 0;

  const saida = destinacoes.map((d) => {
    const c = porLinha.get(d.linhaNoMapa);
    if (!c) return d;
    const mesmaLinha = (!c.ano || c.ano === d.ano)
      && (!c.municipio || semAcento(c.municipio) === semAcento(d.municipio));
    if (!mesmaLinha) { discordantes += 1; return d; }
    aplicadas += 1;
    const { linhaNoMapa, ano, municipio, valorNoMapa, ...evidencia } = c;
    return { ...d, ...evidencia };
  });

  return {
    destinacoes: saida,
    aplicadas,
    discordantes,
    semPar: conciliacoes.length - aplicadas - discordantes,
    criticas: saida.filter((d) => d.prioridadeConciliacao === 'critica').length,
    revisar: saida.filter((d) => ['critica', 'alta'].includes(d.prioridadeConciliacao)).length,
    comCorrecao: saida.filter((d) => d.correcaoSugerida).length,
  };
}

// ─────────────────────────── a planilha do governo ───────────────────────────

const COLUNAS_GOVERNO = {
  autor: ['autor'],
  numeroEmenda: ['n emenda', 'no emenda', 'numero emenda'],
  ano: ['ano emenda', 'ano'],
  instrumento: ['n instrumento', 'no instrumento', 'numero instrumento'],
  link: ['link'],
  situacao: ['situacao'],
  modalidade: ['modalidade'],
  orgao: ['orgao concedente'],
  uf: ['uf'],
  municipio: ['municipio'],
  proponente: ['nome proponente', 'proponente'],
  objeto: ['objeto'],
  valorEmpenhado: ['valor empenhado'],
  // "Desembolsado" é como o painel chama o pago. Sem este sinônimo toda linha
  // entra com pago zerado, e a pergunta que justifica a área — já foi pago? —
  // responde errado em silêncio.
  valorPago: ['valor desembolsado', 'valor pago'],
};

export function mapearColunasDoGoverno(cabecalho) {
  const chaves = cabecalho.map(chaveDoRotulo);
  const mapa = {};
  for (const [campo, nomes] of Object.entries(COLUNAS_GOVERNO)) {
    const i = chaves.findIndex((c) => nomes.includes(c));
    if (i !== -1) mapa[campo] = i;
  }
  return mapa;
}

export function ehDoGoverno(cabecalho) {
  const m = mapearColunasDoGoverno(cabecalho);
  return m.numeroEmenda !== undefined && m.instrumento !== undefined
    && m.municipio !== undefined && m.valorEmpenhado !== undefined;
}

/** Por onde as duas planilhas se encontram: ano, emenda e município. */
export function chaveDoEncontro(ano, numeroEmenda, municipio) {
  if (!ano || !numeroEmenda || !municipio) return null;
  return `${ano}|${numeroEmenda}|${semAcento(municipio)}`;
}

/**
 * Reúne as linhas do governo por encontro.
 *
 * Um mesmo convênio pode ser custeado por duas emendas, e o painel repete a
 * linha inteira com os mesmos valores — somar contaria o mesmo repasse duas
 * vezes. Por instrumento, o dinheiro é contado uma vez.
 */
export function reunirGoverno(linhas, mapa) {
  const campo = (l, nome) => (mapa[nome] === undefined ? '' : String(l[mapa[nome]] ?? '').trim());
  const porEncontro = new Map();

  for (const l of linhas) {
    const chave = chaveDoEncontro(
      Math.round(numeroBr(campo(l, 'ano'))) || null,
      numeroDaEmenda(campo(l, 'numeroEmenda')),
      campo(l, 'municipio'),
    );
    if (!chave) continue;

    if (!porEncontro.has(chave)) {
      porEncontro.set(chave, {
        valorEmpenhado: 0,
        valorPago: 0,
        instrumentos: new Set(),
        link: null,
        situacaoInstrumento: null,
        orgaoConcedente: null,
        proponente: null,
      });
    }
    const e = porEncontro.get(chave);
    const instrumento = campo(l, 'instrumento');
    // O mesmo instrumento repetido não soma; instrumentos diferentes, sim.
    if (instrumento && e.instrumentos.has(instrumento)) continue;
    if (instrumento) e.instrumentos.add(instrumento);
    e.valorEmpenhado += numeroBr(campo(l, 'valorEmpenhado')) || 0;
    e.valorPago += numeroBr(campo(l, 'valorPago')) || 0;
    e.link = e.link || campo(l, 'link') || null;
    e.situacaoInstrumento = e.situacaoInstrumento || campo(l, 'situacao') || null;
    e.orgaoConcedente = e.orgaoConcedente || campo(l, 'orgao') || null;
    e.proponente = e.proponente || campo(l, 'proponente') || null;
  }

  for (const e of porEncontro.values()) {
    e.numeroInstrumento = [...e.instrumentos].join(', ') || null;
    delete e.instrumentos;
  }
  return porEncontro;
}

/**
 * O que o governo acrescenta a uma destinação, e onde as duas discordam.
 *
 * Discordar aqui é o valor pago superar o destinado, ou o destinado existir e o
 * governo não conhecer nada. A marca não resolve nada sozinha — ela chama
 * alguém para resolver, que é a diferença entre um sistema que informa e um que
 * decide no lugar de quem responde pela decisão.
 */
export function conciliar(destinacao, doGoverno, doGrupo = null) {
  if (!doGoverno) return { semCorrespondente: true };

  const grupo = doGrupo || { destinado: Number(destinacao.valorDestinado) || 0, quantas: 1, chave: null };
  const pago = Number(doGoverno.valorPago) || 0;
  const empenhado = Number(doGoverno.valorEmpenhado) || 0;

  // Um real de folga absorve arredondamento de planilha, que não é divergência.
  const excede = grupo.destinado > 0 && Math.max(pago, empenhado) - grupo.destinado > 1;

  return {
    valorEmpenhado: empenhado,
    valorPago: pago,
    // O valor do governo é do encontro — ano, emenda e município —, não da
    // linha. Cinco compras de equipamento do IGP sob a mesma emenda casam com
    // um convênio só: repetir o valor em cada uma e somar contaria o mesmo
    // repasse cinco vezes. A marca aqui é o que permite somar uma vez.
    encontroGoverno: grupo.chave,
    destinacoesNoEncontro: grupo.quantas,
    numeroInstrumento: doGoverno.numeroInstrumento,
    linkInstrumento: doGoverno.link,
    situacaoInstrumento: doGoverno.situacaoInstrumento,
    orgaoConcedente: doGoverno.orgaoConcedente,
    proponente: doGoverno.proponente,
    divergente: excede || null,
    // O estado vem do dinheiro quando o governo o conhece: é mais recente que
    // qualquer anotação, e é oficial.
    situacao: pago && grupo.destinado && pago + 1 >= grupo.destinado ? 'pago'
      : (pago ? 'pagoParcial' : (empenhado ? 'empenhado' : destinacao.situacao)),
  };
}

// ─────────────────────────────── importação ───────────────────────────────

/**
 * O Mapa de emendas do gabinete — a fonte do que existe.
 *
 * Botão próprio, e não detecção automática: um botão que aceita dois arquivos
 * diferentes obriga quem usa a adivinhar o que vai acontecer, e quando dá
 * errado o recado fala do outro arquivo. Dois botões dizem o que cada um faz
 * antes de o arquivo ser escolhido.
 */
export async function importarMapaDoGabinete(arquivo) {
  const { cabecalho, linhas, aba, abas } = await lerPlanilha(arquivo, { dica: 'mapa de emendas' });
  const onde = aba ? ` (aba "${aba}")` : '';
  let conciliacao = null;

  if (!cabecalho.length) {
    throw new Error(`A planilha${onde} está vazia.${abas?.length > 1 ? ` As abas do arquivo são: ${abas.join(', ')}.` : ''}`);
  }
  if (ehDoGoverno(cabecalho)) {
    throw new Error('Este é o arquivo exportado do painel do governo, não o Mapa de emendas. Use o outro botão — "Confirmar pelo painel".');
  }
  if (!ehDoGabinete(cabecalho)) {
    // Dizer qual aba foi lida e quais existem: num arquivo de dezesseis abas,
    // "não reconheci" sem isso não deixa ninguém sair do lugar.
    throw new Error(`Não reconheci o Mapa de emendas${onde}. Esperava as colunas Ano, município, Região e Beneficiário; achei "${cabecalho.slice(0, 6).filter(Boolean).join(', ')}".${abas?.length > 1 ? ` Abas do arquivo: ${abas.join(', ')}.` : ''}`);
  }

  // A conciliação vem de carona quando existe, sem botão próprio.
  //
  // Ela está no mesmo arquivo e alinhada linha a linha com o Mapa — foi feita
  // assim. Um segundo botão obrigaria a escolher entre importar o mapa e
  // importar a auditoria dele, que é uma escolha que não existe: são o mesmo
  // arquivo, e importar duas planilhas em botões separados já confundiu uma vez.
  if ((abas || []).some((a) => chaveDoRotulo(a) === 'conciliacao')) {
    try {
      const outra = await lerPlanilha(arquivo, { dica: 'conciliação' });
      if (ehConciliacao(outra.cabecalho)) conciliacao = outra;
    } catch (erro) {
      // A aba existir e não ser legível não pode derrubar o Mapa: ele é a fonte,
      // e a conciliação é o acréscimo.
      console.warn('aba de conciliação ilegível:', erro.message);
    }
  }

  return importarMapa(cabecalho, linhas, conciliacao);
}

/**
 * A exportação do painel — confirma valor no que já existe.
 *
 * Ela não cria destinação: sozinha, não sabe de região, objeto nem beneficiário.
 * Por isso exige que o Mapa tenha entrado antes, e diz isso antes de ler o
 * arquivo inteiro.
 */
export async function importarDoPainel(arquivo) {
  const { cabecalho, linhas, aba, abas } = await lerPlanilha(arquivo);
  const onde = aba ? ` (aba "${aba}")` : '';

  if (!cabecalho.length) throw new Error(`A planilha${onde} está vazia.`);
  if (ehDoGabinete(cabecalho)) {
    throw new Error('Este é o Mapa de emendas do gabinete, não a exportação do painel. Use o outro botão — "Importar Mapa de emendas".');
  }
  if (!ehDoGoverno(cabecalho)) {
    throw new Error(`Não reconheci a exportação do painel${onde}. Esperava Nº Emenda, Nº Instrumento, Município e Valor Empenhado; achei "${cabecalho.slice(0, 6).filter(Boolean).join(', ')}".${abas?.length > 1 ? ` Abas do arquivo: ${abas.join(', ')}.` : ''}`);
  }
  return importarGoverno(cabecalho, linhas);
}

async function importarMapa(cabecalho, linhas, conciliacao = null) {
  const mapa = mapearColunasDoGabinete(cabecalho);
  // O número da linha na planilha viaja com a destinação: é por ele que a aba
  // de conciliação encontra a sua. A primeira linha de dados é a 2, porque a 1
  // é o cabeçalho — é assim que quem abre o arquivo enxerga, e é assim que a
  // coluna "Linha no novo mapa" foi escrita.
  const cruas = linhas
    .map((l, i) => {
      const d = destinacaoDaLinha(l, mapa);
      return d ? { ...d, linhaNoMapa: i + 2 } : null;
    })
    .filter(Boolean);
  if (!cruas.length) throw new Error('Nenhuma linha tinha município. Confira se a aba é a "Mapa de emendas".');
  let lidas = numerarDestinacoes(cruas);

  let juncao = null;
  if (conciliacao) {
    const colunas = mapearColunasDaConciliacao(conciliacao.cabecalho);
    const linhasConciliadas = conciliacao.linhas.map((l) => conciliacaoDaLinha(l, colunas)).filter(Boolean);
    juncao = juntarConciliacao(lidas, linhasConciliadas);
    lidas = juncao.destinacoes;
  }

  const { salvarEmLote, listar } = await import('./dados.js');
  const guardadas = new Map((await listar('destinacoes', { recarregar: true })).map((d) => [d.id, d]));

  let novas = 0;
  let atualizadas = 0;
  let preservados = 0;
  let corrigidosMantidos = 0;
  const registros = lidas.map(({ id, linhaNoMapa, ...d }) => {
    const antiga = guardadas.get(id);
    if (antiga) atualizadas += 1; else novas += 1;

    // O que é do gabinete e foi escrito aqui dentro não volta atrás numa
    // reimportação: responsável na cidade, andamento e conciliação são trabalho
    // de gente, e a planilha não os conhece.
    const dados = { ...d };
    if (antiga?.andamento) dados.andamento = antiga.andamento;
    if (antiga?.fonteQueVale) dados.situacao = antiga.situacao;

    // O número corrigido aqui dentro não volta ao que a planilha diz.
    //
    // A reimportação sobrescrever é o que faz da planilha a fonte. Mas quando
    // a auditoria mostra que a própria planilha está errada, devolver o valor
    // errado a cada importação transformaria a correção em trabalho de Sísifo.
    // Só os campos explicitamente corrigidos escapam — o resto continua vindo
    // do arquivo.
    for (const campo of antiga?.camposCorrigidos || []) {
      if (antiga[campo] !== undefined) dados[campo] = antiga[campo];
      corrigidosMantidos += 1;
    }

    // Célula vazia não apaga o que já estava preenchido.
    //
    // Uma versão nova do Mapa pode vir com uma coluna quebrada — a Região saiu
    // como erro de fórmula em 753 das 764 linhas de uma delas — e reimportar
    // apagaria, sem aviso, um dado que estava certo. Vazio é "não sei", não é
    // "não tem".
    //
    // Zero não entra nesta regra: em dinheiro, zero é um valor que alguém
    // escreveu — há destinações de R$ 0,00 na planilha —, e preservá-lo como se
    // fosse ausência congelaria para sempre um número que mudou.
    if (antiga) {
      for (const [chave, valor] of Object.entries(dados)) {
        const branco = valor === null || valor === '';
        if (branco && antiga[chave] !== undefined && antiga[chave] !== null && antiga[chave] !== '') {
          dados[chave] = antiga[chave];
          preservados += 1;
        }
      }
    }
    return { id, dados };
  });

  const gravacao = await salvarEmLote('destinacoes', registros);
  if (gravacao.falhas.length) throw gravacao.falhas[0];

  // O que estava aqui e não veio nesta versão do Mapa.
  //
  // Corrigir o nº de uma emenda na planilha muda a chave da destinação, e a
  // linha antiga fica para trás — com o andamento escrito nela. Apagar sozinho
  // seria pior: uma planilha importada pela metade levaria junto o trabalho de
  // todo mundo. Então elas ficam, e são contadas para alguém decidir.
  const vieram = new Set(registros.map((r) => r.id));
  const orfas = [...guardadas.values()]
    .filter((d) => d.fonte === 'Mapa de emendas do gabinete' && !vieram.has(d.id)).length;

  return {
    origem: 'gabinete',
    linhas: linhas.length,
    destinacoes: registros.length,
    novas,
    atualizadas,
    preservados,
    corrigidosMantidos,
    orfas,
    municipios: new Set(lidas.map((d) => d.municipio)).size,
    emendas: new Set(lidas.map((d) => d.numeroEmenda).filter(Boolean)).size,
    semEmenda: lidas.filter((d) => !d.numeroEmenda).length,
    destinado: lidas.reduce((t, d) => t + (d.valorDestinado || 0), 0),
    conciliacao: juncao && {
      aba: conciliacao.aba,
      aplicadas: juncao.aplicadas,
      discordantes: juncao.discordantes,
      semPar: juncao.semPar,
      criticas: juncao.criticas,
      revisar: juncao.revisar,
      comCorrecao: juncao.comCorrecao,
    },
  };
}

async function importarGoverno(cabecalho, linhas) {
  const mapa = mapearColunasDoGoverno(cabecalho);
  const porEncontro = reunirGoverno(linhas, mapa);

  const { salvarEmLote, listar } = await import('./dados.js');
  const guardadas = await listar('destinacoes', { recarregar: true });
  if (!guardadas.length) {
    throw new Error('Importe primeiro o Mapa de emendas do gabinete. Esta planilha confirma valores das destinações que já existem — sozinha, ela não sabe de região, objeto nem beneficiário.');
  }

  // As destinações que casam com o mesmo encontro formam um grupo: o valor do
  // governo é do grupo inteiro, e o destinado com que ele se compara também.
  const porChave = new Map();
  for (const d of guardadas) {
    const chave = chaveDoEncontro(d.ano, d.numeroEmenda, d.municipio);
    if (!chave || !porEncontro.has(chave)) continue;
    if (!porChave.has(chave)) porChave.set(chave, []);
    porChave.get(chave).push(d);
  }

  let casaram = 0;
  let divergentes = 0;
  let empenhado = 0;
  let pago = 0;
  const registros = [];

  for (const [chave, doGrupo] of porChave) {
    const doGoverno = porEncontro.get(chave);
    const grupo = {
      chave,
      quantas: doGrupo.length,
      destinado: doGrupo.reduce((t, d) => t + (Number(d.valorDestinado) || 0), 0),
    };
    // Contado uma vez por encontro, e não por linha.
    empenhado += Number(doGoverno.valorEmpenhado) || 0;
    pago += Number(doGoverno.valorPago) || 0;

    for (const d of doGrupo) {
      const conciliado = conciliar(d, doGoverno, grupo);
      if (conciliado.divergente) divergentes += 1;
      casaram += 1;
      registros.push({ id: d.id, dados: conciliado });
    }
  }

  if (registros.length) {
    const gravacao = await salvarEmLote('destinacoes', registros);
    if (gravacao.falhas.length) throw gravacao.falhas[0];
  }

  return {
    origem: 'governo',
    linhas: linhas.length,
    encontros: porEncontro.size,
    casaram,
    encontrosUsados: porChave.size,
    divergentes,
    // O que o painel tem e o gabinete não: pode ser emenda que ninguém anotou,
    // ou município grafado diferente. Dito, para alguém olhar.
    semParNoGabinete: [...porEncontro.keys()].filter((k) => !porChave.has(k)).length,
    empenhado,
    pago,
  };
}

// ─────────────────────── consolidação por município ───────────────────────

/**
 * A cidade é a mesma quando o nome só muda de caixa.
 *
 * A planilha do gabinete foi digitada por muitas mãos ao longo de anos, e traz
 * "Caxias do sul", "Caxias Do Sul" e "Caxias do Sul" como se fossem três
 * lugares. Agrupar pelo texto cru partia o município em três linhas, cada uma
 * com um pedaço do total — e a pergunta da tela é justamente quanto foi para
 * aquela cidade.
 */
const CONECTIVOS = new Set(['do', 'da', 'de', 'dos', 'das', 'e']);

/** Quanto do nome segue a grafia usual: nomes maiúsculos, conectivos não. */
function conformidade(nome) {
  const palavras = String(nome).split(/\s+/).filter(Boolean);
  if (!palavras.length) return 0;
  let certas = 0;
  for (const p of palavras) {
    const baixa = p.toLocaleLowerCase('pt-BR');
    const esperada = CONECTIVOS.has(baixa)
      ? baixa
      : baixa.charAt(0).toLocaleUpperCase('pt-BR') + baixa.slice(1);
    if (p === esperada) certas += 1;
  }
  return certas / palavras.length;
}

/**
 * Entre as grafias vistas, a que se escreve. Escolhe-se a existente e não uma
 * inventada: aplicar caixa automática produziria "Caxias Do Sul", que está
 * errado em português e ninguém escreveu.
 */
export function nomeCanonico(variantes) {
  return [...variantes.entries()]
    .sort((a, b) => (conformidade(b[0]) - conformidade(a[0])) || (b[1] - a[1]) || a[0].localeCompare(b[0], 'pt-BR'))[0][0];
}

/**
 * Consolida as destinações por cidade.
 *
 * O valor do governo é do encontro (ano + emenda + município), não da linha:
 * cinco compras de equipamento sob a mesma emenda casam com um convênio só.
 * Somar por linha contaria o mesmo repasse cinco vezes — foi assim que uma
 * versão anterior desta área chegou a R$ 95 milhões onde havia R$ 60.
 */
export function consolidarDestinacoes(destinacoes) {
  const mapa = new Map();
  const encontrosContados = new Set();

  for (const d of destinacoes) {
    const nome = (d.municipio || 'Sem município').trim();
    const chave = semAcento(nome);
    if (!mapa.has(chave)) {
      mapa.set(chave, {
        municipio: nome,
        variantes: new Map(),
        regiao: d.regiao || null,
        destinado: 0,
        empenhado: 0,
        pago: 0,
        divergentes: 0,
        destinacoes: [],
      });
    }
    const m = mapa.get(chave);
    m.variantes.set(nome, (m.variantes.get(nome) || 0) + 1);
    m.regiao = m.regiao || d.regiao || null;
    m.destinado += Number(d.valorDestinado) || 0;
    if (d.divergente) m.divergentes += 1;

    const encontro = d.encontroGoverno;
    if (!encontro || !encontrosContados.has(encontro)) {
      if (encontro) encontrosContados.add(encontro);
      m.empenhado += Number(d.valorEmpenhado) || 0;
      m.pago += Number(d.valorPago) || 0;
    }
    m.destinacoes.push(d);
  }

  return [...mapa.values()]
    .map(({ variantes, ...m }) => ({
      ...m,
      municipio: nomeCanonico(variantes),
      destinacoes: m.destinacoes.sort((a, b) => (b.valorDestinado || 0) - (a.valorDestinado || 0)),
    }))
    .sort((a, b) => b.destinado - a.destinado);
}

// ────────────────────── o que se anota antes da visita ──────────────────────

/**
 * Uma anotação datada no topo do histórico.
 *
 * O andamento é o único campo que só existe porque alguém escreveu — nenhuma
 * planilha o traz. E ele é escrito no meio do trabalho: ao desligar o telefone
 * com a prefeitura, não ao abrir um formulário de 36 campos. Por isso a
 * anotação entra pela própria linha da destinação, e por isso a mais recente
 * fica em cima: quem lê antes de viajar quer o último capítulo, não o primeiro.
 *
 * Devolve o texto novo do campo, ou `null` quando não há o que anotar.
 */
export function anotarAndamento(anterior, texto, { autor = '', data = '' } = {}) {
  const limpo = String(texto || '').trim();
  if (!limpo) return null;
  const dia = String(data || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const [a, m, d] = dia.split('-');
  const carimbo = d ? `${d}/${m}/${a}` : dia;
  const entrada = `${autor ? `${carimbo} · ${autor}` : carimbo} — ${limpo}`;
  const antes = String(anterior || '').trim();
  return antes ? `${entrada}\n${antes}` : entrada;
}

/**
 * A divergência resolvida por gente, com o motivo junto.
 *
 * Conciliar sozinho foi o que produziu, nas versões anteriores desta área,
 * número que ninguém sabia defender numa reunião. Aqui alguém escolhe a fonte,
 * e o motivo é obrigatório porque a decisão vai ser dita em voz alta na frente
 * de um prefeito — e, se não estiver escrito, ninguém vai lembrar por quê.
 *
 * Devolve o remendo a gravar, ou `null` se falta fonte ou motivo.
 */
export function resolverDivergencia({ fonte, motivo, por = '', em = '' } = {}) {
  if (fonte !== 'gabinete' && fonte !== 'governo') return null;
  const razao = String(motivo || '').trim();
  if (!razao) return null;
  return {
    fonteQueVale: fonte,
    motivoConciliacao: razao,
    conciliadoPor: por,
    conciliadoEm: String(em || new Date().toISOString().slice(0, 10)).slice(0, 10),
    // A marca sai porque o trabalho foi feito, não porque os números passaram a
    // bater: eles continuam diferentes, e o registro diz qual vale.
    divergente: false,
  };
}

/** Os campos que a correção manual pode tocar, e como cada um se lê. */
export const CAMPOS_CORRIGIVEIS = {
  valorDestinado: { rotulo: 'Destinado', dinheiro: true },
  numeroEmenda: { rotulo: 'Nº da emenda' },
};

/**
 * O número corrigido aqui dentro, que a reimportação não desfaz.
 *
 * A planilha é a fonte, e por isso a reimportação sobrescreve — é o que faz
 * dela a fonte. Mas quando a auditoria mostra que a própria planilha está
 * errada, corrigir só na tela seria trabalho perdido no próximo arquivo, e
 * corrigir só na planilha adiaria a correção até alguém abrir o Excel. Então o
 * campo corrigido fica marcado, e a importação passa por cima de tudo menos
 * dele.
 *
 * A correção não é silenciosa: o que era, o que passou a ser e por quê entram
 * no andamento, datados e assinados, porque é lá que se lê a história da
 * destinação — e um número que muda sozinho é a pior coisa que este sistema
 * poderia fazer.
 *
 * Devolve o remendo a gravar, ou `null` se nada mudou ou falta o motivo.
 */
export function aplicarCorrecao(destinacao, valores, { motivo, por = '', em = '' } = {}) {
  const dia = String(em || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const razao = String(motivo || '').trim();

  const mudancas = [];
  const remendo = {};
  for (const [campo, def] of Object.entries(CAMPOS_CORRIGIVEIS)) {
    if (!(campo in valores)) continue;
    const antes = destinacao[campo] ?? null;
    const depois = def.dinheiro
      ? (valores[campo] === '' || valores[campo] === null ? null : Number(valores[campo]))
      : (String(valores[campo] ?? '').trim() || null);
    if (depois === null || depois === antes) continue;
    if (def.dinheiro && !Number.isFinite(depois)) continue;
    remendo[campo] = depois;
    mudancas.push(`${def.rotulo}: ${formatar(antes, def)} → ${formatar(depois, def)}`);
  }

  if (!mudancas.length) return null;
  if (!razao) return null;

  const corrigidos = new Set([...(destinacao.camposCorrigidos || []), ...Object.keys(remendo)]);
  return {
    ...remendo,
    camposCorrigidos: [...corrigidos],
    motivoCorrecao: razao,
    corrigidoPor: por,
    corrigidoEm: dia,
    // A auditoria apontou e alguém agiu: a linha para de pedir revisão sem que
    // o resultado da auditoria seja apagado — ele continua sendo o que ela viu.
    revisaoResolvidaEm: dia,
    andamento: anotarAndamento(
      destinacao.andamento,
      `Corrigido no sistema — ${mudancas.join('; ')}. Motivo: ${razao}`,
      { autor: por, data: dia },
    ),
  };
}

function formatar(valor, def) {
  if (valor === null || valor === undefined || valor === '') return '—';
  if (!def.dinheiro) return String(valor);
  return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Como a correção feita aqui dentro se lê na linha. */
export function leituraDaCorrecao(d) {
  if (!d || !d.camposCorrigidos?.length) return null;
  const quais = d.camposCorrigidos.map((c) => CAMPOS_CORRIGIVEIS[c]?.rotulo || c).join(' e ');
  const quem = [d.corrigidoPor, d.corrigidoEm ? d.corrigidoEm.slice(0, 10).split('-').reverse().join('/') : null]
    .filter(Boolean).join(', ');
  return `${quais} corrigido no sistema${d.motivoCorrecao ? `: ${d.motivoCorrecao}` : ''}${quem ? ` (${quem})` : ''}`;
}

/** Como a decisão se lê na linha, depois de tomada. */
export function leituraDaConciliacao(d) {
  if (!d || !d.fonteQueVale) return null;
  const fonte = d.fonteQueVale === 'governo' ? 'Vale o painel do governo' : 'Vale a planilha do gabinete';
  const quem = [d.conciliadoPor, d.conciliadoEm ? d.conciliadoEm.slice(0, 10).split('-').reverse().join('/') : null]
    .filter(Boolean).join(', ');
  return `${fonte}${d.motivoConciliacao ? `: ${d.motivoConciliacao}` : ''}${quem ? ` (${quem})` : ''}`;
}

/** A leitura de "já foi pago?" numa etiqueta. */
export function situacaoDaCidade(m) {
  if (m.divergentes) return { texto: 'Fontes divergem', cor: 'critico' };
  if (m.pago && m.pago + 1 >= m.destinado) return { texto: 'Pago', cor: 'ok' };
  if (m.pago) return { texto: 'Pago em parte', cor: 'atencao' };
  if (m.empenhado) return { texto: 'Empenhado', cor: 'atencao' };
  return { texto: 'Indicado', cor: 'neutro' };
}

