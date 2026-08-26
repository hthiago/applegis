import {
  el, limpar, fmtData, fmtDataHora, fmtDinheiro, fmtDinheiroCurto, diasAte, carregando, etiqueta, aviso,
} from './ui.js';
import { listar } from './dados.js';
import { porId } from './modulos.js';
import { consolidarDestinacoes, situacaoDaCidade } from './destinacoes.js';

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

/** As destinações de uma cidade, uma a uma — o nível em que se responde. */
export function detalhesDaCidade(m) {
  return el('div', { class: 'municipio-detalhe' }, m.destinacoes.map((d) => el('article', { class: 'municipio-emenda' }, [
    el('header', {}, [
      el('strong', { texto: d.beneficiario || d.instituicao || 'sem beneficiário' }),
      el('span', { class: 'topo-sub', texto: [d.ano, d.numeroEmenda ? `emenda ${d.numeroEmenda}` : 'sem nº de emenda'].filter(Boolean).join(' · ') }),
    ]),
    d.objeto ? el('p', { class: 'municipio-objeto', texto: d.objeto }) : null,
    el('p', { class: 'municipio-numeros' }, [
      d.valorDestinado ? el('span', { texto: `Destinado ${fmtDinheiro(d.valorDestinado)}` }) : null,
      d.valorEmpenhado ? el('span', { texto: `Empenhado ${fmtDinheiro(d.valorEmpenhado)}` }) : null,
      d.valorPago ? el('span', { class: 'municipio-pago', texto: `Pago ${fmtDinheiro(d.valorPago)}` }) : null,
      el('span', {}, [etiqueta(ROTULO_SITUACAO[d.situacao] || d.situacao, situacaoDaCidade({ pago: d.valorPago || 0, empenhado: d.valorEmpenhado || 0, destinado: d.valorDestinado || 0, divergentes: 0 }).cor)]),
    ].filter(Boolean)),
    // O que só a planilha do gabinete tem: o histórico escrito por gente.
    d.situacaoOriginal && d.situacaoOriginal !== ROTULO_SITUACAO[d.situacao]
      ? el('p', { class: 'campo-dica', texto: d.situacaoOriginal }) : null,
    d.andamento ? el('p', { class: 'campo-dica', texto: d.andamento }) : null,
    d.responsavelNome
      ? el('p', { class: 'campo-dica', texto: `Na cidade: ${d.responsavelNome}${d.responsavelCargo ? `, ${d.responsavelCargo}` : ''}${d.responsavelTelefone ? ` · ${d.responsavelTelefone}` : ''}` })
      : null,
    // A divergência não se resolve sozinha: ela chama alguém.
    d.divergente
      ? el('p', { class: 'municipio-trava', texto: `O painel do governo registra mais que o destinado nesta linha. Abra a destinação e escolha qual fonte vale.` })
      : null,
    d.linkInstrumento
      ? el('p', {}, [el('a', { href: d.linkInstrumento, target: '_blank', rel: 'noopener', class: 'campo-dica', texto: `Convênio ${d.numeroInstrumento || ''} no Transferegov` })])
      : null,
  ].filter(Boolean))));
}

/**
 * O botão que traz as duas planilhas.
 *
 * Um só, e o formato é reconhecido pelo cabeçalho: obrigar quem usa a saber de
 * antemão em qual botão o arquivo dele cabe é transferir para a pessoa um
 * problema que é do sistema.
 */
