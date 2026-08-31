import {
  el, limpar, fmtData, fmtDataHora, fmtDinheiro, fmtDinheiroCurto, diasAte, carregando, etiqueta, aviso, hoje,
} from './ui.js';
import { listar, salvar } from './dados.js';
import { porId } from './modulos.js';
import {
  consolidarDestinacoes, situacaoDaCidade, anotarAndamento, resolverDivergencia, leituraDaConciliacao,
  PESO_PRIORIDADE,
} from './destinacoes.js';

/** Painéis consolidados. Diferente dos módulos, estes são desenhados à mão. */

function bloco(titulo, complemento, filhos) {
  return el('section', { class: 'bloco' }, [
    el('header', { class: 'bloco-topo' }, [
      el('h2', { texto: titulo }),
      complemento ? el('span', { class: 'bloco-contagem', texto: complemento }) : null,
    ]),
    ...filhos,
  ]);
}

function nada(texto) {
  return el('p', { class: 'bloco-vazio', texto });
}

function indicador(rotulo, valor, tom = 'neutro', detalhe = '') {
  return el('div', { class: `indicador indicador--${tom}` }, [
    el('span', { class: 'indicador-rotulo', texto: rotulo }),
    el('strong', { class: 'indicador-valor', texto: valor }),
    detalhe ? el('span', { class: 'indicador-detalhe', texto: detalhe }) : null,
  ]);
}

function linha(principal, secundario, marcador = null) {
  return el('li', { class: 'linha' }, [
    el('div', { class: 'linha-texto' }, [
      el('span', { class: 'linha-principal', texto: principal }),
      secundario ? el('span', { class: 'linha-secundaria', texto: secundario }) : null,
    ]),
    marcador,
  ]);
}

function prazoMarcador(iso) {
  const d = diasAte(iso);
  if (d === null) return null;
  if (d < 0) return etiqueta(`${Math.abs(d)} d atrasado`, 'critico');
  if (d === 0) return etiqueta('hoje', 'critico');
  if (d <= 3) return etiqueta(`em ${d} d`, 'atencao');
  return etiqueta(`em ${d} d`, 'neutro');
}

function nomePor(lista, id) {
  return lista.find((i) => i.id === id)?.nome || '';
}

// ─────────────────────────────── chefia ───────────────────────────────

export async function painelChefia(container) {
  limpar(container).appendChild(carregando());

  const [tarefas, pedidos, imprensa, atendimentos, agenda, equipe, proposicoes] = await Promise.all([
    listar('tarefas', { recarregar: true }),
    listar('solicitacoesAgenda', { recarregar: true }),
    listar('imprensa', { recarregar: true }),
    listar('atendimentos', { recarregar: true }),
    listar('agenda', { recarregar: true }),
    listar('equipe'),
    listar('proposicoes', { recarregar: true }),
  ]);

  // Proposições que andaram nos últimos dias — o que a equipe legislativa
  // precisa ver sem ter de abrir a lista e comparar de cabeça.
  const mexeram = proposicoes
    .filter((p) => p.mudouEm && diasAte(p.mudouEm) >= -7)
    .sort((a, b) => String(b.mudouEm).localeCompare(String(a.mudouEm)));

  const abertas = tarefas.filter((t) => !['concluida', 'cancelada'].includes(t.status));
  const atrasadas = abertas.filter((t) => t.prazo && diasAte(t.prazo) < 0);
  const proximas = abertas
    .filter((t) => t.prazo && diasAte(t.prazo) >= 0 && diasAte(t.prazo) <= 7)
    .sort((a, b) => a.prazo.localeCompare(b.prazo));
  const pendentesAgenda = pedidos.filter((p) => p.status === 'pendente');
  const imprensaAberta = imprensa
    .filter((i) => ['pendente', 'producao'].includes(i.status))
    .sort((a, b) => String(a.prazo || '').localeCompare(String(b.prazo || '')));
  const atendimentosAbertos = atendimentos.filter((a) => ['aberto', 'andamento', 'aguardando'].includes(a.status));

  const agora = new Date().toISOString();
  const compromissos = agenda
    .filter((c) => c.inicio && c.inicio >= agora.slice(0, 16))
    .sort((a, b) => a.inicio.localeCompare(b.inicio))
    .slice(0, 6);

  limpar(container);
  container.appendChild(el('header', { class: 'modulo-topo' }, [
    el('div', { class: 'modulo-titulo' }, [
      el('h1', { texto: 'Painel do gabinete' }),
      el('p', { texto: 'O que exige decisão hoje, reunido das quatro áreas.' }),
    ]),
  ]));

  container.appendChild(el('div', { class: 'indicadores' }, [
    indicador('Tarefas atrasadas', String(atrasadas.length), atrasadas.length ? 'critico' : 'ok'),
    indicador('Tarefas abertas', String(abertas.length), 'info'),
    indicador('Pedidos de agenda', String(pendentesAgenda.length), pendentesAgenda.length ? 'atencao' : 'ok'),
    indicador('Imprensa em aberto', String(imprensaAberta.length), imprensaAberta.length ? 'atencao' : 'ok'),
    indicador('Atendimentos abertos', String(atendimentosAbertos.length), atendimentosAbertos.length ? 'info' : 'ok'),
    indicador('Proposições que andaram', String(mexeram.length), mexeram.length ? 'info' : 'neutro', 'últimos 7 dias'),
  ]));

  const grade = el('div', { class: 'grade-paineis' });

  grade.appendChild(bloco('Tarefas atrasadas', atrasadas.length ? `${atrasadas.length}` : null, [
    atrasadas.length
      ? el('ul', { class: 'lista' }, atrasadas
        .sort((a, b) => a.prazo.localeCompare(b.prazo))
        .slice(0, 8)
        .map((t) => linha(t.titulo, nomePor(equipe, t.responsavel) || 'sem responsável', prazoMarcador(t.prazo))))
      : nada('Nenhuma tarefa em atraso.'),
  ]));

  grade.appendChild(bloco('Vence nos próximos 7 dias', proximas.length ? `${proximas.length}` : null, [
    proximas.length
      ? el('ul', { class: 'lista' }, proximas.slice(0, 8)
        .map((t) => linha(t.titulo, nomePor(equipe, t.responsavel) || 'sem responsável', prazoMarcador(t.prazo))))
      : nada('Nada com prazo próximo.'),
  ]));

  grade.appendChild(bloco('Próximos compromissos', null, [
    compromissos.length
      ? el('ul', { class: 'lista' }, compromissos
        .map((c) => linha(c.titulo, [fmtDataHora(c.inicio), c.local].filter(Boolean).join(' · '))))
      : nada('Agenda sem compromissos futuros registrados.'),
  ]));

  grade.appendChild(bloco('Imprensa aguardando resposta', imprensaAberta.length ? `${imprensaAberta.length}` : null, [
    imprensaAberta.length
      ? el('ul', { class: 'lista' }, imprensaAberta.slice(0, 8)
        .map((i) => linha(i.assunto, [i.veiculo, i.jornalista].filter(Boolean).join(' · '),
          i.prazo ? prazoMarcador(String(i.prazo).slice(0, 10)) : null)))
      : nada('Nenhuma demanda de imprensa pendente.'),
  ]));

  grade.appendChild(bloco('Pedidos de agenda na triagem', pendentesAgenda.length ? `${pendentesAgenda.length}` : null, [
    pendentesAgenda.length
      ? el('ul', { class: 'lista' }, pendentesAgenda.slice(0, 8)
        .map((p) => linha(p.assunto, p.solicitante,
          p.dataPretendida ? prazoMarcador(p.dataPretendida) : null)))
      : nada('Nenhum pedido aguardando decisão.'),
  ]));

  grade.appendChild(bloco('Proposições que mudaram de situação', mexeram.length ? `${mexeram.length}` : null, [
    mexeram.length
      ? el('ul', { class: 'lista' }, mexeram.slice(0, 8).map((p) => linha(
        `${p.identificacao} · ${p.situacao || 'sem situação'}`,
        [p.situacaoAnterior ? `antes: ${p.situacaoAnterior}` : null, p.orgao].filter(Boolean).join(' · '),
        etiqueta(fmtData(p.mudouEm), 'info'),
      )))
      : nada('Nada se moveu nos últimos sete dias.'),
  ]));

  container.appendChild(grade);
}

// ────────────────────────────── orçamento ──────────────────────────────

/**
 * O dinheiro visto pelo município, que é como o gabinete pensa.
 *
 * A pergunta que chega ao gabinete nunca é "o que diz a linha 14 do documento":
 * é "quanto foi para Erechim e já saiu?". As bases federais respondem em outra
 * forma — uma linha por documento de execução, com o município escondido no
 * nome do favorecido — e uma tela com o formato da fonte obriga quem atende o
 * telefone a fazer a tradução de cabeça, toda vez.
 *
 * Aqui a soma é por fase, e não por linha. Um mesmo real aparece na fonte três
 * vezes — empenhado, liquidado, pago — e somar tudo triplicaria o repasse. Cada
 * fase tem sua coluna, e a leitura passa a ser a que interessa: quanto foi
 * destinado, quanto já saiu de fato, e o que travou no caminho.
 */

