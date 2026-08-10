/** Helpers de interface: criação de elementos, formatação e avisos. */

export function el(tag, attrs = {}, filhos = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'texto') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  (Array.isArray(filhos) ? filhos : [filhos]).forEach((f) => {
    if (f === null || f === undefined || f === false) return;
    n.appendChild(typeof f === 'string' ? document.createTextNode(f) : f);
  });
  return n;
}

export function limpar(no) {
  while (no.firstChild) no.removeChild(no.firstChild);
  return no;
}

const MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const MOEDA_CURTA = new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1,
});

export function fmtDinheiro(v) {
  const n = Number(v);
  return Number.isFinite(n) ? MOEDA.format(n) : '—';
}

export function fmtDinheiroCurto(v) {
  const n = Number(v);
  return Number.isFinite(n) ? MOEDA_CURTA.format(n) : '—';
}

export function fmtData(v) {
  if (!v) return '—';
  const [a, m, d] = String(v).slice(0, 10).split('-');
  return d ? `${d}/${m}/${a}` : String(v);
}

export function fmtDataHora(v) {
  if (!v) return '—';
  const dt = new Date(v);
  if (Number.isNaN(dt.getTime())) return String(v);
  return dt.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function hoje() {
  return new Date().toISOString().slice(0, 10);
}

/** Dias entre hoje e uma data ISO. Negativo significa atrasado. */
export function diasAte(iso) {
  if (!iso) return null;
  const alvo = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(alvo.getTime())) return null;
  const agora = new Date();
  agora.setHours(0, 0, 0, 0);
  return Math.round((alvo - agora) / 86400000);
}

export function etiqueta(texto, cor = 'neutro') {
  return el('span', { class: `etiqueta etiqueta--${cor}`, texto });
}

let areaAvisos = null;

export function aviso(texto, tipo = 'ok') {
  if (!areaAvisos) {
    areaAvisos = el('div', { class: 'avisos', 'aria-live': 'polite' });
    document.body.appendChild(areaAvisos);
  }
  const n = el('div', { class: `aviso aviso--${tipo}`, texto });
  areaAvisos.appendChild(n);
  setTimeout(() => {
    n.classList.add('aviso--saindo');
    setTimeout(() => n.remove(), 300);
  }, 4000);
}

/** Confirmação em diálogo próprio — o confirm() nativo é bloqueado em alguns navegadores instalados como app. */
export function confirmar(titulo, mensagem, rotuloAcao = 'Confirmar') {
  return new Promise((resolve) => {
    const fechar = (r) => { fundo.remove(); document.removeEventListener('keydown', aoTeclar); resolve(r); };
    const aoTeclar = (e) => { if (e.key === 'Escape') fechar(false); };
    const botao = el('button', { class: 'btn btn--perigo', texto: rotuloAcao, onclick: () => fechar(true) });
    const fundo = el('div', { class: 'modal-fundo', onclick: (e) => { if (e.target === fundo) fechar(false); } }, [
      el('div', { class: 'modal modal--estreito', role: 'dialog', 'aria-modal': 'true' }, [
        el('h2', { class: 'modal-titulo', texto: titulo }),
        el('p', { class: 'modal-texto', texto: mensagem }),
        el('div', { class: 'modal-acoes' }, [
          el('button', { class: 'btn btn--fantasma', texto: 'Cancelar', onclick: () => fechar(false) }),
          botao,
        ]),
      ]),
    ]);
    document.body.appendChild(fundo);
    document.addEventListener('keydown', aoTeclar);
    botao.focus();
  });
}

export function vazio(mensagem, acao = null) {
  return el('div', { class: 'vazio' }, [
    el('p', { texto: mensagem }),
    acao,
  ]);
}

export function carregando(texto = 'Carregando…') {
  return el('div', { class: 'carregando', texto });
}
