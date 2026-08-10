import {
  auth, db, doc, getDoc, setDoc, onAuthStateChanged, serverTimestamp,
} from './firebase.js';

/**
 * Estado da sessão.
 * `membro` reúne o que a lista de autorizados diz sobre a pessoa: papel, áreas e gabinete.
 * Sem entrada na lista de autorizados não existe sessão, mesmo com login Google válido.
 */
export const sessao = {
  usuario: null,
  membro: null,
  gabinete: null,
  estado: 'carregando', // carregando | anonimo | sem-acesso | pronto
  erro: null,
};

const ouvintes = new Set();

export function aoMudarSessao(fn) {
  ouvintes.add(fn);
  return () => ouvintes.delete(fn);
}

function avisar() {
  ouvintes.forEach((fn) => fn(sessao));
}

function definir(estado, extra = {}) {
  sessao.estado = estado;
  Object.assign(sessao, extra);
  avisar();
}

export function iniciarSessao() {
  onAuthStateChanged(auth, async (usuario) => {
    if (!usuario) {
      definir('anonimo', { usuario: null, membro: null, gabinete: null, erro: null });
      return;
    }
    definir('carregando', { usuario });
    try {
      await carregarAcesso(usuario);
    } catch (e) {
      console.error(e);
      definir('sem-acesso', {
        erro: 'Não foi possível verificar seu acesso. Tente novamente em instantes.',
      });
    }
  });
}

async function carregarAcesso(usuario) {
  const email = (usuario.email || '').trim().toLowerCase();
  if (!email) {
    definir('sem-acesso', { erro: 'Sua conta Google não expôs um e-mail.' });
    return;
  }

  const autorizacao = await getDoc(doc(db, 'autorizados', email));
  if (!autorizacao.exists() || autorizacao.data().ativo === false) {
    definir('sem-acesso', { membro: null, gabinete: null, erro: null });
    return;
  }

  const dados = autorizacao.data();
  const membro = {
    uid: usuario.uid,
    email,
    nome: dados.nome || usuario.displayName || email,
    foto: usuario.photoURL || '',
    papel: dados.papel || 'leitor',
    areas: dados.areas || [],
    gabineteId: dados.gabineteId || null,
    ativo: dados.ativo !== false,
  };

  if (membro.papel !== 'admin' && !membro.gabineteId) {
    definir('sem-acesso', {
      erro: 'Seu acesso ainda não foi vinculado a um gabinete. Peça ao administrador para concluir o cadastro.',
    });
    return;
  }

  let gabinete = null;
  if (membro.gabineteId) {
    // Espelha o acesso dentro do gabinete: é este documento que as regras de
    // segurança consultam para decidir o que a pessoa pode ler e escrever.
    await setDoc(
      doc(db, 'gabinetes', membro.gabineteId, 'membros', usuario.uid),
      {
        email: membro.email,
        nome: membro.nome,
        foto: membro.foto,
        papel: membro.papel,
        areas: membro.areas,
        ativo: membro.ativo,
        ultimoAcesso: serverTimestamp(),
      },
      { merge: true },
    );

    const snap = await getDoc(doc(db, 'gabinetes', membro.gabineteId));
    gabinete = snap.exists() ? { id: snap.id, ...snap.data() } : null;
  }

  definir('pronto', { membro, gabinete, erro: null });
}

/** Caminho de qualquer coleção do gabinete atual. Nada é lido fora dele. */
export function caminho(colecao) {
  if (!sessao.membro?.gabineteId) throw new Error('Sessão sem gabinete definido.');
  return ['gabinetes', sessao.membro.gabineteId, colecao];
}