const FASE_DA_COLUNA = {
  empenho: 'empenhado',
  liquidacao: 'liquidado',
  pagamento: 'pago',
};

const IMPEDIDO = /impedi|indefer|cancelad|devolvid/i;




const semAcento = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');






function agrupar(itens, chave, campo) {
  const mapa = new Map();
  itens.forEach((i) => {
    const v = i[chave] || '—';
    mapa.set(v, (mapa.get(v) || 0) + 1);
  });
  return [...mapa.entries()]
    .map(([v, n]) => ({
      rotulo: campo?.op.find((o) => o.v === v)?.l || (v === '—' ? 'Não informado' : v),
      cor: campo?.op.find((o) => o.v === v)?.cor || 'neutro',
      n,
    }))
    .sort((a, b) => b.n - a.n);
}

/**
 * Soma por categoria, com o rótulo que a pessoa reconhece.
 *
 * O campo de valor é parâmetro porque cada módulo chama o dinheiro de outra
 * coisa — cada base nomeia o valor do seu jeito —, e um agrupador que
 * conhecesse só um deles somaria zero no outro sem reclamar. `campo` traduz a
 * chave interna no rótulo oficial: "passagens" na tela é "Passagens aéreas".
 */
function agruparValor(itens, chave, campo = null, valorEm = 'valorIndicado') {
  const mapa = new Map();
  itens.forEach((i) => {
    const bruto = i[chave];
    const rotulo = campo?.op?.find((o) => o.v === bruto)?.l
      || (bruto === null || bruto === undefined || bruto === '' ? 'Não informado' : String(bruto));
    mapa.set(rotulo, (mapa.get(rotulo) || 0) + (Number(i[valorEm]) || 0));
  });
  return [...mapa.entries()]
    .map(([rotulo, total]) => ({ rotulo, total }))
    .filter((d) => d.total)
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);
}

function barras(dados, total) {
  if (!dados.length) return nada('Sem dados.');
  return el('ul', { class: 'barras' }, dados.map((d) => el('li', {}, [
    el('div', { class: 'barra-topo' }, [
      el('span', { texto: d.rotulo }),
      el('span', { class: 'num', texto: String(d.n) }),
    ]),
    el('div', { class: 'barra-trilho' }, [
      el('div', { class: `barra barra--${d.cor}`, style: `width:${Math.max(2, (d.n / total) * 100)}%` }),
    ]),
  ])));
}

function barrasValor(dados, total) {
  if (!dados.length) return nada('Sem dados.');
  const maior = Math.max(...dados.map((d) => d.total)) || 1;
  return el('ul', { class: 'barras' }, dados.map((d) => el('li', {}, [
    el('div', { class: 'barra-topo' }, [
      el('span', { texto: d.rotulo }),
      el('span', { class: 'num', texto: fmtDinheiroCurto(d.total) }),
    ]),
    el('div', { class: 'barra-trilho' }, [
      el('div', { class: 'barra barra--info', style: `width:${Math.max(2, (d.total / maior) * 100)}%` }),
    ]),
  ])));
}

// ───────────────────────── administrativo: cota ─────────────────────────

/**
 * A cota parlamentar, conferida contra a base da Câmara.
 *
 * A CEAP é a única despesa do mandato publicada lançamento por lançamento, com
 * fornecedor, documento e valor. Digitar isso à mão era transcrever base pública
 * — trabalho que erra, atrasa e não acrescenta nada. O que o gabinete tem a fazer
 * com esses números é conferir, comparar e explicar, e é isso que esta tela faz.
 *
 * Três leituras, nesta ordem, porque é a ordem em que as perguntas chegam:
 * quanto do teto foi usado neste mês; em que as rubricas se concentram; e para
 * quem o dinheiro foi.
 */
export async function painelCota(container) {
  limpar(container).appendChild(carregando());

  const { sessao } = await import('./sessao.js');
  const lancamentos = await listar('ceap', { recarregar: true });
  const campoCategoria = porId.ceap.campos.find((c) => c.k === 'categoria');
  const g = sessao.gabinete || {};

  const ano = new Date().getFullYear();
  const mes = new Date().toISOString().slice(0, 7);
  const doAno = lancamentos.filter((l) => String(l.data || '').startsWith(String(ano)));
  const doMes = lancamentos.filter((l) => String(l.data || '').startsWith(mes));
  const soma = (lista) => lista.reduce((t, l) => t + (Number(l.valor) || 0), 0);

  const gastoAno = soma(doAno);
  const gastoMes = soma(doMes);
  const mesesCorridos = new Date().getMonth() + 1;
  const teto = Number(g.cotaMensal) || null;
  const tetoAno = teto ? teto * mesesCorridos : null;
  // Economia é o que sobrou do teto e voltou ao caixa da Câmara — não é sobra de
  // caixa do gabinete. Sem o teto informado não se afirma economia nenhuma:
  // chamar "gasto baixo" de economia sem saber o limite seria inventar o número.
  const economia = tetoAno ? tetoAno - gastoAno : null;

  limpar(container);
  container.appendChild(el('header', { class: 'modulo-topo' }, [
    el('div', { class: 'modulo-titulo' }, [
      el('h1', { texto: 'Cota parlamentar' }),
      el('p', { texto: 'Conferida contra os dados abertos da Câmara: em que se gastou, com quem, e quanto do teto sobrou.' }),
    ]),
    el('div', { class: 'modulo-acoes' }, [botaoImportarCeap(container)]),
  ]));

  if (!lancamentos.length) {
    container.appendChild(nada(g.idDeputadoCamara
      ? 'Nenhum lançamento ainda. Use "Buscar na Câmara" para trazer a cota do mandato — ela vem completa, ano a ano.'
      : 'Informe o ID do deputado na Câmara em Acessos → Dados do gabinete para buscar a cota automaticamente.'));
    return;
  }

  container.appendChild(el('div', { class: 'indicadores' }, [
    indicador('Gasto no mês', fmtDinheiroCurto(gastoMes), 'info', fmtDinheiro(gastoMes)),
    indicador('Gasto em ' + ano, fmtDinheiroCurto(gastoAno), 'atencao', fmtDinheiro(gastoAno)),
    teto
      ? indicador('Teto do mês', fmtDinheiroCurto(teto),
        gastoMes > teto ? 'critico' : 'neutro',
        `${Math.round((gastoMes / teto) * 100)}% usado`)
      : null,
    economia !== null
      ? indicador('Devolvido ao erário', fmtDinheiroCurto(Math.max(0, economia)), 'ok',
        `${Math.round((Math.max(0, economia) / tetoAno) * 100)}% do teto de ${mesesCorridos} meses`)
      : null,
    indicador('Lançamentos', String(lancamentos.length), 'neutro'),
  ].filter(Boolean)));

  if (!teto) {
    container.appendChild(el('p', {
      class: 'campo-dica',
      texto: 'Informe a cota mensal do seu estado em Acessos → Dados do gabinete para ver quanto do teto foi usado e quanto foi devolvido. O teto é fixado por ato da Mesa e a base aberta não o publica — sem ele, só há gasto, não economia.',
    }));
  }

  const grade = el('div', { class: 'grade-paineis' });
  grade.appendChild(bloco('Por rubrica, no ano', fmtDinheiro(gastoAno), [
    barrasValor(agruparValor(doAno, 'categoria', campoCategoria, 'valor'), gastoAno),
  ]));
  grade.appendChild(bloco('Mês a mês', `${ano}`, [colunasMensais(doAno, ano, teto)]));
  grade.appendChild(bloco('Maiores fornecedores no ano', null, [
    barrasValor(agruparValor(doAno, 'fornecedor', null, 'valor'), gastoAno),
  ]));
  grade.appendChild(bloco('Rubricas como a Câmara as nomeia', null, [
    // A lista curta serve para filtrar; a nomenclatura oficial é a que aparece
    // na prestação de contas, e é por ela que a Câmara questiona.
    barrasValor(agruparValor(doAno, 'rubricaNaFonte', null, 'valor'), gastoAno),
  ]));
  container.appendChild(grade);

  container.appendChild(bloco('Últimos lançamentos', String(Math.min(30, lancamentos.length)), [
    tabelaDeLancamentos(lancamentos.slice(0, 30), campoCategoria),
  ]));
}

function botaoImportarCeap(container) {
  return el('button', {
    class: 'btn btn--fantasma',
    type: 'button',
    texto: 'Buscar na Câmara',
    title: 'Traz a cota do mandato inteiro, ano a ano, direto dos dados abertos',
    onclick: async (e) => {
      const btn = e.currentTarget;
      const { sessao } = await import('./sessao.js');
      const id = sessao.gabinete?.idDeputadoCamara;
      if (!id) {
        aviso('Informe o ID do deputado na Câmara em Acessos → Dados do gabinete.', 'erro');
        return;
      }
      btn.disabled = true;
      try {
        const camara = await import('./camara.js');
        const r = await camara.importarCeap(id, {
          aoProgredir: (p) => { btn.textContent = `${p.anos} ano(s) · ${p.lancamentos} lançamentos`; },
        });
        aviso([
          `${r.novos} lançamentos novos, ${r.atualizados} conferidos`,
          `${fmtDinheiro(r.total)} no total`,
          Object.entries(r.porAno).filter(([, n]) => n).map(([a, n]) => `${a}: ${n}`).join(' · '),
        ].filter(Boolean).join(' · '), r.lancamentos ? 'ok' : 'erro');
        await painelCota(container);
      } catch (erro) {
        console.error(erro);
        aviso(erro.message || 'Não foi possível buscar a cota na Câmara.', 'erro');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Buscar na Câmara';
      }
    },
  });
}

