import {
  el, limpar, etiqueta, fmtData, fmtDataHora, fmtDinheiro, aviso, confirmar, vazio, carregando, hoje,
} from './ui.js';
import { listar, salvar, remover, opcoesDe, proximoNumero } from './dados.js';

/**
 * Motor genérico de listagem e formulário.
 * Renderiza qualquer módulo descrito em modulos.js — a interface é derivada
 * dos campos, não escrita à mão para cada coleção.
 */

const CAMPOS_AUTONUMERADOS = ['numero', 'protocolo'];

/** Linhas desenhadas de uma vez. O resto vem sob pedido. */
const LIMITE_LINHAS = 300;

function opcao(campo, valor) {
  return (campo.op || []).find((o) => o.v === valor) || null;
}

function textoDe(campo, item, refs) {
  const v = item[campo.k];
  if (v === undefined || v === null || v === '') return '—';
  switch (campo.t) {
    case 'select': return opcao(campo, v)?.l || String(v);
    case 'ref': return refs[campo.ref]?.get(v) || '—';
    case 'dinheiro': return fmtDinheiro(v);
    case 'data': return fmtData(v);
    case 'datahora': return fmtDataHora(v);
    case 'sim-nao': return v ? 'Sim' : 'Não';
    case 'tags': return Array.isArray(v) ? v.join(', ') : String(v);
    case 'trilha': return Array.isArray(v) ? v.map((p) => p.orgao).join(' → ') : '—';
    default: return String(v);
  }
}

function dataCurta(iso) {
  const [a, m, d] = String(iso || '').slice(0, 10).split('-');
  return d ? `${d}/${m}/${a.slice(2)}` : '';
}

/**
 * Caminho percorrido pela proposição: um passo por órgão, o último destacado.
 * Numa tramitação longa, o começo importa menos que o fim — por isso a coluna
 * mostra os últimos passos e resume os anteriores numa contagem.
 */
function trilha(passos, { limite = 4, completa = false } = {}) {
  if (!Array.isArray(passos) || !passos.length) {
    return el('span', { class: 'trilha-vazia', texto: 'sem tramitação registrada' });
  }
  const visiveis = completa ? passos : passos.slice(-limite);
  const ocultos = passos.length - visiveis.length;

  return el('ol', { class: `trilha${completa ? ' trilha--completa' : ''}` }, [
    ocultos ? el('li', { class: 'trilha-mais', texto: `+${ocultos} antes` }) : null,
    ...visiveis.map((p, i) => el('li', {
      class: `trilha-passo${i === visiveis.length - 1 ? ' trilha-passo--atual' : ''}`,
    }, [
      el('span', { class: 'trilha-orgao', texto: p.orgao }),
      el('span', { class: 'trilha-data', texto: completa ? fmtData(p.data) : dataCurta(p.data) }),
    ])),
  ]);
}

/**
 * Grava um único campo, sem passar pelo formulário. Atualiza o item em memória
 * antes de confirmar e desfaz se o banco recusar, para a lista não precisar ser
 * redesenhada a cada alteração.
 */
async function gravarCampo(campo, item, ctx, valor) {
  const anterior = item[campo.k] ?? null;
  item[campo.k] = valor;
  try {
    await salvar(ctx.modulo.id, item.id, { [campo.k]: valor });
    return true;
  } catch (erro) {
    console.error(erro);
    item[campo.k] = anterior;
    aviso('Não foi possível salvar a alteração.', 'erro');
    return false;
  }
}

