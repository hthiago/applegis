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
    default: return String(v);
  }
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

  // Texto e área: o clique troca o rótulo por um campo de edição.
  const caixa = el('div', { class: 'inline-texto' });

  const mostrar = () => {
    const valor = item[campo.k];
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
      : el('input', { class: 'inline-entrada', type: 'text' }));
    entrada.value = item[campo.k] ?? '';

    let desistiu = false;
    entrada.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { desistiu = true; entrada.blur(); }
      if (e.key === 'Enter' && campo.t !== 'area') { e.preventDefault(); entrada.blur(); }
    });
    entrada.addEventListener('blur', async () => {
      const valor = entrada.value.trim() || null;
      if (!desistiu && valor !== (item[campo.k] ?? null)) await gravarCampo(campo, item, ctx, valor);
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

export async function abrirFormulario(modulo, item, aoSalvar) {
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

export async function renderModulo(container, modulo, { editavel, extras = [] }) {
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

  const estado = { termo: '', filtro: '' };

  const recarregar = () => renderModulo(container, modulo, { editavel, extras });

  const busca = el('input', {
    type: 'search',
    class: 'busca',
    placeholder: `Buscar em ${modulo.nome.toLowerCase()}…`,
    'aria-label': 'Buscar',
    oninput: (e) => { estado.termo = e.target.value.toLowerCase(); desenhar(); },
  });

  const filtro = campoStatus ? el('select', {
    class: 'filtro',
    'aria-label': campoStatus.l,
    onchange: (e) => { estado.filtro = e.target.value; desenhar(); },
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
      editavel
        ? el('button', {
          class: 'btn btn--primario',
          texto: `Nova ${modulo.singular}`,
          onclick: () => abrirFormulario(modulo, null, recarregar),
        })
        : el('span', { class: 'somente-leitura', texto: 'Somente leitura' }),
    ]),
  ]);

  function filtrados() {
    return itens.filter((i) => {
      if (estado.filtro && campoStatus && i[campoStatus.k] !== estado.filtro) return false;
      if (!estado.termo) return true;
      return (modulo.busca || []).some((k) => {
        const campo = modulo.campos.find((c) => c.k === k);
        const texto = campo ? textoDe(campo, i, refs) : String(i[k] ?? '');
        return texto.toLowerCase().includes(estado.termo);
      });
    }).sort(ordenador(modulo));
  }

  function desenhar() {
    limpar(corpo);
    const lista = filtrados();

    if (!lista.length) {
      corpo.appendChild(vazio(
        itens.length
          ? 'Nenhum registro corresponde ao filtro.'
          : `Nenhuma ${modulo.singular} cadastrada ainda.`,
        editavel && !itens.length
          ? el('button', {
            class: 'btn btn--primario',
            texto: `Cadastrar a primeira ${modulo.singular}`,
            onclick: () => abrirFormulario(modulo, null, recarregar),
          })
          : null,
      ));
      return;
    }

    const tbody = el('tbody');
    lista.forEach((item) => {
      const tr = el('tr', {
        tabindex: '0',
        role: 'button',
        'aria-label': `Abrir ${modulo.singular}`,
        onclick: () => abrirFormulario(modulo, item, recarregar),
        onkeydown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirFormulario(modulo, item, recarregar); }
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
      tbody.appendChild(tr);
    });

    corpo.appendChild(el('p', { class: 'contagem', texto: `${lista.length} de ${itens.length} ${lista.length === 1 ? 'registro' : 'registros'}` }));
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
  }

  limpar(container);
  container.appendChild(cabecalho);
  container.appendChild(corpo);
  desenhar();
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