/**
 * Doze colunas, uma por mês, com a linha do teto atravessada.
 *
 * A pergunta que essa forma responde e a tabela não: em que meses o gabinete
 * passou perto do limite. Uma soma anual esconde o mês em que quase estourou.
 */
function colunasMensais(doAno, ano, teto) {
  const porMes = Array.from({ length: 12 }, () => 0);
  doAno.forEach((l) => {
    const m = Number(String(l.data || '').slice(5, 7));
    if (m >= 1 && m <= 12) porMes[m - 1] += Number(l.valor) || 0;
  });
  const maior = Math.max(teto || 0, ...porMes) || 1;
  const nomes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  return el('div', { class: 'colunas-mes' }, porMes.map((v, i) => el('div', {
    class: 'coluna-mes',
    title: `${nomes[i]}/${ano}: ${fmtDinheiro(v)}${teto ? ` · teto ${fmtDinheiro(teto)}` : ''}`,
  }, [
    el('div', { class: 'coluna-trilho' }, [
      teto ? el('i', { class: 'coluna-teto', style: `bottom:${(teto / maior) * 100}%` }) : null,
      el('i', {
        class: `coluna-barra${teto && v > teto ? ' coluna-barra--estourou' : ''}`,
        style: `height:${(v / maior) * 100}%`,
      }),
    ].filter(Boolean)),
    el('span', { class: 'coluna-rotulo', texto: nomes[i] }),
  ])));
}

function tabelaDeLancamentos(lista, campoCategoria) {
  const rotulo = (v) => campoCategoria?.op.find((o) => o.v === v)?.l || v || '—';
  return el('div', { class: 'tabela-rolagem' }, [
    el('table', { class: 'tabela' }, [
      el('thead', {}, [el('tr', {}, [
        el('th', { texto: 'Data' }),
        el('th', { texto: 'Rubrica' }),
        el('th', { texto: 'Fornecedor' }),
        el('th', { texto: 'Documento' }),
        el('th', { class: 'num', texto: 'Valor' }),
      ])]),
      el('tbody', {}, lista.map((l) => el('tr', {}, [
        el('td', { texto: fmtData(l.data) }),
        el('td', { texto: rotulo(l.categoria) }),
        el('td', {}, [
          el('span', { texto: l.fornecedor || '—' }),
          l.fornecedorDoc ? el('span', { class: 'topo-sub', texto: l.fornecedorDoc }) : null,
        ].filter(Boolean)),
        // O link para o documento é o que fecha a conferência: leva à nota fiscal
        // que a Câmara publicou, sem passar por nenhum sistema no meio.
        el('td', {}, [l.urlDocumento
          ? el('a', { href: l.urlDocumento, target: '_blank', rel: 'noopener', texto: l.notaFiscal || 'ver nota' })
          : el('span', { texto: l.notaFiscal || '—' })]),
        el('td', { class: 'num', texto: fmtDinheiro(l.valor) }),
      ]))),
    ]),
  ]);
}

// ───────────────────────── orçamento: por município ─────────────────────────

const ROTULO_SITUACAO = {
  indicado: 'Indicado',
  empenhado: 'Empenhado',
  pagoParcial: 'Pago em parte',
  pago: 'Recurso pago',
  impedido: 'Impedido',
  perdido: 'Recurso perdido',
};

const COR_SITUACAO = {
  indicado: 'neutro',
  empenhado: 'atencao',
  pagoParcial: 'atencao',
  pago: 'ok',
  impedido: 'critico',
  perdido: 'critico',
};

// A auditoria do gabinete contra SIGA-Brasil, Transferegov e o painel de
// transferências especiais. Crítica é uma linha em 764 — e é a de R$ 15,3 mi.
const ROTULO_PRIORIDADE = { critica: 'Crítica', alta: 'Alta', media: 'Média', baixa: 'Baixa' };
const COR_PRIORIDADE = { critica: 'critico', alta: 'critico', media: 'atencao', baixa: 'neutro' };
const PEDE_REVISAO = (d) => d.prioridadeConciliacao === 'critica' || d.prioridadeConciliacao === 'alta';

const ROTULO_AREA = {
  saude: 'Saúde',
  seguranca: 'Segurança',
  infraestrutura: 'Infraestrutura',
  turismo: 'Infra. turística',
  educacao: 'Educação',
  defesaCivil: 'Defesa Civil',
  outra: 'Outra',
};

/**
 * As destinações de uma cidade, em linhas.
 *
 * Eram cartões empilhados, e cartão não se compara: para saber qual destinação
 * é a maior, ou qual está parada, os olhos tinham de percorrer parágrafos. Em
 * linha, com as colunas alinhadas, a comparação é o próprio desenho.
 *
 * `ctx` traz o que a linha precisa para ser também um lugar de escrever:
 * `{ editavel, autor, aoGravar, aoMudar }`. Sem ele, a tabela é só leitura —
 * é assim que a ficha de apresentação a usa.
 */
export function detalhesDaCidade(m, ctx = {}) {
  const colunas = ctx.editavel ? 9 : 8;
  const corpo = el('tbody');
  m.destinacoes.forEach((d) => linhasDaDestinacao(d, ctx, colunas).forEach((n) => corpo.appendChild(n)));

  return el('div', {}, [
    // A tela é para conferir; o papel é para levar. Quem está preparando a
    // visita já está aqui, olhando esta cidade — é daqui que a folha sai.
    el('p', { class: 'detalhe-acoes' }, [
      el('a', {
        class: 'btn btn--fantasma btn--mini',
        href: `#/orcamento/folha/${encodeURIComponent(m.municipio)}`,
        texto: 'Folha desta cidade, para levar à visita',
      }),
    ]),
    el('div', { class: 'tabela-rolagem' }, [
      el('table', { class: 'tabela tabela--destinacoes' }, [
        el('thead', {}, [el('tr', {}, [
          el('th', { texto: 'Quem recebeu, para quê' }),
          el('th', { class: 'num', texto: 'Ano' }),
          el('th', { class: 'num', texto: 'Emenda' }),
          el('th', { texto: 'Área' }),
          el('th', { class: 'num', texto: 'Destinado' }),
          el('th', { class: 'num', texto: 'Empenhado' }),
          el('th', { class: 'num', texto: 'Pago' }),
          el('th', { texto: 'Situação' }),
          ctx.editavel ? el('th', { class: 'col-acoes', texto: 'Anotar' }) : null,
        ].filter(Boolean))]),
        corpo,
      ]),
    ]),
  ]);
}

