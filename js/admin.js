import {
  db, collection, doc, getDocs, setDoc, deleteDoc, addDoc, updateDoc, serverTimestamp, query, where,
} from './firebase.js';
import { sessao } from './sessao.js';
import { AREAS, PAPEIS, ehAdmin } from './config.js';
import { el, limpar, etiqueta, aviso, confirmar, carregando, vazio, modal} from './ui.js';

/**
 * Gestão de acessos.
 * O administrador do sistema cuida de todos os gabinetes; o chefe de gabinete
 * cuida apenas do seu — que é como um gabinete adiciona gente sem depender
 * de quem mantém o sistema.
 */

function podeGerirTudo() {
  return ehAdmin(sessao.membro);
}

function podeGerirAcessos() {
  return podeGerirTudo() || ['chefe', 'deputado'].includes(sessao.membro?.papel);
}

async function carregarGabinetes() {
  const snap = await getDocs(collection(db, 'gabinetes'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function carregarAutorizados() {
  // A chefia só enxerga o próprio gabinete, e as regras de segurança recusam a
  // consulta ampla — por isso o filtro precisa vir já na pergunta ao banco.
  const base = collection(db, 'autorizados');
  const consulta = podeGerirTudo()
    ? base
    : query(base, where('gabineteId', '==', sessao.membro.gabineteId));
  const snap = await getDocs(consulta);
  return snap.docs.map((d) => ({ email: d.id, ...d.data() }));
}

export async function renderAdmin(container) {
  if (!podeGerirAcessos()) {
    limpar(container).appendChild(vazio('Esta área é restrita à chefia de gabinete e ao administrador do sistema.'));
    return;
  }

  limpar(container).appendChild(carregando());

  let gabinetes = [];
  let acessos = [];
  try {
    [gabinetes, acessos] = await Promise.all([
      podeGerirTudo() ? carregarGabinetes() : Promise.resolve(sessao.gabinete ? [sessao.gabinete] : []),
      carregarAutorizados(),
    ]);
  } catch (erro) {
    console.error(erro);
    limpar(container).appendChild(vazio('Não foi possível carregar os acessos.'));
    return;
  }

  if (!podeGerirTudo()) {
    acessos = acessos.filter((a) => a.gabineteId === sessao.membro.gabineteId);
  }

  const recarregar = () => renderAdmin(container);

  limpar(container);
  container.appendChild(el('header', { class: 'modulo-topo' }, [
    el('div', { class: 'modulo-titulo' }, [
      el('h1', { texto: 'Acessos' }),
      el('p', { texto: 'Só entra no sistema quem estiver nesta lista. O login Google sozinho não abre nada.' }),
    ]),
    el('div', { class: 'modulo-acoes' }, [
      podeGerirTudo()
        ? el('button', { class: 'btn btn--fantasma', texto: 'Novo gabinete', onclick: () => formGabinete(recarregar) })
        : null,
      el('button', {
        class: 'btn btn--primario',
        texto: 'Liberar acesso',
        onclick: () => formAcesso(null, gabinetes, recarregar),
      }),
    ]),
  ]));

  if (sessao.gabinete) container.appendChild(blocoGabinete(recarregar));

  if (podeGerirTudo()) {
    container.appendChild(el('section', { class: 'bloco' }, [
      el('header', { class: 'bloco-topo' }, [el('h2', { texto: 'Gabinetes' })]),
      gabinetes.length
        ? el('ul', { class: 'lista' }, gabinetes.map((g) => el('li', { class: 'linha' }, [
          el('div', { class: 'linha-texto' }, [
            el('span', { class: 'linha-principal', texto: g.nome || g.id }),
            el('span', { class: 'linha-secundaria', texto: [g.deputado, g.uf].filter(Boolean).join(' · ') || g.id }),
          ]),
          etiqueta(`${acessos.filter((a) => a.gabineteId === g.id).length} acessos`, 'neutro'),
        ])))
        : el('p', { class: 'bloco-vazio', texto: 'Nenhum gabinete cadastrado. Crie o primeiro para poder liberar acessos.' }),
    ]));
  }

  const corpo = el('div', { class: 'modulo-corpo' });
  if (!acessos.length) {
    corpo.appendChild(vazio('Nenhum acesso liberado ainda.'));
  } else {
    const tbody = el('tbody');
    acessos
      .sort((a, b) => (a.nome || a.email).localeCompare(b.nome || b.email, 'pt-BR'))
      .forEach((a) => {
        const tr = el('tr', {
          tabindex: '0',
          role: 'button',
          onclick: () => formAcesso(a, gabinetes, recarregar),
          onkeydown: (e) => { if (e.key === 'Enter') formAcesso(a, gabinetes, recarregar); },
        }, [
          el('td', { 'data-rotulo': 'Nome', texto: a.nome || '—' }),
          el('td', { 'data-rotulo': 'E-mail', texto: a.email }),
          el('td', { 'data-rotulo': 'Papel' }, [etiqueta(PAPEIS[a.papel]?.nome || a.papel, 'info')]),
          el('td', {
            'data-rotulo': 'Áreas',
            texto: a.papel === 'assessor'
              ? (a.areas || []).map((id) => AREAS.find((x) => x.id === id)?.sigla || id).join(' ') || '—'
              : '—',
          }),
          el('td', { 'data-rotulo': 'Gabinete', texto: gabinetes.find((g) => g.id === a.gabineteId)?.nome || a.gabineteId || '—' }),
          el('td', { 'data-rotulo': 'Situação' }, [
            etiqueta(a.ativo === false ? 'Suspenso' : 'Ativo', a.ativo === false ? 'neutro' : 'ok'),
          ]),
          el('td', { class: 'col-acoes' }, [
            el('button', {
              class: 'btn-icone',
              texto: '✕',
              title: 'Remover acesso',
              'aria-label': `Remover acesso de ${a.email}`,
              onclick: async (e) => {
                e.stopPropagation();
                if (a.email === sessao.membro.email) {
                  aviso('Você não pode remover o próprio acesso.', 'erro');
                  return;
                }
                const ok = await confirmar('Remover acesso?',
                  `${a.email} deixará de conseguir entrar no sistema.`, 'Remover');
                if (!ok) return;
                try {
                  await deleteDoc(doc(db, 'autorizados', a.email));
                  aviso('Acesso removido.');
                  recarregar();
                } catch (erro) {
                  console.error(erro);
                  aviso('Não foi possível remover o acesso.', 'erro');
                }
              },
            }),
          ]),
        ]);
        tbody.appendChild(tr);
      });

    corpo.appendChild(el('div', { class: 'tabela-rolagem' }, [
      el('table', { class: 'tabela' }, [
        el('thead', {}, [el('tr', {}, [
          ...['Nome', 'E-mail', 'Papel', 'Áreas', 'Gabinete', 'Situação'].map((t) => el('th', { scope: 'col', texto: t })),
          el('th', { class: 'col-acoes' }),
        ])]),
        tbody,
      ]),
    ]));
  }
  container.appendChild(corpo);
}

/** Dados do próprio gabinete. O ID na Câmara é o que destrava as integrações. */
function blocoGabinete(aoConcluir) {
  const g = sessao.gabinete;
  const linhas = [
    ['Nome', g.nome || '—'],
    ['Parlamentar', g.deputado || '—'],
    ['UF', g.uf || '—'],
    ['ID na Câmara', g.idDeputadoCamara || 'não informado'],
    ['Cota mensal (CEAP)', g.cotaMensal
      ? g.cotaMensal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
      : 'não informada'],
  ];

  return el('section', { class: 'bloco' }, [
    el('header', { class: 'bloco-topo' }, [
      el('h2', { texto: 'Dados do gabinete' }),
      podeGerirAcessos()
        ? el('button', { class: 'btn btn--fantasma btn--pequeno', texto: 'Editar', onclick: () => formGabineteAtual(aoConcluir) })
        : null,
    ]),
    el('ul', { class: 'lista' }, linhas.map(([rotulo, valor]) => el('li', { class: 'linha' }, [
      el('div', { class: 'linha-texto' }, [
        el('span', { class: 'linha-secundaria', texto: rotulo }),
        el('span', { class: 'linha-principal', texto: String(valor) }),
      ]),
    ]))),
    g.idDeputadoCamara
      ? null
      : el('p', {
        class: 'campo-dica',
        texto: 'Sem o ID na Câmara, o acompanhamento de proposições e a conferência da cota não conseguem buscar os dados do parlamentar.',
      }),
  ]);
}

function formGabineteAtual(aoConcluir) {
  const g = sessao.gabinete;
  const form = el('form', { class: 'form' });
  const nome = el('input', { type: 'text', required: true });
  const deputado = el('input', { type: 'text' });
  const uf = el('input', { type: 'text', maxlength: '2' });
  const idCamara = el('input', { type: 'number', inputmode: 'numeric' });
  const cota = el('input', { type: 'number', inputmode: 'decimal', step: '0.01', min: '0' });
  nome.value = g.nome || '';
  deputado.value = g.deputado || '';
  uf.value = g.uf || '';
  idCamara.value = g.idDeputadoCamara || '';
  cota.value = g.cotaMensal ?? '';

  form.append(
    el('div', { class: 'campo' }, [el('label', { texto: 'Nome do gabinete *' }), nome]),
    el('div', { class: 'campo' }, [el('label', { texto: 'Parlamentar' }), deputado]),
    el('div', { class: 'linha-campos' }, [
      el('div', { class: 'campo' }, [el('label', { texto: 'UF' }), uf]),
      el('div', { class: 'campo' }, [el('label', { texto: 'ID na Câmara' }), idCamara]),
    ]),
    // O teto da CEAP varia por UF e é fixado por ato da Mesa; a base aberta não
    // o publica. Sem esse número não há como falar de economia — só de gasto —,
    // e é por isso que ele é pedido aqui em vez de estimado.
    el('div', { class: 'campo' }, [
      el('label', { texto: 'Cota mensal da CEAP (R$)' }),
      cota,
      el('p', {
        class: 'campo-dica',
        texto: 'O valor do seu estado, fixado por ato da Mesa. É o que permite calcular quanto do teto foi usado e quanto foi devolvido.',
      }),
    ]),
    el('p', {
      class: 'campo-dica',
      texto: 'O ID está em dadosabertos.camara.leg.br/api/v2/deputados?nome=SOBRENOME — é o campo "id" do resultado.',
    }),
  );

  const btn = el('button', { class: 'btn btn--primario', type: 'submit', texto: 'Salvar' });
  const fechar = modal('Dados do gabinete', form);
  form.appendChild(el('div', { class: 'modal-acoes' }, [
    el('button', { class: 'btn btn--fantasma', type: 'button', texto: 'Cancelar', onclick: () => fechar() }),
    btn,
  ]));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    btn.disabled = true;
    btn.textContent = 'Salvando…';
    const dados = {
      nome: nome.value.trim(),
      deputado: deputado.value.trim() || null,
      uf: uf.value.trim().toUpperCase() || null,
      idDeputadoCamara: idCamara.value ? Number(idCamara.value) : null,
      cotaMensal: cota.value ? Number(cota.value) : null,
      atualizadoEm: serverTimestamp(),
      atualizadoPor: sessao.membro.email,
    };
    try {
      await updateDoc(doc(db, 'gabinetes', g.id), dados);
      Object.assign(sessao.gabinete, dados);
      aviso('Dados do gabinete atualizados.');
      fechar();
      aoConcluir();
    } catch (erro) {
      console.error(erro);
      aviso('Não foi possível salvar os dados do gabinete.', 'erro');
      btn.disabled = false;
      btn.textContent = 'Salvar';
    }
  });
}

function formAcesso(acesso, gabinetes, aoConcluir) {
  const editando = !!acesso;
  const form = el('form', { class: 'form' });

  const email = el('input', { type: 'email', name: 'email', required: true, readonly: editando });
  email.value = acesso?.email || '';
  const nome = el('input', { type: 'text', name: 'nome' });
  nome.value = acesso?.nome || '';

  const papel = el('select', { name: 'papel' }, Object.entries(PAPEIS)
    .filter(([id]) => podeGerirTudo() || id !== 'admin')
    .map(([id, p]) => el('option', { value: id, texto: p.nome })));
  papel.value = acesso?.papel || 'assessor';

  const gabinete = el('select', { name: 'gabineteId' }, [
    el('option', { value: '', texto: '—' }),
    ...gabinetes.map((g) => el('option', { value: g.id, texto: g.nome || g.id })),
  ]);
  gabinete.value = acesso?.gabineteId || sessao.membro.gabineteId || '';

  const areasCaixas = AREAS.map((a) => {
    const caixa = el('input', { type: 'checkbox', value: a.id, id: `area-${a.id}` });
    caixa.checked = (acesso?.areas || []).includes(a.id);
    return el('label', { class: 'caixa', for: `area-${a.id}` }, [caixa, el('span', { texto: a.nome })]);
  });
  const blocoAreas = el('div', { class: 'campo' }, [
    el('label', { texto: 'Áreas que pode editar' }),
    el('div', { class: 'caixas' }, areasCaixas),
    el('p', { class: 'campo-dica', texto: 'Só se aplica ao papel Assessor. Os demais papéis já têm o alcance definido.' }),
  ]);

  const ativo = el('input', { type: 'checkbox', id: 'acesso-ativo' });
  ativo.checked = acesso?.ativo !== false;

  const atualizarAreas = () => { blocoAreas.hidden = papel.value !== 'assessor'; };
  papel.addEventListener('change', atualizarAreas);

  form.append(
    el('div', { class: 'campo' }, [el('label', { for: 'email', texto: 'E-mail da conta Google *' }), email,
      el('p', { class: 'campo-dica', texto: 'Precisa ser exatamente o e-mail com que a pessoa faz login.' })]),
    el('div', { class: 'campo' }, [el('label', { texto: 'Nome' }), nome]),
    el('div', { class: 'campo' }, [el('label', { texto: 'Papel' }), papel,
      el('p', { class: 'campo-dica', texto: PAPEIS[papel.value]?.descricao || '' })]),
    el('div', { class: 'campo' }, [el('label', { texto: 'Gabinete' }), gabinete]),
    blocoAreas,
    el('div', { class: 'campo' }, [el('label', { class: 'caixa', for: 'acesso-ativo' }, [ativo, el('span', { texto: 'Acesso ativo' })])]),
  );
  atualizarAreas();

  const btn = el('button', { class: 'btn btn--primario', type: 'submit', texto: 'Salvar' });
  const fechar = modal(editando ? 'Editar acesso' : 'Liberar acesso', form);
  form.appendChild(el('div', { class: 'modal-acoes' }, [
    el('button', { class: 'btn btn--fantasma', type: 'button', texto: 'Cancelar', onclick: () => fechar() }),
    btn,
  ]));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const chave = email.value.trim().toLowerCase();
    if (papel.value !== 'admin' && !gabinete.value) {
      aviso('Escolha o gabinete deste acesso.', 'erro');
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Salvando…';
    try {
      await setDoc(doc(db, 'autorizados', chave), {
        nome: nome.value.trim() || null,
        papel: papel.value,
        gabineteId: gabinete.value || null,
        areas: papel.value === 'assessor' ? areasCaixas.map((l) => l.querySelector('input')).filter((c) => c.checked).map((c) => c.value) : [],
        ativo: ativo.checked,
        atualizadoEm: serverTimestamp(),
        atualizadoPor: sessao.membro.email,
      }, { merge: true });
      aviso(editando ? 'Acesso atualizado.' : 'Acesso liberado.');
      fechar();
      aoConcluir();
    } catch (erro) {
      console.error(erro);
      aviso('Não foi possível salvar o acesso.', 'erro');
      btn.disabled = false;
      btn.textContent = 'Salvar';
    }
  });
}