/** Campos marcados como `inline` são alterados na própria lista. */
function celulaEditavel(campo, item, ctx) {
  const naoPropagar = (n) => {
    n.addEventListener('click', (e) => e.stopPropagation());
    n.addEventListener('keydown', (e) => e.stopPropagation());
    return n;
  };

  if (campo.t === 'select') {
    const sel = naoPropagar(el('select', { class: 'inline-select', 'aria-label': campo.l }, [
      el('option', { value: '', texto: '—' }),
      ...campo.op.map((o) => el('option', { value: o.v, texto: o.l })),
    ]));
    sel.value = item[campo.k] ?? '';
    const pintar = () => {
      sel.className = `inline-select inline-select--${opcao(campo, sel.value)?.cor || 'neutro'}`;
    };
    pintar();
    sel.addEventListener('change', async () => {
      const escolhido = sel.value || null;
      if (!await gravarCampo(campo, item, ctx, escolhido)) sel.value = item[campo.k] ?? '';
      pintar();
    });
    return sel;
  }

  if (campo.t === 'sim-nao') {
    const btn = naoPropagar(el('button', { type: 'button', 'aria-label': campo.l }));
    const pintar = () => {
      btn.textContent = item[campo.k] ? 'Sim' : 'Não';
      btn.className = `inline-toggle inline-toggle--${item[campo.k] ? 'ok' : 'neutro'}`;
    };
    pintar();
    btn.addEventListener('click', async () => {
      await gravarCampo(campo, item, ctx, !item[campo.k]);
      pintar();
    });
    return btn;
  }

  // Texto, área e etiquetas: o clique troca o rótulo por um campo de edição.
  const caixa = el('div', { class: 'inline-texto' });

  const comoLista = (v) => (Array.isArray(v) ? v : String(v || '').split(','))
    .map((t) => String(t).trim()).filter(Boolean);

  const mostrar = () => {
    const valor = item[campo.k];
    if (campo.t === 'tags') {
      const etiquetas = comoLista(valor);
      limpar(caixa).appendChild(naoPropagar(el('button', {
        type: 'button',
        class: `inline-abrir${etiquetas.length ? '' : ' inline-abrir--vazio'}`,
        title: `Editar ${campo.l.toLowerCase()}`,
        onclick: () => editar(),
      }, etiquetas.length
        ? etiquetas.map((t) => el('span', { class: 'marcador', texto: t }))
        : [el('span', { texto: 'etiquetar…' })])));
      return;
    }
    limpar(caixa).appendChild(naoPropagar(el('button', {
      type: 'button',
      class: `inline-abrir${valor ? '' : ' inline-abrir--vazio'}`,
      title: `Editar ${campo.l.toLowerCase()}`,
      texto: valor || 'anotar…',
      onclick: () => editar(),
    })));
  };

  const editar = () => {
    const entrada = naoPropagar(campo.t === 'area'
      ? el('textarea', { class: 'inline-entrada', rows: '3' })
      : el('input', {
        class: 'inline-entrada',
        type: 'text',
        placeholder: campo.t === 'tags' ? 'separe por vírgula' : null,
      }));
    entrada.value = campo.t === 'tags'
      ? comoLista(item[campo.k]).join(', ')
      : (item[campo.k] ?? '');

    let desistiu = false;
    entrada.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { desistiu = true; entrada.blur(); }
      if (e.key === 'Enter' && campo.t !== 'area') { e.preventDefault(); entrada.blur(); }
    });
    entrada.addEventListener('blur', async () => {
      const bruto = entrada.value.trim();
      const valor = campo.t === 'tags' ? comoLista(bruto) : (bruto || null);
      const mudou = campo.t === 'tags'
        ? valor.join('|') !== comoLista(item[campo.k]).join('|')
        : valor !== (item[campo.k] ?? null);
      if (!desistiu && mudou) await gravarCampo(campo, item, ctx, valor);
      mostrar();
    });

    limpar(caixa).appendChild(entrada);
    entrada.focus();
  };

  mostrar();
  return caixa;
}

function celula(campo, item, refs, ctx) {
  if (ctx?.editavel && campo.inline) return celulaEditavel(campo, item, ctx);

  if (campo.t === 'trilha') return trilha(item[campo.k]);

  if (campo.t === 'tags' && Array.isArray(item[campo.k]) && item[campo.k].length) {
    return el('div', { class: 'marcadores' },
      item[campo.k].map((t) => el('span', { class: 'marcador', texto: String(t) })));
  }

  // Alguns valores só fazem sentido acompanhados de outro — uma situação sem a
  // data desde quando vigora parece contradizer o resto da linha.
  if (campo.subLinha && item[campo.subLinha.campo]) {
    const apoio = item[campo.subLinha.campo];
    return el('div', { class: 'celula-dupla' }, [
      el('span', { texto: textoDe(campo, item, refs) }),
      el('span', {
        class: 'celula-sub',
        texto: campo.subLinha.prefixo + (/^\d{4}-\d{2}-\d{2}/.test(String(apoio)) ? fmtData(apoio) : apoio),
      }),
    ]);
  }

  if (campo.t === 'select') {
    const o = opcao(campo, item[campo.k]);
    return o ? etiqueta(o.l, o.cor || 'neutro') : document.createTextNode('—');
  }
  if (campo.t === 'sim-nao') {
    return etiqueta(item[campo.k] ? 'Sim' : 'Não', item[campo.k] ? 'ok' : 'neutro');
  }
  const texto = textoDe(campo, item, refs);
  const cls = ['dinheiro', 'numero'].includes(campo.t) ? 'num' : '';
  return el('span', { class: cls, texto: campo.t === 'area' && texto.length > 90 ? `${texto.slice(0, 90)}…` : texto });
}