/** A linha da destinação e, logo abaixo dela, o lugar de escrever. */
function linhasDaDestinacao(d, ctx, colunas) {
  const conciliada = leituraDaConciliacao(d);
  const classe = ['sublinha'];
  if (PEDE_REVISAO(d)) classe.push('sublinha--revisar');
  else if (d.divergente) classe.push('sublinha--divergente');
  else if (conciliada) classe.push('sublinha--conciliada');

  const editor = el('tr', { class: 'linha-anotar', hidden: true });
  const abrir = el('button', {
    class: 'btn btn--fantasma btn--mini',
    type: 'button',
    texto: 'Anotar',
    title: 'Registrar andamento, o responsável na cidade e, se for o caso, qual fonte vale',
    'aria-expanded': 'false',
    onclick: () => {
      editor.hidden = !editor.hidden;
      abrir.setAttribute('aria-expanded', String(!editor.hidden));
      if (!editor.hidden) editor.querySelector('textarea')?.focus();
    },
  });

  const linha = el('tr', { class: classe.join(' ') }, [
    el('td', {}, [
      el('strong', { texto: d.beneficiario || d.instituicao || 'sem beneficiário' }),
      d.objeto ? el('span', { class: 'topo-sub', texto: d.objeto }) : null,
      // O histórico que o gabinete escreveu — o que a planilha tem e o painel
      // não. Fica sob o objeto porque é leitura, não coluna.
      d.andamento || (d.situacaoOriginal && d.situacaoOriginal.length > 24)
        ? el('span', { class: 'topo-sub sublinha-nota', texto: d.andamento || d.situacaoOriginal })
        : null,
      d.responsavelNome
        ? el('span', { class: 'topo-sub', texto: `Na cidade: ${d.responsavelNome}${d.responsavelCargo ? ` (${d.responsavelCargo})` : ''}${d.responsavelTelefone ? ` · ${d.responsavelTelefone}` : ''}` })
        : null,
      // A decisão tomada fica à vista: sem ela, a linha volta a parecer um
      // número não conferido, e alguém conferiria de novo.
      conciliada ? el('span', { class: 'topo-sub sublinha-nota', texto: conciliada }) : null,
      // O que a auditoria contra as fontes públicas achou. Só aparece onde ela
      // pediu revisão: um recado em todas as 758 linhas não é recado.
      PEDE_REVISAO(d) && d.correcaoSugerida
        ? el('span', { class: 'topo-sub sublinha-auditoria' }, [
          etiqueta(ROTULO_PRIORIDADE[d.prioridadeConciliacao], COR_PRIORIDADE[d.prioridadeConciliacao]),
          el('span', { texto: ` ${d.correcaoSugerida}` }),
          d.urlPublica
            ? el('a', { href: d.urlPublica, target: '_blank', rel: 'noopener', texto: ' fonte' })
            : null,
        ].filter(Boolean))
        : null,
    ].filter(Boolean)),
    el('td', { class: 'num', 'data-rotulo': 'Ano', texto: d.ano ? String(d.ano) : '—' }),
    el('td', { class: 'num', 'data-rotulo': 'Emenda' }, [
      d.linkInstrumento
        ? el('a', { href: d.linkInstrumento, target: '_blank', rel: 'noopener', texto: d.numeroEmenda || 'convênio' })
        : el('span', { texto: d.numeroEmenda || '—' }),
    ]),
    el('td', { 'data-rotulo': 'Área', texto: ROTULO_AREA[d.area] || '—' }),
    el('td', { class: 'num', 'data-rotulo': 'Destinado', texto: d.valorDestinado ? fmtDinheiro(d.valorDestinado) : '—' }),
    el('td', { class: 'num', 'data-rotulo': 'Empenhado', texto: d.valorEmpenhado ? fmtDinheiro(d.valorEmpenhado) : '—' }),
    el('td', { class: 'num', 'data-rotulo': 'Pago', texto: d.valorPago ? fmtDinheiro(d.valorPago) : '—' }),
    el('td', { 'data-rotulo': 'Situação' }, [etiqueta(ROTULO_SITUACAO[d.situacao] || d.situacao || '—', COR_SITUACAO[d.situacao] || 'neutro')]),
    ctx.editavel ? el('td', { class: 'col-acoes' }, [abrir]) : null,
  ].filter(Boolean));

  if (!ctx.editavel) return [linha];

  // Redesenha só esta destinação. Redesenhar a tela inteira fecharia a cidade
  // aberta e devolveria a rolagem ao topo — depois de cada anotação.
  const refazer = () => {
    const [nova, novoEditor] = linhasDaDestinacao(d, ctx, colunas);
    editor.replaceWith(novoEditor);
    linha.replaceWith(nova);
    ctx.aoMudar?.();
  };

  editor.appendChild(el('td', { colspan: String(colunas) }, [formularioDeAnotacao(d, ctx, refazer)]));
  return [linha, editor];
}

/**
 * O que se escreve sem abrir o registro.
 *
 * Abrir a destinação inteira para anotar uma frase é pedir que alguém atravesse
 * 36 campos para mexer em um. O que muda depois da importação é sempre o mesmo
 * punhado de coisas: o que aconteceu, com quem se fala lá, e — quando as duas
 * fontes brigam — qual delas vale. Estas, e só estas, cabem aqui.
 */
function formularioDeAnotacao(d, ctx, refazer) {
  const anotacao = el('textarea', {
    rows: '2',
    placeholder: 'O que aconteceu? Ex.: prefeitura enviou o plano de trabalho.',
  });
  const nome = el('input', { type: 'text', placeholder: 'Nome' });
  const cargo = el('input', { type: 'text', placeholder: 'Cargo' });
  const telefone = el('input', { type: 'tel', placeholder: 'Telefone' });
  nome.value = d.responsavelNome || '';
  cargo.value = d.responsavelCargo || '';
  telefone.value = d.responsavelTelefone || '';

  const campo = (rotulo, entrada) => el('label', { class: 'campo' }, [
    el('span', { class: 'campo-rotulo', texto: rotulo }), entrada,
  ]);

  const blocos = [
    campo('Andamento — entra datado, com o seu nome, no topo do histórico', anotacao),
    el('div', { class: 'anotar-responsavel' }, [
      campo('Responsável na cidade', nome), campo('Cargo', cargo), campo('Telefone', telefone),
    ]),
  ];

  // A escolha da fonte só aparece onde há briga. Um seletor "qual fonte vale"
  // em toda linha convidaria a decidir onde não há o que decidir.
  let fonte = null;
  let motivo = null;
  if (d.divergente) {
    fonte = el('select', {}, [
      el('option', { value: '', texto: 'Ainda não decidi' }),
      el('option', { value: 'gabinete', texto: `A planilha do gabinete — ${fmtDinheiro(d.valorDestinado || 0)} destinados` }),
      el('option', { value: 'governo', texto: `O painel do governo — ${fmtDinheiro(Math.max(d.valorEmpenhado || 0, d.valorPago || 0))} no convênio` }),
    ]);
    motivo = el('input', { type: 'text', placeholder: 'Por que esta fonte vale' });
    blocos.push(el('div', { class: 'anotar-divergencia' }, [
      el('p', { class: 'campo-dica', texto: d.destinacoesNoEncontro > 1
        ? `As fontes divergem aqui. O valor do painel é do convênio inteiro, dividido entre ${d.destinacoesNoEncontro} destinações — por isso ninguém concilia isto sozinho.`
        : 'As fontes divergem aqui. Escolha a que o gabinete vai defender, e diga por quê.' }),
      campo('Qual fonte vale', fonte),
      campo('Por quê — fica registrado com o seu nome', motivo),
    ]));
  }

  const recado = el('p', { class: 'campo-dica' });
  const gravar = el('button', { class: 'btn btn--primario btn--mini', type: 'submit', texto: 'Salvar' });

  const form = el('form', { class: 'form form--anotar', onsubmit: async (e) => {
    e.preventDefault();
    const remendo = {};

    const novoAndamento = anotarAndamento(d.andamento, anotacao.value, { autor: ctx.autor, data: hoje() });
    if (novoAndamento) remendo.andamento = novoAndamento;

    const contato = { responsavelNome: nome, responsavelCargo: cargo, responsavelTelefone: telefone };
    for (const [chave, entrada] of Object.entries(contato)) {
      const valor = entrada.value.trim();
      if (valor !== (d[chave] || '')) remendo[chave] = valor;
    }

    if (fonte && fonte.value) {
      const decisao = resolverDivergencia({
        fonte: fonte.value, motivo: motivo.value, por: ctx.autor, em: hoje(),
      });
      // O motivo é obrigatório de propósito: a decisão vai ser dita em voz alta
      // na frente de um prefeito, e o que não está escrito ninguém lembra.
      if (!decisao) { recado.textContent = 'Diga por que esta fonte vale — a decisão fica registrada com o motivo.'; motivo.focus(); return; }
      Object.assign(remendo, decisao);
    }

    if (!Object.keys(remendo).length) { recado.textContent = 'Nada mudou.'; return; }

    gravar.disabled = true;
    recado.textContent = 'Gravando…';
    try {
      await ctx.aoGravar(d, remendo);
      Object.assign(d, remendo);
      aviso('Anotado.', 'ok');
      refazer();
    } catch (erro) {
      console.error(erro);
      recado.textContent = erro.message || 'Não foi possível gravar.';
      gravar.disabled = false;
    }
  } }, [...blocos, el('div', { class: 'anotar-acoes' }, [gravar, recado])]);

  return form;
}

/**
 * Dois botões, porque são dois arquivos com papéis diferentes.
 *
 * Um botão só, com detecção automática, obrigava quem usa a adivinhar o que ia
 * acontecer — e, quando o arquivo era o outro, o recado falava do primeiro. O
 * gabinete disse isso com todas as letras, e tinha razão: a economia de um
 * clique não paga a confusão de não saber o que se está fazendo.
 */
