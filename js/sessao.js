import {
  auth, db, doc, getDoc, setDoc, addDoc, collection, onAuthStateChanged, serverTimestamp,
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
  estado: 'carregando', // carregando | anonimo | primeiro-acesso | sem-acesso | pronto
  erro: null,
};

/**
 * O banco vazio aceita uma única instalação: quem entrar primeiro cria o
 * gabinete e vira chefe. A partir daí o documento `sistema/instalado` existe e
 * as regras fecham essa porta para sempre — por isso o primeiro acesso deve ser
 * feito logo depois de publicar as regras.
 */
async function jaInstalado() {
  try {
    return (await getDoc(doc(db, 'sistema', 'instalado'))).exists();
  } catch {
    return true; // na dúvida, não oferece a instalação
  }
}

/**
 * Falha ao consultar o banco quase sempre é configuração faltando, não defeito.
 * Dizer qual poupa horas — a mensagem genérica anterior escondia a causa.
 */
function recadoDeFalha(erro) {
  switch (erro?.code) {
    case 'permission-denied':
      return 'O banco recusou a consulta. Na prática isso significa que as regras de segurança não foram publicadas: abra o Firestore, aba Regras, e confira se o conteúdo é o do arquivo firestore.rules.';
    case 'unavailable':
    case 'deadline-exceeded':
      // O SDK reporta banco inexistente como "cliente offline", o que manda
      // quem está instalando procurar problema de rede que não existe.
      return 'O banco não respondeu. Ou a rede está bloqueando o Firestore, ou o banco (default) ainda não foi criado neste projeto — confira no console do Firebase qual dos dois.';
    case 'failed-precondition':
      return 'O Firestore deste projeto parece não estar criado, ou está com outro nome que não o padrão.';
    case 'not-found':
      return 'O banco de dados não foi encontrado neste projeto. Confira se o Firestore foi criado.';
    default:
      return `Não foi possível verificar seu acesso (${erro?.code || 'erro desconhecido'}).`;
  }
}

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
      definir('sem-acesso', { erro: recadoDeFalha(e) });
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

  if (!autorizacao.exists()) {
    definir(await jaInstalado() ? 'sem-acesso' : 'primeiro-acesso',
      { membro: null, gabinete: null, erro: null });
    return;
  }

  if (autorizacao.data().ativo === false) {
    definir('sem-acesso', {
      membro: null,
      gabinete: null,
      erro: 'Seu acesso foi suspenso. Fale com a chefia de gabinete.',
    });
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

/**
 * Instalação: cria o gabinete, torna quem está logado o chefe dele e fecha a
 * porta de instalação. A ordem importa — `sistema/instalado` é gravado por
 * último, para que uma falha no meio possa ser repetida.
 */
export async function instalar({ nome, deputado, uf, idDeputadoCamara }) {
  const usuario = sessao.usuario;
  const email = usuario.email.trim().toLowerCase();

  const gabinete = await addDoc(collection(db, 'gabinetes'), {
    nome,
    deputado: deputado || null,
    uf: uf || null,
    idDeputadoCamara: idDeputadoCamara || null,
    criadoEm: serverTimestamp(),
    criadoPor: email,
  });

  await setDoc(doc(db, 'autorizados', email), {
    nome: usuario.displayName || email,
    papel: 'chefe',
    gabineteId: gabinete.id,
    areas: [],
    ativo: true,
    criadoEm: serverTimestamp(),
  });

  await setDoc(doc(db, 'sistema', 'instalado'), {
    em: serverTimestamp(),
    por: email,
    gabineteId: gabinete.id,
  });

  await carregarAcesso(usuario);
}

/** Caminho de qualquer coleção do gabinete atual. Nada é lido fora dele. */
export function caminho(colecao) {
  if (!sessao.membro?.gabineteId) throw new Error('Sessão sem gabinete definido.');
  return ['gabinetes', sessao.membro.gabineteId, colecao];
}