async function carregarReferencias(modulo) {
  const refs = {};
  const colecoes = [...new Set(modulo.campos.filter((c) => c.t === 'ref').map((c) => c.ref))];
  await Promise.all(colecoes.map(async (col) => {
    const campo = modulo.campos.find((c) => c.ref === col);
    const ops = await opcoesDe(col, campo.rotulo);
    refs[col] = new Map(ops.map((o) => [o.v, o.l]));
    refs[`${col}__opcoes`] = ops;
  }));
  return refs;
}

// ─────────────────────────────── formulário ───────────────────────────────

function campoEntrada(campo, valor, refs) {
  const id = `campo-${campo.k}`;

  // A trilha vem da Câmara, não do gabinete: mostra-se inteira, sem editar.
  if (campo.t === 'trilha') {
    return el('div', { class: 'campo' }, [
      el('label', { texto: campo.l }),
      trilha(valor, { completa: true }),
    ]);
  }

  let entrada;

  switch (campo.t) {
    case 'area':
      entrada = el('textarea', { id, name: campo.k, rows: 4 });
      entrada.value = valor ?? '';
      break;
    case 'select': {
      entrada = el('select', { id, name: campo.k });
      entrada.appendChild(el('option', { value: '', texto: campo.req ? 'Selecione…' : '—' }));
      (campo.op || []).forEach((o) => {
        const op = el('option', { value: o.v, texto: o.l });
        entrada.appendChild(op);
      });
      entrada.value = valor ?? campo.padrao ?? '';
      break;
    }
    case 'ref': {
      entrada = el('select', { id, name: campo.k });
      entrada.appendChild(el('option', { value: '', texto: '—' }));
      (refs[`${campo.ref}__opcoes`] || []).forEach((o) => {
        entrada.appendChild(el('option', { value: o.v, texto: o.l }));
      });
      entrada.value = valor ?? '';
      break;
    }
    case 'sim-nao':
      entrada = el('input', { id, name: campo.k, type: 'checkbox' });
      entrada.checked = !!valor;
      break;
    case 'tags':
      entrada = el('input', { id, name: campo.k, type: 'text', placeholder: 'separe por vírgula' });
      entrada.value = Array.isArray(valor) ? valor.join(', ') : (valor ?? '');
      break;
    case 'dinheiro':
      entrada = el('input', { id, name: campo.k, type: 'number', step: '0.01', min: '0', inputmode: 'decimal' });
      entrada.value = valor ?? '';
      break;
    case 'numero':
      entrada = el('input', { id, name: campo.k, type: 'number', inputmode: 'numeric' });
      entrada.value = valor ?? '';
      break;
    default:
      entrada = el('input', {
        id,
        name: campo.k,
        type: { data: 'date', datahora: 'datetime-local', email: 'email', tel: 'tel', url: 'url' }[campo.t] || 'text',
      });
      entrada.value = valor ?? '';
  }

  if (campo.req && campo.t !== 'sim-nao') entrada.required = true;

  const rotulo = el('label', { for: id, texto: campo.l + (campo.req ? ' *' : '') });
  const bloco = el('div', { class: `campo campo--${campo.t}` }, [rotulo, entrada]);
  if (campo.dica) bloco.appendChild(el('p', { class: 'campo-dica', texto: campo.dica }));
  return bloco;
}