function importadoresDeDestinacoes(recarregar, jaTemDestinacoes) {
  const criar = ({ rotulo, titulo, principal, executar }) => {
    const escolher = el('input', { type: 'file', accept: '.xlsx,.xls,.csv,.txt', class: 'oculto-visual' });
    const btn = el('button', {
      class: `btn ${principal ? 'btn--primario' : 'btn--fantasma'}`,
      type: 'button',
      texto: rotulo,
      title: titulo,
      onclick: () => escolher.click(),
    });

    escolher.addEventListener('change', async () => {
      const arquivo = escolher.files?.[0];
      if (!arquivo) return;
      btn.disabled = true;
      btn.textContent = 'Lendo…';
      try {
        await executar(arquivo);
        recarregar();
      } catch (erro) {
        console.error(erro);
        aviso(erro.message || 'Não foi possível importar.', 'erro');
      } finally {
        escolher.value = '';
        btn.disabled = false;
        btn.textContent = rotulo;
      }
    });
    return el('span', { class: 'importador' }, [btn, escolher]);
  };

  const mapa = criar({
    rotulo: 'Importar Mapa de emendas',
    titulo: 'A planilha do gabinete, aba "Mapa de emendas" — é ela que diz o que existe',
    principal: true,
    executar: async (arquivo) => {
      const { importarMapaDoGabinete } = await import('./destinacoes.js');
      const r = await importarMapaDoGabinete(arquivo);
      aviso([
        `${r.destinacoes} destinações (${r.novas} novas, ${r.atualizadas} atualizadas)`,
        `${r.municipios} municípios · ${r.emendas} emendas`,
        `destinado ${fmtDinheiroCurto(r.destinado)}`,
        r.semEmenda ? `${r.semEmenda} ainda sem nº de emenda` : null,
        // A célula vazia que não apagou o que estava certo: dito, porque é uma
        // decisão do sistema sobre os dados de alguém.
        r.preservados ? `${r.preservados} campos vazios na planilha não apagaram o que já havia` : null,
        // Nº de emenda corrigido na planilha muda a chave: a linha antiga fica
        // para trás, com o andamento escrito nela. Some da soma se ninguém vir.
        r.orfas ? `${r.orfas} destinações antigas não vieram nesta versão e continuam aqui — confira se viraram outra linha` : null,
        // A aba de conciliação veio de carona. Dizer que ela entrou, e o que
        // ela pediu, é o que transforma a auditoria em trabalho a fazer.
        r.conciliacao
          ? `aba "${r.conciliacao.aba}": ${r.conciliacao.aplicadas} linhas auditadas, ${r.conciliacao.revisar} pedem revisão${r.conciliacao.criticas ? ` (${r.conciliacao.criticas} crítica)` : ''}`
          : null,
        r.conciliacao?.discordantes
          ? `${r.conciliacao.discordantes} linhas da conciliação não conferiram com o mapa e não foram aplicadas`
          : null,
      ].filter(Boolean).join(' · '), 'ok');
    },
  });

  const painel = criar({
    rotulo: 'Confirmar pelo painel',
    titulo: 'A exportação do painel de transferências: confirma empenhado e pago no que já está aqui',
    principal: false,
    executar: async (arquivo) => {
      const { importarDoPainel } = await import('./destinacoes.js');
      const r = await importarDoPainel(arquivo);
      aviso([
        `${r.casaram} destinações confirmadas, em ${r.encontrosUsados} convênios`,
        `empenhado ${fmtDinheiroCurto(r.empenhado)}, pago ${fmtDinheiroCurto(r.pago)}`,
        r.divergentes ? `${r.divergentes} divergem da planilha do gabinete` : null,
        r.semParNoGabinete ? `${r.semParNoGabinete} convênios do painel sem par aqui` : null,
      ].filter(Boolean).join(' · '), r.casaram ? 'ok' : 'erro');
    },
  });

  return el('div', { class: 'modulo-acoes modulo-acoes--importar' }, [
    mapa,
    painel,
    el('p', {
      class: 'campo-dica',
      // A ordem importa e não é adivinhável: dizê-la aqui evita a única
      // sequência que não funciona.
      texto: jaTemDestinacoes
        ? 'O Mapa de emendas é a fonte; o painel confirma empenhado e pago no que já está aqui.'
        : 'Comece pelo Mapa de emendas — ele diz o que existe. O painel só confirma valores do que já foi importado.',
    }),
  ]);
}

/**
 * Por município: a pergunta que o assessor faz antes de viajar.
 *
 * "Quanto foi para esta cidade, e já foi pago?" — e, um clique abaixo,
 * destinação por destinação: quem recebeu, para quê, em que pé está e com quem
 * se fala lá.
 */
export async function painelDestinacoes(container) {
  limpar(container).appendChild(carregando());
  const destinacoes = await listar('destinacoes', { recarregar: true });
  const { sessao } = await import('./sessao.js');
  const { podeEditar } = await import('./config.js');

  // Quem pode escrever no orçamento anota daqui mesmo; quem não pode lê a
  // mesma tabela sem a coluna de ação, e não descobre pelo erro de gravação.
  const ctx = {
    editavel: podeEditar(sessao.membro, 'orcamento'),
    autor: sessao.membro?.nome || '',
    aoGravar: (d, remendo) => salvar('destinacoes', d.id, remendo),
    aoMudar: () => atualizarConciliar(),
  };

  const cidades = consolidarDestinacoes(destinacoes);
  const total = (k) => cidades.reduce((t, m) => t + m[k], 0);

  limpar(container);
  container.appendChild(el('header', { class: 'modulo-topo' }, [
    el('div', { class: 'modulo-titulo' }, [
      el('h1', { texto: 'Por município' }),
      el('p', { texto: 'Quanto foi para cada cidade, em que pé está e com quem se fala lá. Clique numa linha para ver destinação por destinação.' }),
    ]),
  ]));

  // Botão que lê o arquivo inteiro para depois recusar a gravação é pior que
  // botão nenhum: quem não escreve no orçamento não o vê.
  if (ctx.editavel) {
    container.appendChild(importadoresDeDestinacoes(() => painelDestinacoes(container), destinacoes.length > 0));
  }

  if (!destinacoes.length) {
    container.appendChild(nada(ctx.editavel
      ? 'Nada importado ainda. Comece pelo Mapa de emendas do gabinete — ele é a fonte do que existe.'
      : 'Nada importado ainda. Quem cuida do orçamento no gabinete importa o Mapa de emendas.'));
    return;
  }

  const indicadores = el('div', { class: 'indicadores' });
  container.appendChild(indicadores);

  // O contador de divergências desce a cada uma resolvida. Deixá-lo parado
  // faria o trabalho feito parecer trabalho pendente, e a próxima pessoa
  // conferiria de novo o que já foi decidido.
  function atualizarConciliar() {
    const divergentes = destinacoes.filter((d) => d.divergente).length;
    const aRevisar = destinacoes.filter(PEDE_REVISAO).length;
    limpar(indicadores);
    [
      indicador('Municípios', String(cidades.length), 'neutro'),
      indicador('Destinações', String(destinacoes.length), 'neutro'),
      indicador('Destinado', fmtDinheiroCurto(total('destinado')), 'info', fmtDinheiro(total('destinado'))),
      indicador('Empenhado', fmtDinheiroCurto(total('empenhado')), 'atencao', fmtDinheiro(total('empenhado'))),
      indicador('Pago', fmtDinheiroCurto(total('pago')), 'ok', fmtDinheiro(total('pago'))),
      // A divergência é indicador de primeira linha porque é trabalho a fazer,
      // não estatística: cada uma é uma decisão que alguém precisa tomar.
      divergentes ? indicador('A conciliar', String(divergentes), 'critico', 'fontes divergem') : null,
      // A auditoria já apontou onde olhar. O número existe para diminuir.
      aRevisar ? indicador('A revisar', String(aRevisar), 'critico', 'a auditoria pediu') : null,
    ].filter(Boolean).forEach((n) => indicadores.appendChild(n));
  }
  atualizarConciliar();

  const corpo = el('tbody');
  const busca = el('input', {
    type: 'search',
    class: 'busca',
    placeholder: 'Buscar município, região, beneficiário, objeto…',
    'aria-label': 'Buscar',
    oninput: () => desenhar(),
  });

  // O dashboard manda a cidade por aqui: clicar no mapa leva a esta tela já
  // procurando por ela. Passa e some, para não reaparecer numa visita futura.
  let abrir = null;
  try {
    const alvo = sessionStorage.getItem('municipioAlvo');
    if (alvo) { busca.value = alvo; abrir = semAcentoLocal(alvo); sessionStorage.removeItem('municipioAlvo'); }
  } catch { /* sem sessionStorage, entra sem filtro */ }

  container.appendChild(el('div', { class: 'modulo-acoes' }, [busca]));

  // Ordenação por clique no cabeçalho.
  //
  // Uma lista de trezentas cidades tem mais de uma pergunta: "quem recebeu
  // mais" e "onde está Xanxerê" não se respondem com a mesma ordem. Fixar uma
  // obriga a rolar procurando; deixar escolher resolve as duas.
  const COLUNAS = [
    { k: 'municipio', l: 'Município', tipo: 'texto' },
    { k: 'quantas', l: 'Destinações', tipo: 'numero', num: true },
    { k: 'destinado', l: 'Destinado', tipo: 'numero', num: true },
    { k: 'empenhado', l: 'Empenhado', tipo: 'numero', num: true },
    { k: 'pago', l: 'Pago', tipo: 'numero', num: true },
    { k: 'situacao', l: 'Situação', tipo: 'texto' },
  ];
  let ordem = { campo: 'destinado', desc: true };

  const valorDaColuna = (m, campo) => {
    if (campo === 'quantas') return m.destinacoes.length;
    if (campo === 'situacao') return situacaoDaCidade(m).texto;
    return m[campo];
  };

  const cabecalho = el('tr', {}, COLUNAS.map((c) => {
    const th = el('th', {
      class: c.num ? 'num ordenavel' : 'ordenavel',
      tabindex: '0',
      role: 'button',
      'aria-label': `Ordenar por ${c.l}`,
      onclick: () => {
        // Clicar de novo na mesma coluna inverte; trocar de coluna começa pela
        // ordem mais útil dela: maior valor primeiro, nome em ordem alfabética.
        ordem = ordem.campo === c.k
          ? { campo: c.k, desc: !ordem.desc }
          : { campo: c.k, desc: c.tipo === 'numero' };
        desenhar();
      },
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); } },
    }, [el('span', { texto: c.l }), el('span', { class: 'seta-ordem' })]);
    return th;
  }));

  container.appendChild(el('div', { class: 'tabela-rolagem' }, [
    el('table', { class: 'tabela tabela--municipios' }, [
      el('thead', {}, [cabecalho]),
      corpo,
    ]),
  ]));

  function desenhar() {
    const termos = semAcentoLocal(busca.value).split(/\s+/).filter(Boolean);
    const visiveis = cidades.filter((m) => {
      if (!termos.length) return true;
      const texto = semAcentoLocal([
        m.municipio, m.regiao,
        ...m.destinacoes.map((d) => `${d.beneficiario || ''} ${d.instituicao || ''} ${d.objeto || ''} ${d.numeroEmenda || ''} ${d.ano || ''}`),
      ].join(' '));
      return termos.every((t) => texto.includes(t));
    });

    const coluna = COLUNAS.find((c) => c.k === ordem.campo) || COLUNAS[0];
    visiveis.sort((a, b) => {
      const x = valorDaColuna(a, ordem.campo);
      const y = valorDaColuna(b, ordem.campo);
      const r = coluna.tipo === 'numero'
        ? (Number(x) || 0) - (Number(y) || 0)
        : String(x || '').localeCompare(String(y || ''), 'pt-BR');
      return ordem.desc ? -r : r;
    });

    // A seta mora no cabeçalho e diz por onde a lista está ordenada. Sem ela,
    // ordenar é um efeito que acontece e não se explica.
    [...cabecalho.children].forEach((th, i) => {
      const ativa = COLUNAS[i].k === ordem.campo;
      th.classList.toggle('ordenavel--ativa', ativa);
      th.setAttribute('aria-sort', ativa ? (ordem.desc ? 'descending' : 'ascending') : 'none');
      th.lastChild.textContent = ativa ? (ordem.desc ? '▾' : '▴') : '';
    });

    limpar(corpo);
    if (!visiveis.length) {
      corpo.appendChild(el('tr', {}, [el('td', { colspan: '6' }, [nada('Nenhum município encontrado.')])]));
      return;
    }

    visiveis.forEach((m) => {
      const situacao = situacaoDaCidade(m);
      const detalhe = el('tr', { class: 'linha-detalhe', hidden: true }, [
        el('td', { colspan: '6' }, [detalhesDaCidade(m, ctx)]),
      ]);
      const linhaCidade = el('tr', {
        class: 'linha-municipio',
        tabindex: '0',
        role: 'button',
        onclick: () => { detalhe.hidden = !detalhe.hidden; },
        onkeydown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); detalhe.hidden = !detalhe.hidden; }
        },
      }, [
        el('td', {}, [
          el('strong', { texto: m.municipio }),
          m.regiao ? el('span', { class: 'topo-sub', texto: m.regiao }) : null,
        ].filter(Boolean)),
        el('td', { class: 'num', 'data-rotulo': 'Destinações', texto: String(m.destinacoes.length) }),
        el('td', { class: 'num', 'data-rotulo': 'Destinado', texto: m.destinado ? fmtDinheiro(m.destinado) : '—' }),
        el('td', { class: 'num', 'data-rotulo': 'Empenhado', texto: m.empenhado ? fmtDinheiro(m.empenhado) : '—' }),
        el('td', { class: 'num', 'data-rotulo': 'Pago', texto: m.pago ? fmtDinheiro(m.pago) : '—' }),
        el('td', { 'data-rotulo': 'Situação' }, [etiqueta(situacao.texto, situacao.cor)]),
      ]);
      corpo.appendChild(linhaCidade);
      corpo.appendChild(detalhe);
      // A cidade que veio do mapa abre sozinha: quem clicou nela já disse o que
      // queria ver, e obrigar um segundo clique é cobrar duas vezes pelo mesmo
      // pedido.
      if (abrir && semAcentoLocal(m.municipio) === abrir) {
        detalhe.hidden = false;
        linhaCidade.classList.add('linha-municipio--alvo');
      }
    });
    if (abrir) corpo.querySelector('.linha-municipio--alvo')?.scrollIntoView({ block: 'center' });
  }

  desenhar();
}

