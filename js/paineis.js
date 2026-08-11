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

export async function painelEmendas(container) {
  limpar(container).appendChild(carregando());
  const emendas = await listar('emendas', { recarregar: true });

  const soma = (k) => emendas.reduce((t, e) => t + (Number(e[k]) || 0), 0);
  const indicado = soma('valorIndicado');
  const empenhado = soma('valorEmpenhado');
  const pago = soma('valorPago');

  const campoFase = porId.emendas.campos.find((c) => c.k === 'fase');
  const campoArea = porId.emendas.campos.find((c) => c.k === 'areaDestino');

  limpar(container);
  container.appendChild(el('header', { class: 'modulo-topo' }, [
    el('div', { class: 'modulo-titulo' }, [
      el('h1', { texto: 'Painel de emendas' }),
      el('p', { texto: 'Onde o recurso foi indicado, quanto saiu do papel e o que ainda depende de cobrança.' }),
    ]),
  ]));

  if (!emendas.length) {
    container.appendChild(el('p', { class: 'bloco-vazio', texto: 'Nenhuma emenda cadastrada ainda. Comece pela aba Emendas.' }));
    return;
  }

  container.appendChild(el('div', { class: 'indicadores' }, [
    indicador('Emendas', String(emendas.length), 'neutro'),
    indicador('Indicado', fmtDinheiroCurto(indicado), 'info', fmtDinheiro(indicado)),
    indicador('Empenhado', fmtDinheiroCurto(empenhado), 'atencao',
      indicado ? `${Math.round((empenhado / indicado) * 100)}% do indicado` : ''),
    indicador('Pago', fmtDinheiroCurto(pago), 'ok',
      indicado ? `${Math.round((pago / indicado) * 100)}% do indicado` : ''),
  ]));

  const grade = el('div', { class: 'grade-paineis' });
  grade.appendChild(bloco('Por fase de execução', null, [barras(agrupar(emendas, 'fase', campoFase), emendas.length)]));
  grade.appendChild(bloco('Por área de destino', null, [barras(agrupar(emendas, 'areaDestino', campoArea), emendas.length)]));
  grade.appendChild(bloco('Municípios mais atendidos', null, [
    barrasValor(agruparValor(emendas, 'municipio'), indicado),
  ]));
  grade.appendChild(bloco('Maiores beneficiários', null, [
    barrasValor(agruparValor(emendas, 'beneficiario'), indicado),
  ]));
  container.appendChild(grade);
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