function lerFormulario(modulo, form) {
  const dados = {};
  for (const campo of modulo.campos) {
    const entrada = form.elements[campo.k];
    if (!entrada) continue;
    let v = campo.t === 'sim-nao' ? entrada.checked : entrada.value;
    if (campo.t === 'tags') {
      v = String(v).split(',').map((s) => s.trim()).filter(Boolean);
    } else if (campo.t === 'dinheiro' || campo.t === 'numero') {
      v = v === '' ? null : Number(v);
    } else if (typeof v === 'string') {
      v = v.trim();
    }
    dados[campo.k] = v === '' ? null : v;
  }
  return dados;
}

export async function abrirFormulario(modulo, item, aoSalvar, acoesItem = []) {
  const refs = await carregarReferencias(modulo);
  const editando = !!item?.id;

  const form = el('form', { class: 'form' });
  modulo.campos.forEach((campo) => {
    let valor = item?.[campo.k];
    if (!editando && valor === undefined) {
      if (campo.padrao !== undefined) valor = campo.padrao;
      else if (campo.t === 'data' && campo.req) valor = hoje();
    }
    form.appendChild(campoEntrada(campo, valor, refs));
  });

  const btnSalvar = el('button', { class: 'btn btn--primario', type: 'submit', texto: 'Salvar' });
  const fechar = () => { fundo.remove(); document.removeEventListener('keydown', aoTeclar); };
  const aoTeclar = (e) => { if (e.key === 'Escape') fechar(); };

  form.appendChild(el('div', { class: 'modal-acoes' }, [
    // Ações específicas do módulo — só fazem sentido sobre um registro salvo.
    ...(editando ? acoesItem.map((criar) => criar(item, () => { fechar(); aoSalvar(); })) : []),
    el('button', { class: 'btn btn--fantasma', type: 'button', texto: 'Cancelar', onclick: fechar }),
    btnSalvar,
  ]));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    btnSalvar.disabled = true;
    btnSalvar.textContent = 'Salvando…';
    try {
      const dados = lerFormulario(modulo, form);
      for (const k of CAMPOS_AUTONUMERADOS) {
        if (modulo.campos.some((c) => c.k === k) && !dados[k]) {
          dados[k] = await proximoNumero(modulo.id, k);
        }
      }
      await salvar(modulo.id, item?.id || null, dados);
      aviso(editando ? 'Alterações salvas.' : `${modulo.singular[0].toUpperCase()}${modulo.singular.slice(1)} cadastrada.`);
      fechar();
      aoSalvar();
    } catch (erro) {
      console.error(erro);
      aviso('Não foi possível salvar. Verifique sua conexão e as permissões da sua área.', 'erro');
      btnSalvar.disabled = false;
      btnSalvar.textContent = 'Salvar';
    }
  });

  const fundo = el('div', { class: 'modal-fundo', onclick: (e) => { if (e.target === fundo) fechar(); } }, [
    el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, [
      el('h2', { class: 'modal-titulo', texto: editando ? `Editar ${modulo.singular}` : `Nova ${modulo.singular}` }),
      form,
    ]),
  ]);
  document.body.appendChild(fundo);
  document.addEventListener('keydown', aoTeclar);
  form.querySelector('input, select, textarea')?.focus();
}

// ──────────────────────────────── listagem ────────────────────────────────

