import { el, limpar, fmtData, fmtDataHora, fmtDinheiro, fmtDinheiroCurto, diasAte, carregando, etiqueta } from './ui.js';
import { listar } from './dados.js';
import { porId } from './modulos.js';

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

  const [tarefas, pedidos, imprensa, atendimentos, agenda, equipe, emendas, proposicoes] = await Promise.all([
    listar('tarefas', { recarregar: true }),
    listar('solicitacoesAgenda', { recarregar: true }),
    listar('imprensa', { recarregar: true }),
    listar('atendimentos', { recarregar: true }),
    listar('agenda', { recarregar: true }),
    listar('equipe'),
    listar('emendas'),
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
  const emendasParadas = emendas.filter((e) => ['liberada', 'execucao'].includes(e.fase));

  const agora = new Date().toISOString();
  const compromissos = agenda
    .filter((c) => c.inicio && c.inicio >= agora.slice(0, 16))
    .sort((a, b) => a.inicio.localeCompare(b.inicio))
    .slice(0, 6);

  limpar(container);
  container.appendChild(el('header', { class: 'modulo-topo' }, [
    el('div', { class: 'modulo-titulo' }, [
      el('h1', { texto: 'Painel do gabinete' }),
      el('p', { texto: 'O que exige decisão hoje, reunido das cinco áreas.' }),
    ]),
  ]));

  container.appendChild(el('div', { class: 'indicadores' }, [
    indicador('Tarefas atrasadas', String(atrasadas.length), atrasadas.length ? 'critico' : 'ok'),
    indicador('Tarefas abertas', String(abertas.length), 'info'),
    indicador('Pedidos de agenda', String(pendentesAgenda.length), pendentesAgenda.length ? 'atencao' : 'ok'),
    indicador('Imprensa em aberto', String(imprensaAberta.length), imprensaAberta.length ? 'atencao' : 'ok'),
    indicador('Atendimentos abertos', String(atendimentosAbertos.length), atendimentosAbertos.length ? 'info' : 'ok'),
    indicador('Proposições que andaram', String(mexeram.length), mexeram.length ? 'info' : 'neutro', 'últimos 7 dias'),
    indicador('Emendas a cobrar', String(emendasParadas.length), emendasParadas.length ? 'atencao' : 'ok'),
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

  grade.appendChild(bloco('Emendas que pedem cobrança', emendasParadas.length ? `${emendasParadas.length}` : null, [
    emendasParadas.length
      ? el('ul', { class: 'lista' }, emendasParadas.slice(0, 8)
        .map((e) => linha(
          `${e.beneficiario || 'sem beneficiário'} · ${e.municipio || ''}`.trim(),
          `${porId.emendas.campos.find((c) => c.k === 'fase').op.find((o) => o.v === e.fase)?.l || ''} · ${fmtDinheiro(e.valorIndicado)}`,
        )))
      : nada('Nenhuma emenda em fase de cobrança.'),
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

/** Reúne emendas e destinos por município, sem contar o mesmo real duas vezes. */
export function consolidarPorMunicipio(emendas, transferencias) {
  const mapa = new Map();
  const porEmenda = new Map(emendas.map((e) => [String(e.codigo || e.id), e]));

  const lugar = (nome, uf) => {
    const chave = (nome || 'Sem município identificado').trim();
    if (!mapa.has(chave)) {
      mapa.set(chave, {
        municipio: chave,
        uf: uf || null,
        destinado: 0,
        empenhado: 0,
        liquidado: 0,
        pago: 0,
        impedido: 0,
        emendas: new Set(),
        destinos: [],
      });
    }
    const m = mapa.get(chave);
    if (!m.uf && uf) m.uf = uf;
    return m;
  };

  const comDestino = new Set();

  for (const t of transferencias) {
    const m = lugar(t.municipio || t.favorecido, t.uf);
    if (t.codigoEmenda) {
      m.emendas.add(String(t.codigoEmenda));
      comDestino.add(String(t.codigoEmenda));
    }
    // Depois do pós-processamento cada destino já traz as fases em colunas
    // próprias; antes dele, uma linha era uma fase. Ler os dois formatos evita
    // que o painel zere enquanto o gabinete não reorganizou o que está guardado.
    if (t.valorEmpenhado != null || t.valorPago != null || t.valorDestinado != null) {
      m.destinado += Number(t.valorDestinado) || 0;
      m.empenhado += Number(t.valorEmpenhado) || 0;
      m.liquidado += Number(t.valorLiquidado) || 0;
      m.pago += Number(t.valorPago) || 0;
    } else {
      m[FASE_DA_COLUNA[t.tipo] || 'destinado'] += Number(t.valor) || 0;
    }
    if (IMPEDIDO.test(t.situacao || '') || t.situacaoExecucao === 'impedido') {
      m.impedido += Number(t.valor) || 0;
    }
    m.destinos.push(t);
  }

  // Emenda sem nenhum destino detalhado ainda existe e tem dinheiro. Deixá-la
  // de fora faria o painel mostrar menos do que o gabinete indicou — e é
  // justamente a emenda que falta detalhar que precisa aparecer.
  for (const e of emendas) {
    const codigo = String(e.codigo || e.id);
    if (comDestino.has(codigo)) continue;
    const nome = /m[úu]ltiplo/i.test(e.municipio || '') || !e.municipio
      ? 'A detalhar (a fonte diz "múltiplo")'
      : e.municipio;
    const m = lugar(nome, e.uf);
    m.emendas.add(codigo);
    m.destinado += Number(e.valorIndicado) || 0;
    m.empenhado += Number(e.valorEmpenhado) || 0;
    m.pago += Number(e.valorPago) || 0;
    m.semDetalhe = (m.semDetalhe || 0) + 1;
  }

  return [...mapa.values()]
    .map((m) => ({ ...m, emendas: [...m.emendas], total: Math.max(m.destinado, m.empenhado, m.pago) }))
    .sort((a, b) => b.total - a.total || a.municipio.localeCompare(b.municipio, 'pt-BR'));
}

/** Em que pé está o dinheiro daquele lugar, em uma frase. */
export function situacaoDoLugar(m) {
  if (m.impedido) return { texto: 'Com impedimento', cor: 'critico' };
  if (m.pago && m.pago >= (m.empenhado || m.pago)) return { texto: 'Pago', cor: 'ok' };
  if (m.pago) return { texto: 'Pago em parte', cor: 'atencao' };
  if (m.empenhado) return { texto: 'Empenhado, sem pagamento', cor: 'atencao' };
  if (m.destinado) return { texto: 'Destinado, sem empenho', cor: 'info' };
  return { texto: 'Sem execução registrada', cor: 'neutro' };
}

/**
 * Emenda por emenda de um município.
 *
 * A mesma leitura serve às duas telas — a lista por município e o dashboard —, e
 * é a de quem vai atender uma ligação da prefeitura perguntando "e a minha
 * ambulância?": o que era, quanto foi, quanto saiu e o que travou.
 */
export function detalhesDeUmLugar(m) {
  if (!m.destinos.length) {
    return el('p', { class: 'sanfona-recado', texto: `${m.emendas.length} emenda(s) sem detalhamento ainda. Use "Detalhar emendas" na aba Emendas.` });
  }
  // Por emenda, e dentro dela por fase: é a leitura de quem vai atender uma
  // ligação da prefeitura perguntando "e a minha ambulância?".
  const porCodigo = new Map();
  m.destinos.forEach((t) => {
    const c = t.codigoEmenda || 'sem código';
    if (!porCodigo.has(c)) porCodigo.set(c, []);
    porCodigo.get(c).push(t);
  });

  return el('div', { class: 'municipio-detalhe' }, [...porCodigo.entries()].map(([codigo, linhas]) => {
    const objetos = [...new Set(linhas.map((t) => t.objeto).filter(Boolean))];
    const metas = [...new Set(linhas.map((t) => t.metas).filter(Boolean))];
    const fase = (coluna, tipo) => linhas.reduce((s, t) => {
      if (t[coluna] != null) return s + (Number(t[coluna]) || 0);
      return t.tipo === tipo ? s + (Number(t.valor) || 0) : s;
    }, 0);
    const pago = fase('valorPago', 'pagamento');
    const empenhado = fase('valorEmpenhado', 'empenho');
    const destinado = linhas.reduce((s, t) => {
      if (t.valorDestinado != null) return s + (Number(t.valorDestinado) || 0);
      return FASE_DA_COLUNA[t.tipo] ? s : s + (Number(t.valor) || 0);
    }, 0);
    const travas = [...new Set(linhas.map((t) => t.situacao).filter((x) => IMPEDIDO.test(x || '')))];
    const ultima = linhas.map((t) => t.data).filter(Boolean).sort().pop();

    return el('article', { class: 'municipio-emenda' }, [
      el('header', {}, [
        el('strong', { texto: codigo }),
        ultima ? el('span', { class: 'topo-sub', texto: `último movimento em ${fmtData(ultima)}` }) : null,
      ]),
      objetos.length
        ? el('p', { class: 'municipio-objeto', texto: objetos.join(' · ') })
        : el('p', { class: 'municipio-objeto municipio-objeto--vazio', texto: 'Objeto não informado pela fonte' }),
      metas.length ? el('p', { class: 'campo-dica', texto: metas.join(' · ') }) : null,
      el('p', { class: 'municipio-numeros' }, [
        destinado ? el('span', { texto: `Destinado ${fmtDinheiro(destinado)}` }) : null,
        empenhado ? el('span', { texto: `Empenhado ${fmtDinheiro(empenhado)}` }) : null,
        el('span', { class: pago ? 'municipio-pago' : null, texto: `Pago ${fmtDinheiro(pago)}` }),
      ].filter(Boolean)),
      ...travas.map((t) => el('p', { class: 'municipio-trava', texto: t })),
    ]);
  }));
}

const semAcento = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export async function painelEmendas(container) {
  limpar(container).appendChild(carregando());
  const [emendas, transferencias] = await Promise.all([
    listar('emendas', { recarregar: true }),
    listar('transferencias', { recarregar: true }).catch(() => []),
  ]);

  const lugares = consolidarPorMunicipio(emendas, transferencias);
  const total = (k) => lugares.reduce((t, m) => t + m[k], 0);

  limpar(container);
  container.appendChild(el('header', { class: 'modulo-topo' }, [
    el('div', { class: 'modulo-titulo' }, [
      el('h1', { texto: 'Emendas por município' }),
      el('p', { texto: 'Quanto foi para cada lugar, em que pé está e o que travou. Clique num município para ver emenda por emenda.' }),
    ]),
  ]));

  if (!emendas.length && !transferencias.length) {
    container.appendChild(nada('Nada importado ainda. Comece pela aba Emendas: "Consultar Portal" e depois "Detalhar emendas".'));
    return;
  }

  container.appendChild(el('div', { class: 'indicadores' }, [
    indicador('Municípios', String(lugares.length), 'neutro'),
    indicador('Destinado', fmtDinheiroCurto(total('destinado')), 'info', fmtDinheiro(total('destinado'))),
    indicador('Empenhado', fmtDinheiroCurto(total('empenhado')), 'atencao', fmtDinheiro(total('empenhado'))),
    indicador('Pago', fmtDinheiroCurto(total('pago')), 'ok', fmtDinheiro(total('pago'))),
    total('impedido')
      ? indicador('Impedido', fmtDinheiroCurto(total('impedido')), 'critico', fmtDinheiro(total('impedido')))
      : null,
  ].filter(Boolean)));

  const corpo = el('tbody');
  const busca = el('input', {
    type: 'search',
    class: 'busca',
    placeholder: 'Buscar município, objeto, beneficiário…',
    'aria-label': 'Buscar município',
    oninput: () => desenhar(),
  });

  container.appendChild(el('div', { class: 'modulo-acoes' }, [busca]));
  container.appendChild(el('div', { class: 'tabela-rolagem' }, [
    el('table', { class: 'tabela tabela--municipios' }, [
      el('thead', {}, [el('tr', {}, [
        el('th', { texto: 'Município' }),
        el('th', { texto: 'Emendas' }),
        el('th', { class: 'num', texto: 'Destinado' }),
        el('th', { class: 'num', texto: 'Empenhado' }),
        el('th', { class: 'num', texto: 'Pago' }),
        el('th', { texto: 'Situação' }),
      ])]),
      corpo,
    ]),
  ]));

  const detalhesDoLugar = detalhesDeUmLugar;

  function desenhar() {
    const termos = semAcento(busca.value).split(/\s+/).filter(Boolean);
    const visiveis = lugares.filter((m) => {
      if (!termos.length) return true;
      const texto = semAcento([
        m.municipio, m.uf, ...m.emendas,
        ...m.destinos.map((t) => `${t.objeto || ''} ${t.favorecido || ''} ${t.metas || ''}`),
      ].join(' '));
      return termos.every((t) => texto.includes(t));
    });

    limpar(corpo);
    if (!visiveis.length) {
      corpo.appendChild(el('tr', {}, [el('td', { colspan: '6' }, [nada('Nenhum município encontrado.')])]));
      return;
    }

    visiveis.forEach((m) => {
      const situacao = situacaoDoLugar(m);
      const detalhe = el('tr', { class: 'linha-detalhe', hidden: true }, [
        el('td', { colspan: '6' }, [detalhesDoLugar(m)]),
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
          m.uf ? el('span', { class: 'topo-sub', texto: m.uf }) : null,
        ]),
        el('td', { texto: String(m.emendas.length) }),
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

/**
 * O dashboard: o estado inteiro de uma vez, e o município a um clique.
 *
 * O painel por município responde "quanto foi para Erechim" para quem já sabe
 * que é Erechim. Esta tela responde a outra pergunta, que o gabinete faz com a
 * mesma frequência: onde o mandato chegou e onde não chegou. Um mapa responde
 * isso num olhar; uma tabela de quatrocentas linhas, não.
 *
 * O mapa não é obrigatório. Se a malha do IBGE não vier, a mesma leitura aparece
 * em lista ordenada — a resposta não pode depender de um serviço externo estar
 * de pé.
 */
export async function painelDashboard(container) {
  limpar(container).appendChild(carregando());

  const { sessao } = await import('./sessao.js');
  const [emendas, transferencias] = await Promise.all([
    listar('emendas', { recarregar: true }),
    listar('transferencias', { recarregar: true }).catch(() => []),
  ]);

  const lugares = consolidarPorMunicipio(emendas, transferencias);
  const uf = sessao.gabinete?.uf || null;

  limpar(container);
  container.appendChild(el('header', { class: 'modulo-topo' }, [
    el('div', { class: 'modulo-titulo' }, [
      el('h1', { texto: 'Dashboard' }),
      el('p', { texto: 'Onde o mandato chegou. Clique num município para ver as emendas dele.' }),
    ]),
  ]));

  if (!lugares.length) {
    container.appendChild(nada('Nada importado ainda. Comece pela aba Emendas: "Consultar Portal" e depois "Detalhar emendas".'));
    return;
  }

  const soma = (k) => lugares.reduce((t, m) => t + m[k], 0);
  const atendidos = lugares.filter((m) => m.municipio && !/^A detalhar/.test(m.municipio));

  container.appendChild(el('div', { class: 'indicadores' }, [
    indicador('Municípios atendidos', String(atendidos.length), 'ok'),
    indicador('Destinado', fmtDinheiroCurto(soma('destinado')), 'info', fmtDinheiro(soma('destinado'))),
    indicador('Pago', fmtDinheiroCurto(soma('pago')), 'ok', fmtDinheiro(soma('pago'))),
    soma('impedido')
      ? indicador('Impedido', fmtDinheiroCurto(soma('impedido')), 'critico', fmtDinheiro(soma('impedido')))
      : null,
  ].filter(Boolean)));

  const detalhe = el('section', { class: 'bloco bloco--detalhe-mapa' });
  const mostrarLugar = (nome) => {
    const { semAcento } = mapaMod;
    const achado = lugares.find((m) => semAcento(m.municipio) === semAcento(nome));
    limpar(detalhe);
    if (!achado) {
      detalhe.appendChild(el('h2', { texto: nome }));
      detalhe.appendChild(nada('Sem emenda registrada para este município.'));
      return;
    }
    const sit = situacaoDoLugar(achado);
    detalhe.appendChild(el('header', { class: 'bloco-topo' }, [
      el('h2', { texto: `${achado.municipio}${achado.uf ? ` · ${achado.uf}` : ''}` }),
      etiqueta(sit.texto, sit.cor),
    ]));
    detalhe.appendChild(el('p', { class: 'municipio-numeros' }, [
      achado.destinado ? el('span', { texto: `Destinado ${fmtDinheiro(achado.destinado)}` }) : null,
      achado.empenhado ? el('span', { texto: `Empenhado ${fmtDinheiro(achado.empenhado)}` }) : null,
      el('span', { class: achado.pago ? 'municipio-pago' : null, texto: `Pago ${fmtDinheiro(achado.pago)}` }),
      el('span', { texto: `${achado.emendas.length} emenda(s)` }),
    ].filter(Boolean)));
    detalhe.appendChild(detalhesDeUmLugar(achado));
  };

  let mapaMod;
  try {
    mapaMod = await import('./mapa.js');
  } catch (erro) {
    console.error(erro);
    mapaMod = null;
  }

  const valores = new Map();
  if (mapaMod) {
    for (const m of lugares) {
      if (!m.municipio) continue;
      const chave = mapaMod.semAcento(m.municipio);
      valores.set(chave, (valores.get(chave) || 0) + (m.destinado || m.empenhado || m.pago));
    }
  }

  const caixaMapa = el('section', { class: 'bloco' }, [
    el('header', { class: 'bloco-topo' }, [
      el('h2', { texto: uf ? `Distribuição em ${uf}` : 'Distribuição' }),
    ]),
    el('p', { class: 'campo-dica', texto: 'Carregando a malha municipal do IBGE…' }),
  ]);
  container.appendChild(caixaMapa);
  container.appendChild(detalhe);

  const malha = mapaMod && uf ? await mapaMod.malhaDoEstado(uf) : null;
  const desenho = malha ? mapaMod.desenharMalha(malha, { valores, aoClicar: mostrarLugar }) : null;

  limpar(caixaMapa).appendChild(el('header', { class: 'bloco-topo' }, [
    el('h2', { texto: uf ? `Distribuição em ${uf}` : 'Distribuição' }),
    el('span', { class: 'bloco-contagem', texto: `${atendidos.length} atendidos` }),
  ]));

  if (desenho) {
    caixaMapa.appendChild(el('div', { class: 'mapa-caixa' }, [desenho.svg]));
    caixaMapa.appendChild(legendaDoMapa(desenho.cortes, mapaMod.TONS));
  } else {
    // Um mapa que não carrega não pode levar embora a resposta.
    caixaMapa.appendChild(el('p', { class: 'campo-dica', texto: uf
      ? 'A malha municipal do IBGE não respondeu agora. A distribuição está abaixo, em lista.'
      : 'Informe a UF do gabinete em Acessos → Dados do gabinete para desenhar o mapa. Por ora, a distribuição em lista.' }));
    caixaMapa.appendChild(barrasValor(
      atendidos.slice(0, 25).map((m) => ({ rotulo: m.municipio, valor: m.total })),
      atendidos[0]?.total || 0,
    ));
  }

  mostrarLugar(atendidos[0]?.municipio || lugares[0].municipio);
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

function agruparValor(itens, chave) {
  const mapa = new Map();
  itens.forEach((i) => {
    const v = i[chave] || 'Não informado';
    mapa.set(v, (mapa.get(v) || 0) + (Number(i.valorIndicado) || 0));
  });
  return [...mapa.entries()]
    .map(([rotulo, total]) => ({ rotulo, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 7);
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

export async function painelCota(container) {
  limpar(container).appendChild(carregando());
  const lancamentos = await listar('ceap', { recarregar: true });
  const campoCategoria = porId.ceap.campos.find((c) => c.k === 'categoria');
  const ano = new Date().getFullYear();
  const mes = new Date().toISOString().slice(0, 7);

  const doAno = lancamentos.filter((l) => String(l.data || '').startsWith(String(ano)));
  const doMes = lancamentos.filter((l) => String(l.data || '').startsWith(mes));
  const total = (lista) => lista.reduce((t, l) => t + (Number(l.valor) || 0), 0);
  const glosados = doAno.filter((l) => l.situacao === 'glosado');

  limpar(container);
  container.appendChild(el('header', { class: 'modulo-topo' }, [
    el('div', { class: 'modulo-titulo' }, [
      el('h1', { texto: 'Cota parlamentar' }),
      el('p', { texto: 'Lançamentos do gabinete. O reembolso oficial aparece na base da Câmara com atraso, então este número anda na frente dela.' }),
    ]),
  ]));

  container.appendChild(el('div', { class: 'indicadores' }, [
    indicador('Gasto no mês', fmtDinheiro(total(doMes)), 'info', `${doMes.length} lançamentos`),
    indicador(`Gasto em ${ano}`, fmtDinheiro(total(doAno)), 'neutro', `${doAno.length} lançamentos`),
    indicador('Aguardando reembolso', fmtDinheiro(total(doAno.filter((l) => l.situacao !== 'reembolsado' && l.situacao !== 'glosado'))), 'atencao'),
    indicador('Glosado', fmtDinheiro(total(glosados)), glosados.length ? 'critico' : 'ok', `${glosados.length} lançamentos`),
  ]));

  const grade = el('div', { class: 'grade-paineis' });
  const porCategoria = new Map();
  doAno.forEach((l) => {
    const v = l.categoria || 'outro';
    porCategoria.set(v, (porCategoria.get(v) || 0) + (Number(l.valor) || 0));
  });
  const dados = [...porCategoria.entries()]
    .map(([v, t]) => ({ rotulo: campoCategoria.op.find((o) => o.v === v)?.l || v, total: t }))
    .sort((a, b) => b.total - a.total);

  grade.appendChild(bloco(`Categorias em ${ano}`, null, [barrasValor(dados, total(doAno))]));

  const ultimos = [...lancamentos].sort((a, b) => String(b.data).localeCompare(String(a.data))).slice(0, 8);
  grade.appendChild(bloco('Últimos lançamentos', null, [
    ultimos.length
      ? el('ul', { class: 'lista' }, ultimos.map((l) => linha(
        l.fornecedor || campoCategoria.op.find((o) => o.v === l.categoria)?.l || 'Lançamento',
        `${fmtData(l.data)} · ${fmtDinheiro(l.valor)}`,
      )))
      : nada('Nenhum lançamento.'),
  ]));

  container.appendChild(grade);
}