const semAcentoLocal = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// ─────────────────────────── orçamento: dashboard ───────────────────────────

/**
 * O que salta aos olhos, antes de qualquer busca.
 *
 * A tela por município responde "quanto foi para Erechim" para quem já sabe que
 * é Erechim. O dashboard responde outra coisa, que se pergunta com a mesma
 * frequência e não tem onde ser respondida: onde o mandato chegou, o que é
 * grande, e o que está parado.
 */
export function destaquesDasDestinacoes(destinacoes, cidades) {
  const somar = (lista, campo) => lista.reduce((t, d) => t + (Number(d[campo]) || 0), 0);
  const agrupar = (campo) => {
    const mapa = new Map();
    for (const d of destinacoes) {
      const k = d[campo] || 'sem';
      if (!mapa.has(k)) mapa.set(k, { chave: k, quantas: 0, valor: 0 });
      const g = mapa.get(k);
      g.quantas += 1;
      g.valor += Number(d.valorDestinado) || 0;
    }
    return [...mapa.values()].sort((a, b) => b.valor - a.valor);
  };

  // Impedido e perdido são o que a prefeitura vai perguntar, e o que ninguém
  // quer descobrir na frente dela.
  const travadas = destinacoes
    .filter((d) => d.situacao === 'impedido' || d.situacao === 'perdido')
    .sort((a, b) => (b.valorDestinado || 0) - (a.valorDestinado || 0));

  return {
    destinado: somar(destinacoes, 'valorDestinado'),
    maiores: [...destinacoes].sort((a, b) => (b.valorDestinado || 0) - (a.valorDestinado || 0)).slice(0, 8),
    cidades: cidades.slice(0, 8),
    porArea: agrupar('area'),
    porAno: agrupar('ano').sort((a, b) => String(b.chave).localeCompare(String(a.chave))),
    porSituacao: agrupar('situacao'),
    travadas: travadas.slice(0, 8),
    valorTravado: somar(travadas, 'valorDestinado'),
    aConciliar: destinacoes.filter((d) => d.divergente).length,
    // A auditoria contra as fontes públicas já disse onde olhar; o dashboard
    // só precisa não esconder. A crítica vem antes da alta, e dentro de cada
    // uma o valor manda — é onde o erro custa mais caro.
    aRevisar: destinacoes.filter(PEDE_REVISAO)
      .sort((a, b) => (PESO_PRIORIDADE[b.prioridadeConciliacao] - PESO_PRIORIDADE[a.prioridadeConciliacao])
        || ((b.valorDestinado || 0) - (a.valorDestinado || 0))),
  };
}

/** Uma barra por item, com o valor à direita. */
function barrasDestaque(itens, total, rotulo = (x) => x) {
  if (!itens.length) return nada('Sem dados.');
  const maior = Math.max(...itens.map((i) => i.valor), 1);
  return el('ul', { class: 'barras' }, itens.map((i) => el('li', { class: 'barra-linha' }, [
    el('span', { class: 'barra-rotulo', texto: rotulo(i.chave) }),
    el('span', { class: 'barra-trilho' }, [
      el('span', { class: 'barra-cheia', style: `width:${Math.max(2, (i.valor / maior) * 100)}%` }),
    ]),
    el('span', { class: 'barra-valor num', texto: fmtDinheiroCurto(i.valor) }),
    el('span', { class: 'barra-conta', texto: `${i.quantas}` }),
  ])));
}

/** Leva à tela por município já procurando aquela cidade. */
function irParaCidade(nome) {
  try { sessionStorage.setItem('municipioAlvo', nome); } catch { /* segue sem o atalho */ }
  location.hash = '#/orcamento/por-municipio';
}