export async function renderModulo(container, modulo, { editavel, extras = [], acoesItem = [] }) {
  limpar(container).appendChild(carregando());

  let itens;
  let refs;
  try {
    [itens, refs] = await Promise.all([listar(modulo.id, { recarregar: true }), carregarReferencias(modulo)]);
  } catch (erro) {
    console.error(erro);
    limpar(container).appendChild(vazio('Não foi possível carregar os dados. Recarregue a página.'));
    return;
  }

  const colunas = modulo.campos.filter((c) => c.lista);
  const campoStatus = modulo.campos.find((c) => c.t === 'select' && ['status', 'situacao', 'fase'].includes(c.k));

  const estado = {
    termo: '',
    filtro: '',
    segmento: modulo.segmentos ? modulo.segmentos.op[0].v : null,
    facetas: facetasIniciais(modulo, itens),
  };

  const recarregar = () => renderModulo(container, modulo, { editavel, extras, acoesItem });

  const busca = el('input', {
    type: 'search',
    class: 'busca',
    placeholder: `Buscar em ${modulo.nome.toLowerCase()}…`,
    'aria-label': 'Buscar',
    oninput: (e) => { estado.termo = e.target.value.toLowerCase(); atualizar(); },
  });

  const filtro = campoStatus ? el('select', {
    class: 'filtro',
    'aria-label': campoStatus.l,
    onchange: (e) => { estado.filtro = e.target.value; atualizar(); },
  }, [
    el('option', { value: '', texto: `Todas as situações` }),
    ...campoStatus.op.map((o) => el('option', { value: o.v, texto: o.l })),
  ]) : null;

  const corpo = el('div', { class: 'modulo-corpo' });

  const cabecalho = el('header', { class: 'modulo-topo' }, [
    el('div', { class: 'modulo-titulo' }, [
      el('h1', { texto: modulo.nome }),
      el('p', { texto: modulo.descricao }),
    ]),
    el('div', { class: 'modulo-acoes' }, [
      busca,
      filtro,
      ...(editavel ? extras.map((criar) => criar(recarregar)) : []),
      editavel && !modulo.semCriacao
        ? el('button', {
          class: 'btn btn--primario',
          texto: `Nova ${modulo.singular}`,
          onclick: () => abrirFormulario(modulo, null, recarregar, acoesItem),
        })
        : null,
      editavel ? null : el('span', { class: 'somente-leitura', texto: 'Somente leitura' }),
    ]),
  ]);

  /** Subabas sobre a mesma coleção, com a contagem de cada uma. */
  function controleSegmentos() {
    if (!modulo.segmentos) return null;
    const barra = el('div', { class: 'segmentos', role: 'tablist' });

    const pintar = () => {
      limpar(barra);
      modulo.segmentos.op.forEach((o) => {
        const quantos = itens.filter((i) => i[modulo.segmentos.campo] === o.v).length;
        barra.appendChild(el('button', {
          type: 'button',
          role: 'tab',
          'aria-selected': estado.segmento === o.v ? 'true' : 'false',
          class: `segmento${estado.segmento === o.v ? ' segmento--ativo' : ''}`,
          onclick: () => { estado.segmento = o.v; pintar(); atualizar(); },
        }, [
          el('span', { texto: o.l }),
          el('span', { class: 'segmento-conta', texto: String(quantos) }),
        ]));
      });
    };

    pintar();
    return barra;
  }

  /**
   * O conjunto visível. `ignorar` deixa uma faceta de fora do cálculo, que é
   * como se obtém a contagem de cada opção dela: quantos registros restariam
   * se aquela opção fosse escolhida, com todo o resto do filtro mantido.
   */
  function filtrados(ignorar = null) {
    return itens.filter((i) => {
      if (modulo.segmentos && i[modulo.segmentos.campo] !== estado.segmento) return false;
      if (estado.filtro && campoStatus && i[campoStatus.k] !== estado.filtro) return false;
      for (const f of (modulo.facetas || [])) {
        if (f.campo !== ignorar && !passaNaFaceta(i, f, estado.facetas[f.campo])) return false;
      }
      if (!estado.termo) return true;
      return (modulo.busca || []).some((k) => {
        const campo = modulo.campos.find((c) => c.k === k);
        const texto = campo ? textoDe(campo, i, refs) : String(i[k] ?? '');
        return texto.toLowerCase().includes(estado.termo);
      });
    }).sort(ordenador(modulo));
  }

  const barraFacetas = el('div', { class: 'facetas' });

  /**
   * Desenha as facetas com a contagem de cada opção, recalculada a cada
   * mudança: um número parado ao lado de uma opção mente assim que outro
   * filtro se move.
   */
  function pintarFacetas() {
    if (!modulo.facetas?.length) return;
    limpar(barraFacetas);

    modulo.facetas.forEach((f) => {
      const contagem = contarFaceta(filtrados(f.campo), f);
      if (contagem.size <= 1) return;

      const escolhidos = estado.facetas[f.campo] || new Set();
      const trocar = (valor) => {
        if (escolhidos.has(valor)) escolhidos.delete(valor);
        else escolhidos.add(valor);
        estado.facetas[f.campo] = escolhidos;
        guardarFacetas(modulo, estado.facetas);
        pintarFacetas();
        desenhar();
      };

      const opcoes = [...contagem.entries()].sort(ordenaFaceta(f));
      const campoDaFaceta = modulo.campos.find((c) => c.k === f.campo) || null;
      const bloco = el('div', { class: 'faceta' }, [
        el('span', { class: 'faceta-rotulo', texto: f.l }),
      ]);

      // Poucas opções cabem como botões, que mostram tudo de uma vez. Muitas
      // — os temas passam de trinta — só cabem numa lista.
      if (opcoes.length <= (f.ateChips ?? 12)) {
        bloco.appendChild(el('div', { class: 'faceta-chips' }, opcoes.map(([valor, quantos]) => el('button', {
          type: 'button',
          class: `chip${escolhidos.has(valor) ? ' chip--ativo' : ''}`,
          'aria-pressed': escolhidos.has(valor) ? 'true' : 'false',
          onclick: () => trocar(valor),
        }, [
          el('span', { texto: rotuloDaFaceta(valor, campoDaFaceta) }),
          el('span', { class: 'chip-conta', texto: String(quantos) }),
        ]))));
      } else {
        bloco.appendChild(el('select', {
          class: 'faceta-select',
          'aria-label': f.l,
          onchange: (e) => {
            estado.facetas[f.campo] = e.target.value ? new Set([e.target.value]) : new Set();
            guardarFacetas(modulo, estado.facetas);
            pintarFacetas();
            desenhar();
          },
        }, [
          el('option', { value: '', texto: `Todos — ${f.l.toLowerCase()}` }),
          ...opcoes.map(([valor, quantos]) => el('option', {
            value: valor,
            selected: escolhidos.has(valor) ? 'selected' : null,
            texto: `${rotuloDaFaceta(valor, campoDaFaceta)} (${quantos})`,
          })),
        ]));
      }

      barraFacetas.appendChild(bloco);
    });

    if (algumFiltroAtivo(estado)) {
      barraFacetas.appendChild(el('button', {
        class: 'btn btn--fantasma btn--pequeno',
        type: 'button',
        texto: 'Limpar filtros',
        onclick: () => {
          estado.facetas = {};
          guardarFacetas(modulo, estado.facetas);
          pintarFacetas();
          desenhar();
        },
      }));
    }
  }

  function desenhar() {
    limpar(corpo);
    const lista = filtrados();

    if (!lista.length) {
      corpo.appendChild(vazio(
        itens.length
          ? 'Nenhum registro corresponde ao filtro.'
          : `Nenhuma ${modulo.singular} cadastrada ainda.`,
        editavel && !itens.length && !modulo.semCriacao
          ? el('button', {
            class: 'btn btn--primario',
            texto: `Cadastrar a primeira ${modulo.singular}`,
            onclick: () => abrirFormulario(modulo, null, recarregar, acoesItem),
          })
          : null,
      ));
      return;
    }

    const tbody = el('tbody');
    const criarLinha = (item) => {
      const tr = el('tr', {
        tabindex: '0',
        role: 'button',
        'aria-label': `Abrir ${modulo.singular}`,
        onclick: () => abrirFormulario(modulo, item, recarregar, acoesItem),
        onkeydown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirFormulario(modulo, item, recarregar, acoesItem); }
        },
      });
      colunas.forEach((c) => {
        const td = el('td', { 'data-rotulo': c.l, class: c.inline ? 'col-inline' : null });
        td.appendChild(celula(c, item, refs, { modulo, editavel }));
        tr.appendChild(td);
      });
      const acoes = el('td', { class: 'col-acoes' });
      if (editavel) {
        acoes.appendChild(el('button', {
          class: 'btn-icone',
          title: `Excluir ${modulo.singular}`,
          'aria-label': `Excluir ${modulo.singular}`,
          texto: '✕',
          onclick: async (e) => {
            e.stopPropagation();
            const ok = await confirmar(
              `Excluir ${modulo.singular}?`,
              'O registro será removido definitivamente e não há como desfazer.',
              'Excluir',
            );
            if (!ok) return;
            try {
              await remover(modulo.id, item.id);
              aviso('Registro excluído.');
              recarregar();
            } catch (erro) {
              console.error(erro);
              aviso('Não foi possível excluir. Verifique suas permissões.', 'erro');
            }
          },
        }));
      }
      tr.appendChild(acoes);
      return tr;
    };

    // Duas mil linhas na tela travam o navegador e ninguém as percorre. Mostra-se
    // um teto e oferece-se o resto, para quem realmente quiser rolar tudo.
    const visiveis = estado.verTudo ? lista : lista.slice(0, LIMITE_LINHAS);

    if (modulo.agruparPor) {
      const grupos = new Map();
      visiveis.forEach((i) => {
        const chave = i[modulo.agruparPor] || 'Sem classificação';
        if (!grupos.has(chave)) grupos.set(chave, []);
        grupos.get(chave).push(i);
      });
      [...grupos.entries()]
        .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'pt-BR'))
        .forEach(([nome, doGrupo]) => {
          tbody.appendChild(el('tr', { class: 'linha-grupo' }, [
            el('td', { colspan: String(colunas.length + 1) }, [
              el('span', { class: 'grupo-nome', texto: nome }),
              el('span', { class: 'grupo-conta', texto: String(doGrupo.length) }),
            ]),
          ]));
          doGrupo.forEach((i) => tbody.appendChild(criarLinha(i)));
        });
    } else {
      visiveis.forEach((i) => tbody.appendChild(criarLinha(i)));
    }

    // A contagem precisa dizer que há mais coisa escondida, senão um filtro
    // padrão passa por dado faltando.
    // O total é o da subaba aberta, não o da coleção inteira: na subscrição,
    // comparar com o número global só confundiria.
    const universo = modulo.segmentos
      ? itens.filter((i) => i[modulo.segmentos.campo] === estado.segmento).length
      : itens.length;
    const recortado = lista.length < universo;
    corpo.appendChild(el('p', { class: 'contagem' }, [
      el('span', { texto: `${lista.length} de ${universo} ${universo === 1 ? 'registro' : 'registros'}` }),
      recortado ? el('button', {
        class: 'contagem-acao',
        type: 'button',
        texto: 'ver todos',
        onclick: () => {
          estado.termo = '';
          estado.filtro = '';
          estado.facetas = {};
          busca.value = '';
          if (filtro) filtro.value = '';
          guardarFacetas(modulo, estado.facetas);
          atualizar();
        },
      }) : null,
    ]));
    corpo.appendChild(el('div', { class: 'tabela-rolagem' }, [
      el('table', { class: 'tabela' }, [
        el('thead', {}, [
          el('tr', {}, [
            ...colunas.map((c) => el('th', { scope: 'col', texto: c.l })),
            el('th', { scope: 'col', class: 'col-acoes' }),
          ]),
        ]),
        tbody,
      ]),
    ]));

    if (visiveis.length < lista.length) {
      corpo.appendChild(el('div', { class: 'mostrar-mais' }, [
        el('button', {
          class: 'btn btn--fantasma',
          type: 'button',
          texto: `Mostrar as ${lista.length - visiveis.length} restantes`,
          onclick: () => { estado.verTudo = true; desenhar(); },
        }),
      ]));
    }
  }

  function atualizar() {
    estado.verTudo = false;
    pintarFacetas();
    desenhar();
  }

  limpar(container);
  container.appendChild(cabecalho);
  const barraSegmentos = controleSegmentos();
  if (barraSegmentos) container.appendChild(barraSegmentos);
  if (modulo.facetas?.length) container.appendChild(barraFacetas);
  container.appendChild(corpo);
  atualizar();
}