function importadorDeDestinacoes(recarregar) {
  const escolher = el('input', { type: 'file', accept: '.xlsx,.xls,.csv,.txt', class: 'oculto-visual' });
  const btn = el('button', {
    class: 'btn btn--primario',
    type: 'button',
    texto: 'Importar planilha',
    title: 'O Mapa de emendas do gabinete, ou a exportação do painel de transferências',
    onclick: () => escolher.click(),
  });

  escolher.addEventListener('change', async () => {
    const arquivo = escolher.files?.[0];
    if (!arquivo) return;
    btn.disabled = true;
    btn.textContent = 'Lendo…';
    try {
      const { importarPlanilha } = await import('./destinacoes.js');
      const r = await importarPlanilha(arquivo);
      if (r.origem === 'gabinete') {
        aviso([
          `${r.destinacoes} destinações (${r.novas} novas, ${r.atualizadas} atualizadas)`,
          `${r.municipios} municípios · ${r.emendas} emendas`,
          `destinado ${fmtDinheiroCurto(r.destinado)}`,
          r.semEmenda ? `${r.semEmenda} ainda sem nº de emenda` : null,
        ].filter(Boolean).join(' · '), 'ok');
      } else {
        aviso([
          `${r.casaram} destinações confirmadas pelo painel, em ${r.encontrosUsados} convênios`,
          `empenhado ${fmtDinheiroCurto(r.empenhado)}, pago ${fmtDinheiroCurto(r.pago)}`,
          r.divergentes ? `${r.divergentes} divergem do que está na planilha do gabinete` : null,
          r.semParNoGabinete ? `${r.semParNoGabinete} convênios do painel sem par no gabinete` : null,
        ].filter(Boolean).join(' · '), r.casaram ? 'ok' : 'erro');
      }
      recarregar();
    } catch (erro) {
      console.error(erro);
      aviso(erro.message || 'Não foi possível importar.', 'erro');
    } finally {
      escolher.value = '';
      btn.disabled = false;
      btn.textContent = 'Importar planilha';
    }
  });

  return el('div', { class: 'modulo-acoes' }, [
    btn,
    escolher,
    el('p', {
      class: 'campo-dica',
      texto: 'Duas planilhas, um botão. O Mapa de emendas do gabinete é a fonte: ele diz o que existe. A exportação do painel confirma empenhado e pago no que já está aqui — importe o Mapa primeiro.',
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

  const cidades = consolidarDestinacoes(destinacoes);
  const total = (k) => cidades.reduce((t, m) => t + m[k], 0);

  limpar(container);
  container.appendChild(el('header', { class: 'modulo-topo' }, [
    el('div', { class: 'modulo-titulo' }, [
      el('h1', { texto: 'Por município' }),
      el('p', { texto: 'Quanto foi para cada cidade, em que pé está e com quem se fala lá. Clique numa linha para ver destinação por destinação.' }),
    ]),
  ]));

  container.appendChild(importadorDeDestinacoes(() => painelDestinacoes(container)));

  if (!destinacoes.length) {
    container.appendChild(nada('Nada importado ainda. Comece pelo Mapa de emendas do gabinete — ele é a fonte do que existe.'));
    return;
  }

  const divergentes = cidades.reduce((t, m) => t + m.divergentes, 0);
  container.appendChild(el('div', { class: 'indicadores' }, [
    indicador('Municípios', String(cidades.length), 'neutro'),
    indicador('Destinações', String(destinacoes.length), 'neutro'),
    indicador('Destinado', fmtDinheiroCurto(total('destinado')), 'info', fmtDinheiro(total('destinado'))),
    indicador('Empenhado', fmtDinheiroCurto(total('empenhado')), 'atencao', fmtDinheiro(total('empenhado'))),
    indicador('Pago', fmtDinheiroCurto(total('pago')), 'ok', fmtDinheiro(total('pago'))),
    // A divergência é indicador de primeira linha porque é trabalho a fazer,
    // não estatística: cada uma é uma decisão que alguém precisa tomar.
    divergentes ? indicador('A conciliar', String(divergentes), 'critico', 'fontes divergem') : null,
  ].filter(Boolean)));

  const corpo = el('tbody');
  const busca = el('input', {
    type: 'search',
    class: 'busca',
    placeholder: 'Buscar município, região, beneficiário, objeto…',
    'aria-label': 'Buscar',
    oninput: () => desenhar(),
  });
  container.appendChild(el('div', { class: 'modulo-acoes' }, [busca]));
  container.appendChild(el('div', { class: 'tabela-rolagem' }, [
    el('table', { class: 'tabela tabela--municipios' }, [
      el('thead', {}, [el('tr', {}, [
        el('th', { texto: 'Município' }),
        el('th', { texto: 'Destinações' }),
        el('th', { class: 'num', texto: 'Destinado' }),
        el('th', { class: 'num', texto: 'Empenhado' }),
        el('th', { class: 'num', texto: 'Pago' }),
        el('th', { texto: 'Situação' }),
      ])]),
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

    limpar(corpo);
    if (!visiveis.length) {
      corpo.appendChild(el('tr', {}, [el('td', { colspan: '6' }, [nada('Nenhum município encontrado.')])]));
      return;
    }

    visiveis.forEach((m) => {
      const situacao = situacaoDaCidade(m);
      const detalhe = el('tr', { class: 'linha-detalhe', hidden: true }, [
        el('td', { colspan: '6' }, [detalhesDaCidade(m)]),
      ]);
      const linha = el('tr', {
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
        el('td', { texto: String(m.destinacoes.length) }),
        el('td', { class: 'num', texto: m.destinado ? fmtDinheiro(m.destinado) : '—' }),
        el('td', { class: 'num', texto: m.empenhado ? fmtDinheiro(m.empenhado) : '—' }),
        el('td', { class: 'num', texto: m.pago ? fmtDinheiro(m.pago) : '—' }),
        el('td', {}, [etiqueta(situacao.texto, situacao.cor)]),
      ]);
      corpo.appendChild(linha);
      corpo.appendChild(detalhe);
    });
  }

  desenhar();
}

const semAcentoLocal = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