export async function painelDashboardOrcamento(container) {
  limpar(container).appendChild(carregando());
  const { sessao } = await import('./sessao.js');
  const destinacoes = await listar('destinacoes', { recarregar: true });
  const cidades = consolidarDestinacoes(destinacoes);
  const uf = sessao.gabinete?.uf || null;

  limpar(container);
  container.appendChild(el('header', { class: 'modulo-topo' }, [
    el('div', { class: 'modulo-titulo' }, [
      el('h1', { texto: 'Dashboard' }),
      el('p', { texto: 'Onde o mandato chegou, o que é grande e o que está parado. Clique numa cidade do mapa para ver as emendas dela.' }),
    ]),
  ]));

  if (!destinacoes.length) {
    container.appendChild(nada('Nada importado ainda. Comece pelo Mapa de emendas, em Por município.'));
    return;
  }

  const d = destaquesDasDestinacoes(destinacoes, cidades);

  // A destinação guarda o nome como estava escrito na linha; a lista de cidades
  // já escolheu a grafia que vale. Sem passar por aqui, o dashboard mostraria
  // "Caxias do sul" no destaque e "Caxias do Sul" na tabela, como se fossem
  // dois lugares — que foi exatamente o defeito que a consolidação corrigiu.
  const canonico = new Map(cidades.map((c) => [semAcentoLocal(c.municipio), c.municipio]));
  const oficial = (nome) => canonico.get(semAcentoLocal(nome)) || nome;

  container.appendChild(el('div', { class: 'indicadores' }, [
    indicador('Municípios', String(cidades.length), 'neutro'),
    indicador('Destinações', String(destinacoes.length), 'neutro'),
    indicador('Destinado', fmtDinheiroCurto(d.destinado), 'info', fmtDinheiro(d.destinado)),
    d.travadas.length
      ? indicador('Travado', fmtDinheiroCurto(d.valorTravado), 'critico', `${d.travadas.length} impedidas ou perdidas`)
      : null,
    d.aConciliar ? indicador('A conciliar', String(d.aConciliar), 'atencao', 'fontes divergem') : null,
    d.aRevisar.length ? indicador('A revisar', String(d.aRevisar.length), 'critico', 'a auditoria pediu') : null,
  ].filter(Boolean)));

  // ── o mapa ──
  const caixaMapa = el('section', { class: 'bloco bloco--mapa' }, [
    el('header', { class: 'bloco-topo' }, [
      el('h2', { texto: uf ? `Onde o mandato chegou em ${uf}` : 'Onde o mandato chegou' }),
      el('span', { class: 'bloco-contagem', texto: `${cidades.length} municípios` }),
    ]),
    el('p', { class: 'campo-dica', texto: 'Carregando a malha municipal do IBGE…' }),
  ]);
  container.appendChild(caixaMapa);

  // ── os destaques ──
  const grade = el('div', { class: 'grade-paineis' });

  grade.appendChild(bloco('Maiores destinações', null, [
    el('ul', { class: 'lista' }, d.maiores.map((x) => linha(
      `${x.beneficiario || x.instituicao || 'sem beneficiário'} · ${oficial(x.municipio)}`,
      [x.ano, x.objeto].filter(Boolean).join(' · ').slice(0, 110),
      etiqueta(fmtDinheiroCurto(x.valorDestinado), 'info'),
    ))),
  ]));

  grade.appendChild(bloco('Cidades mais atendidas', null, [
    el('ul', { class: 'lista' }, d.cidades.map((c) => el('li', {
      class: 'linha linha--clicavel',
      tabindex: '0',
      role: 'button',
      onclick: () => irParaCidade(c.municipio),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); irParaCidade(c.municipio); } },
    }, [
      el('div', { class: 'linha-texto' }, [
        el('span', { class: 'linha-principal', texto: c.municipio }),
        el('span', { class: 'linha-secundaria', texto: `${c.destinacoes.length} destinações${c.regiao ? ` · ${c.regiao}` : ''}` }),
      ]),
      etiqueta(fmtDinheiroCurto(c.destinado), 'info'),
    ]))),
  ]));

  grade.appendChild(bloco('Por área', null, [
    barrasDestaque(d.porArea, d.destinado, (k) => ROTULO_AREA[k] || 'Sem área'),
  ]));

  grade.appendChild(bloco('Por ano', null, [
    barrasDestaque(d.porAno, d.destinado, (k) => String(k)),
  ]));

  grade.appendChild(bloco('Em que pé está', null, [
    barrasDestaque(d.porSituacao, d.destinado, (k) => ROTULO_SITUACAO[k] || 'Sem situação'),
  ]));

  if (d.aRevisar.length) {
    // O que a auditoria contra as fontes públicas achou. Vem antes do travado
    // porque é o único bloco em que o próprio número pode estar errado — e
    // número errado dito numa reunião não se desdiz.
    grade.appendChild(bloco('A auditoria pediu revisão', `${d.aRevisar.length}`, [
      el('ul', { class: 'lista' }, d.aRevisar.slice(0, 8).map((x) => el('li', {
        class: 'linha linha--clicavel',
        tabindex: '0',
        role: 'button',
        onclick: () => irParaCidade(oficial(x.municipio)),
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); irParaCidade(oficial(x.municipio)); } },
      }, [
        el('div', { class: 'linha-texto' }, [
          el('span', { class: 'linha-principal', texto: `${oficial(x.municipio)} · ${x.beneficiario || x.instituicao || ''}`.trim() }),
          el('span', { class: 'linha-secundaria', texto: (x.correcaoSugerida || x.resultadoConciliacao || '').slice(0, 140) }),
        ]),
        etiqueta(ROTULO_PRIORIDADE[x.prioridadeConciliacao], COR_PRIORIDADE[x.prioridadeConciliacao]),
      ]))),
    ]));
  }

  if (d.travadas.length) {
    // Primeiro assunto de qualquer visita: a prefeitura vai perguntar.
    grade.appendChild(bloco('Travado — impedido ou perdido', `${d.travadas.length}`, [
      el('ul', { class: 'lista' }, d.travadas.map((x) => linha(
        `${oficial(x.municipio)} · ${x.beneficiario || x.instituicao || ''}`.trim(),
        (x.situacaoOriginal || x.objeto || '').slice(0, 120),
        etiqueta(fmtDinheiroCurto(x.valorDestinado), 'critico'),
      ))),
    ]));
  }

  container.appendChild(grade);

  // ── a malha, por último e sem bloquear ──
  //
  // Se o IBGE não responder, o dashboard inteiro acima já respondeu. O mapa é o
  // que torna a leitura instantânea, não o que a torna possível.
  let mapaMod = null;
  try {
    mapaMod = await import('./mapa.js');
  } catch (erro) {
    console.warn('mapa indisponível:', erro.message);
  }

  const valores = new Map();
  if (mapaMod) {
    for (const c of cidades) {
      if (!c.municipio) continue;
      valores.set(mapaMod.semAcento(c.municipio), c.destinado || c.empenhado || c.pago);
    }
  }

  const malha = mapaMod && uf ? await mapaMod.malhaDoEstado(uf) : null;
  const desenho = malha
    ? mapaMod.desenharMalha(malha, { valores, aoClicar: irParaCidade, largura: 620 })
    : null;

  limpar(caixaMapa).appendChild(el('header', { class: 'bloco-topo' }, [
    el('h2', { texto: uf ? `Onde o mandato chegou em ${uf}` : 'Onde o mandato chegou' }),
    el('span', { class: 'bloco-contagem', texto: `${cidades.length} municípios atendidos` }),
  ]));

  if (desenho) {
    caixaMapa.appendChild(el('div', { class: 'mapa-caixa mapa-caixa--medio' }, [desenho.svg]));
    caixaMapa.appendChild(legendaDoMapa(desenho.cortes, mapaMod.TONS));
    caixaMapa.appendChild(el('p', { class: 'campo-dica', texto: 'Clique numa cidade pintada para ver as emendas dela.' }));
  } else {
    caixaMapa.appendChild(el('p', { class: 'campo-dica', texto: uf
      ? 'A malha municipal do IBGE não respondeu agora. Os destaques abaixo respondem sem ela.'
      : 'Informe a UF do gabinete em Acessos → Dados do gabinete para desenhar o mapa.' }));
  }
}

function legendaDoMapa(cortes, tons) {
  return el('div', { class: 'mapa-legenda' }, [
    el('span', { class: 'campo-dica', texto: 'menos' }),
    ...tons.map((cor) => el('i', { class: 'mapa-tom', style: `background:${cor}` })),
    el('span', { class: 'campo-dica', texto: 'mais' }),
    cortes.length
      ? el('span', { class: 'campo-dica', texto: `faixas em ${cortes.map(fmtDinheiroCurto).join(' · ')}` })
      : null,
  ].filter(Boolean));
}

// ─────────────────────── orçamento: a folha da cidade ───────────────────────

const ROTULO_MODALIDADE = {
  investimento: 'Investimento',
  custeio: 'Custeio',
  especial: 'Transferência Especial',
  papCusteio: 'PAP Custeio',
  papInvestimento: 'PAP Investimento',
  macCusteio: 'MAC Custeio',
  macInvestimento: 'MAC Investimento',
  misto: 'Misto',
};

/**
 * O papel que vai junto na visita.
 *
 * A tela é para conferir; a folha é para levar. Numa reunião de prefeitura
 * ninguém rola uma tabela — abre-se uma folha, e o que está nela é o que se
 * responde. Por isso ela não é a tabela impressa: começa pelo que a prefeitura
 * vai perguntar primeiro (o que está travado, e o que ainda não bate entre as
 * duas fontes), traz cada destinação inteira — com o andamento escrito pelo
 * gabinete e com quem se fala lá — e termina em linhas em branco, porque o que
 * se combina na reunião é anotado à mão, na hora.
 */