// ─────────────────────────────── facetas ───────────────────────────────
//
// Uma coleção de duas mil proposições não se navega, se recorta. As facetas
// são os cortes que o próprio dado oferece — tipo, tema, ano —, cada opção com
// a contagem do que resta ao escolhê-la.

/** Marca dos registros sem valor na faceta, para que não fiquem inalcançáveis. */
const SEM_VALOR = ' sem';

/**
 * O rótulo de um valor de faceta. Quando a faceta recai sobre um campo de
 * seleção, o que está gravado é o código — `retirada-pauta` —, e é o rótulo
 * declarado no módulo que a pessoa reconhece.
 */
function rotuloDaFaceta(valor, campo = null) {
  if (valor === SEM_VALOR) return 'Sem classificação';
  return opcao(campo || {}, valor)?.l || valor;
}

/**
 * Os valores de um registro numa faceta, sempre como lista.
 *
 * Um campo pode ser multivalorado (uma proposição tem vários temas) e os
 * registros mais antigos guardavam esses vários num texto só, separados por
 * vírgula — daí o campo alternativo e a repartição.
 */
function valoresDaFaceta(item, faceta) {
  const bruto = item[faceta.campo] ?? (faceta.alternativo ? item[faceta.alternativo] : undefined);
  if (Array.isArray(bruto)) return bruto.filter((v) => v != null && v !== '').map(String);
  if (bruto === null || bruto === undefined || bruto === '') return [];
  if (faceta.multivalor && typeof bruto === 'string') {
    return bruto.split(',').map((v) => v.trim()).filter(Boolean);
  }
  return [String(bruto)];
}