function formGabinete(aoConcluir) {
  const form = el('form', { class: 'form' });
  const nome = el('input', { type: 'text', required: true });
  const deputado = el('input', { type: 'text' });
  const uf = el('input', { type: 'text', maxlength: '2', placeholder: 'RS' });
  const idCamara = el('input', { type: 'number', inputmode: 'numeric' });

  form.append(
    el('div', { class: 'campo' }, [el('label', { texto: 'Nome do gabinete *' }), nome]),
    el('div', { class: 'campo' }, [el('label', { texto: 'Parlamentar' }), deputado]),
    el('div', { class: 'campo' }, [el('label', { texto: 'UF' }), uf]),
    el('div', { class: 'campo' }, [el('label', { texto: 'ID do deputado na Câmara' }), idCamara,
      el('p', { class: 'campo-dica', texto: 'Usado para buscar proposições e despesas na base de dados abertos.' })]),
  );

  const btn = el('button', { class: 'btn btn--primario', type: 'submit', texto: 'Criar gabinete' });
  const fechar = modal('Novo gabinete', form);
  form.appendChild(el('div', { class: 'modal-acoes' }, [
    el('button', { class: 'btn btn--fantasma', type: 'button', texto: 'Cancelar', onclick: () => fechar() }),
    btn,
  ]));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    btn.disabled = true;
    try {
      await addDoc(collection(db, 'gabinetes'), {
        nome: nome.value.trim(),
        deputado: deputado.value.trim() || null,
        uf: uf.value.trim().toUpperCase() || null,
        idDeputadoCamara: idCamara.value ? Number(idCamara.value) : null,
        criadoEm: serverTimestamp(),
        criadoPor: sessao.membro.email,
      });
      aviso('Gabinete criado.');
      fechar();
      aoConcluir();
    } catch (erro) {
      console.error(erro);
      aviso('Não foi possível criar o gabinete.', 'erro');
      btn.disabled = false;
    }
  });
}