export async function painelFolhaMunicipio(container, cidadePedida) {
  limpar(container).appendChild(carregando());
  const { sessao } = await import('./sessao.js');
  const destinacoes = await listar('destinacoes', { recarregar: true });
  const cidades = consolidarDestinacoes(destinacoes);
  const alvo = semAcentoLocal(cidadePedida || '');
  const m = cidades.find((c) => semAcentoLocal(c.municipio) === alvo);

  limpar(container);
  container.appendChild(el('div', { class: 'modulo-acoes' }, [
    el('a', { class: 'btn btn--fantasma', href: '#/orcamento/por-municipio', texto: '← Por município' }),
    m ? el('button', {
      class: 'btn btn--primario',
      type: 'button',
      texto: 'Imprimir',
      onclick: () => window.print(),
    }) : null,
  ].filter(Boolean)));

  if (!m) {
    container.appendChild(nada(cidadePedida
      ? `Nenhuma destinação registrada para "${cidadePedida}".`
      : 'Abra uma cidade em Por município e peça a folha dela.'));
    return;
  }

  const folha = el('article', { class: 'ficha folha' });
  container.appendChild(folha);

  const g = sessao.gabinete || {};
  folha.appendChild(el('header', { class: 'ficha-topo folha-topo' }, [
    el('div', {}, [
      el('h2', { texto: `Emendas em ${m.municipio}` }),
      el('p', { class: 'ficha-origem', texto: [
        m.regiao,
        `${m.destinacoes.length} destinaç${m.destinacoes.length === 1 ? 'ão' : 'ões'}`,
        `folha gerada em ${new Date().toLocaleDateString('pt-BR')}`,
      ].filter(Boolean).join(' · ') }),
    ]),
    el('p', { class: 'ficha-origem', texto: [g.deputado, g.nome].filter(Boolean).join(' · ') }),
  ]));

  folha.appendChild(el('div', { class: 'indicadores indicadores--compactos' }, [
    el('div', { class: 'indicador' }, [
      el('span', { class: 'indicador-rotulo', texto: 'Destinado' }),
      el('strong', { class: 'indicador-valor', texto: fmtDinheiro(m.destinado) }),
    ]),
    el('div', { class: 'indicador' }, [
      el('span', { class: 'indicador-rotulo', texto: 'Empenhado' }),
      el('strong', { class: 'indicador-valor', texto: m.empenhado ? fmtDinheiro(m.empenhado) : '—' }),
    ]),
    el('div', { class: 'indicador' }, [
      el('span', { class: 'indicador-rotulo', texto: 'Pago' }),
      el('strong', { class: 'indicador-valor', texto: m.pago ? fmtDinheiro(m.pago) : '—' }),
    ]),
  ]));

  // ── o que a prefeitura pergunta primeiro ──
  //
  // Nunca é "quanto foi ao todo": é "e aquela que travou?". Vir por último numa
  // lista por ano é descobrir isso na frente de quem perguntou.
  const travadas = m.destinacoes.filter((d) => d.situacao === 'impedido' || d.situacao === 'perdido');
  const aConciliar = m.destinacoes.filter((d) => d.divergente);
  const aRevisar = m.destinacoes.filter(PEDE_REVISAO);
  if (travadas.length || aConciliar.length || aRevisar.length) {
    folha.appendChild(el('section', { class: 'ficha-secao ficha-secao--alerta' }, [
      el('h3', { texto: 'O que vão perguntar primeiro' }),
      // A auditoria vem antes de tudo: nos outros casos o número está certo e o
      // repasse é que travou; aqui o próprio número pode estar errado, e número
      // errado dito numa reunião não se desdiz.
      ...aRevisar.map((d) => el('p', { class: 'folha-alerta' }, [
        el('strong', { texto: `Confira antes de citar · ${ROTULO_PRIORIDADE[d.prioridadeConciliacao]}` }),
        el('span', { texto: ` — ${d.beneficiario || d.instituicao || 'sem beneficiário'}, ${fmtDinheiro(d.valorDestinado || 0)} no mapa.` }),
        d.correcaoSugerida ? el('span', { class: 'topo-sub', texto: d.correcaoSugerida }) : null,
        d.urlPublica ? el('span', { class: 'topo-sub', texto: d.urlPublica }) : null,
      ].filter(Boolean))),
      ...travadas.map((d) => el('p', { class: 'folha-alerta' }, [
        el('strong', { texto: `${ROTULO_SITUACAO[d.situacao]} · ${fmtDinheiro(d.valorDestinado || 0)}` }),
        el('span', { texto: ` — ${d.beneficiario || d.instituicao || 'sem beneficiário'}: ${d.objeto || 'objeto não informado'}` }),
        d.situacaoOriginal ? el('span', { class: 'topo-sub', texto: d.situacaoOriginal }) : null,
      ].filter(Boolean))),
      // Dito no papel para que ninguém cite de cabeça um número que ainda não
      // foi decidido — é o erro que se comete uma vez só.
      ...aConciliar.map((d) => el('p', { class: 'folha-alerta' }, [
        el('strong', { texto: 'Número ainda não conferido' }),
        el('span', { texto: ` — ${d.beneficiario || d.instituicao || 'sem beneficiário'}: a planilha do gabinete diz ${fmtDinheiro(d.valorDestinado || 0)}, o painel do governo diz ${fmtDinheiro(Math.max(d.valorEmpenhado || 0, d.valorPago || 0))}. Não cite valor sem conferir.` }),
      ])),
    ]));
  }

  // ── as destinações, por ano, da mais recente para a mais antiga ──
  const anos = [...new Set(m.destinacoes.map((d) => d.ano || 0))].sort((a, b) => b - a);
  for (const ano of anos) {
    const doAno = m.destinacoes.filter((d) => (d.ano || 0) === ano);
    const soma = doAno.reduce((t, d) => t + (Number(d.valorDestinado) || 0), 0);
    folha.appendChild(el('section', { class: 'ficha-secao' }, [
      el('h3', { texto: `${ano || 'Sem ano'} — ${fmtDinheiro(soma)} em ${doAno.length} destinaç${doAno.length === 1 ? 'ão' : 'ões'}` }),
      ...doAno.map(paragrafoDaDestinacao),
    ]));
  }

  // ── o espaço de escrever ──
  //
  // O que se combina na reunião é anotado à mão, na hora, e sem linha em branco
  // a anotação vai para o verso de outro papel e se perde.
  folha.appendChild(el('section', { class: 'ficha-secao folha-anotacoes' }, [
    el('h3', { texto: 'Anotações da visita' }),
    ...Array.from({ length: 6 }, () => el('div', { class: 'folha-pauta' })),
  ]));

  folha.appendChild(el('p', { class: 'ficha-rodape', texto: 'Valores destinados são do Mapa de emendas do gabinete; empenhado e pago vêm do painel do governo. Onde as duas fontes divergem, a folha diz — nada aqui é conciliado sozinho.' }));
}

/** Uma destinação inteira, do jeito que se lê em voz alta. */
function paragrafoDaDestinacao(d) {
  const dinheiro = [
    `destinado ${fmtDinheiro(d.valorDestinado || 0)}`,
    d.valorEmpenhado ? `empenhado ${fmtDinheiro(d.valorEmpenhado)}` : null,
    d.valorPago ? `pago ${fmtDinheiro(d.valorPago)}` : null,
  ].filter(Boolean).join(' · ');

  const ficha = [
    d.numeroEmenda ? `Emenda ${d.numeroEmenda}` : 'Sem nº de emenda',
    ROTULO_AREA[d.area],
    ROTULO_MODALIDADE[d.modalidade],
    d.numeroInstrumento ? `Instrumento ${d.numeroInstrumento}` : null,
  ].filter(Boolean).join(' · ');

  return el('div', { class: 'folha-destinacao' }, [
    el('p', { class: 'folha-destinacao-titulo' }, [
      el('strong', { texto: d.beneficiario || d.instituicao || 'sem beneficiário' }),
      etiqueta(ROTULO_SITUACAO[d.situacao] || d.situacao || '—', COR_SITUACAO[d.situacao] || 'neutro'),
    ]),
    d.objeto ? el('p', { class: 'folha-objeto', texto: d.objeto }) : null,
    el('p', { class: 'folha-numeros', texto: dinheiro }),
    el('p', { class: 'topo-sub', texto: ficha }),
    // Quem se procura lá. É a linha pela qual se liga antes de viajar, e a que
    // some quando o assessor que sabia sai do gabinete.
    d.responsavelNome
      ? el('p', { class: 'folha-contato', texto: `Na cidade: ${d.responsavelNome}${d.responsavelCargo ? ` (${d.responsavelCargo})` : ''}${d.responsavelTelefone ? ` · ${d.responsavelTelefone}` : ''}` })
      : null,
    // O andamento inteiro, e não o último recado: numa reunião a pergunta é
    // "desde quando?", e a resposta é o histórico.
    d.andamento ? el('p', { class: 'folha-andamento', texto: d.andamento }) : null,
    leituraDaConciliacao(d) ? el('p', { class: 'topo-sub', texto: leituraDaConciliacao(d) }) : null,
    // A evidência pública que a auditoria achou. Numa reunião, é o que
    // sustenta o número que se acabou de dizer.
    d.notaEvidencia ? el('p', { class: 'topo-sub', texto: `Conferência: ${d.notaEvidencia}` }) : null,
    d.endereco ? el('p', { class: 'topo-sub', texto: d.endereco }) : null,
  ].filter(Boolean));
}