function passaNaFaceta(item, faceta, escolhidos) {
  if (!escolhidos || !escolhidos.size) return true;
  const valores = valoresDaFaceta(item, faceta);
  if (!valores.length) return escolhidos.has(SEM_VALOR);
  return valores.some((v) => escolhidos.has(v));
}

function contarFaceta(lista, faceta) {
  const contagem = new Map();
  lista.forEach((item) => {
    const valores = valoresDaFaceta(item, faceta);
    (valores.length ? valores : [SEM_VALOR]).forEach((v) => {
      contagem.set(v, (contagem.get(v) || 0) + 1);
    });
  });
  return contagem;
}

function ordenaFaceta(faceta) {
  if (faceta.ordem === 'valor-desc') {
    return (a, b) => String(b[0]).localeCompare(String(a[0]), 'pt-BR', { numeric: true });
  }
  if (faceta.ordem === 'valor') {
    return (a, b) => String(a[0]).localeCompare(String(b[0]), 'pt-BR', { numeric: true });
  }
  return (a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'pt-BR');
}

const chaveFacetas = (modulo) => `gab:facetas:${modulo.id}`;

/**
 * A escolha inicial: a da sessão anterior, se houver, senão o padrão do módulo
 * — restrito ao que de fato existe nos dados, para que o padrão nunca produza
 * uma tela vazia num gabinete cuja produção tenha outro perfil.
 */
