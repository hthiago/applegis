import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  initializeFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc,
  deleteDoc, query, where, orderBy, limit, serverTimestamp, onSnapshot, writeBatch,
  Timestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import {
  getFunctions, httpsCallable,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js';

import { FIREBASE_CONFIG, FIRESTORE_DATABASE_ID, REGIAO_FUNCOES } from './config.js';

export const app = initializeApp(FIREBASE_CONFIG);
export const auth = getAuth(app);

/**
 * O Firestore fala por um canal de streaming que redes corporativas e órgãos
 * públicos frequentemente cortam — o sintoma é a consulta simplesmente não
 * responder. O modo de sondagem longa troca esse canal por requisições HTTP
 * comuns, que atravessam qualquer proxy.
 *
 * Custa um pouco de eficiência, irrelevante no volume de um gabinete, e em
 * troca o sistema funciona na rede da Câmara, em 4G e em Wi-Fi doméstico sem
 * depender de configuração de rede.
 */
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
}, FIRESTORE_DATABASE_ID);

/**
 * As funções ficam na mesma região do banco. Região errada não dá erro de
 * configuração: dá "not-found" na chamada, que parece função inexistente.
 */
export const funcoes = getFunctions(app, REGIAO_FUNCOES);

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

export function entrarComGoogle() {
  return signInWithPopup(auth, provider);
}

export function sair() {
  return signOut(auth);
}

export {
  onAuthStateChanged, collection, doc, getDoc, getDocs, setDoc, addDoc,
  updateDoc, deleteDoc, query, where, orderBy, limit, serverTimestamp, onSnapshot,
  writeBatch, Timestamp, httpsCallable,
};