function facetasIniciais(modulo, itens) {
  const escolhidas = {};
  if (!modulo.facetas?.length) return escolhidas;

  let guardado = null;
  try {
    guardado = JSON.parse(localStorage.getItem(chaveFacetas(modulo)) || 'null');
  } catch { guardado = null; }

  modulo.facetas.forEach((f) => {
    if (guardado && Array.isArray(guardado[f.campo])) {
      escolhidas[f.campo] = new Set(guardado[f.campo]);
      return;
    }
    if (!f.padrao) return;
    const presentes = contarFaceta(itens, f);
    const uteis = f.padrao.filter((v) => presentes.has(v));
    if (uteis.length) escolhidas[f.campo] = new Set(uteis);
  });
  return escolhidas;
}

function guardarFacetas(modulo, facetas) {
  const simples = {};
  Object.entries(facetas).forEach(([campo, conjunto]) => { simples[campo] = [...conjunto]; });
  try {
    localStorage.setItem(chaveFacetas(modulo), JSON.stringify(simples));
  } catch { /* modo anônimo, ou armazenamento cheio: filtra só nesta sessão */ }
}

function algumFiltroAtivo(estado) {
  return Object.values(estado.facetas).some((c) => c && c.size);
}

function ordenador(modulo) {
  const { campo, dir } = modulo.ordenar || {};
  if (!campo) return () => 0;
  const sinal = dir === 'desc' ? -1 : 1;
  return (a, b) => {
    const x = a[campo];
    const y = b[campo];
    if (x === y) return 0;
    if (x === null || x === undefined || x === '') return 1;
    if (y === null || y === undefined || y === '') return -1;
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * sinal;
    const sx = x?.seconds ?? x;
    const sy = y?.seconds ?? y;
    return String(sx).localeCompare(String(sy), 'pt-BR', { numeric: true }) * sinal;
  };
}
