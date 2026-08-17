/**
 * Leitura de bilhetes de passagem, e o painel de voos.
 *
 * O que isto substitui: alguém do gabinete recebe por WhatsApp a captura do
 * e-ticket e redigita origem, destino, data, hora, voo e localizador em dois
 * lugares — na planilha de viagens e na agenda. É transcrição, erra em número de
 * voo e horário, e o erro só aparece no aeroporto.
 *
 * A regra que atravessa este arquivo: **nada é gravado sem confirmação**. A
 * leitura de imagem erra, e uma viagem gravada sozinha com a data errada é pior
 * que uma viagem não gravada — a segunda alguém percebe que falta, a primeira
 * ninguém percebe até o embarque. Então a função devolve o que leu, a tela mostra
 * campo por campo com o que não deu para ler em destaque, e quem confirma é gente.
 */

const MAIOR_LADO = 1600;

/**
 * A imagem, encolhida e em base64.
 *
 * Uma captura de celular tem 3 MB e 4000 pixels de largura; o bilhete cabe em
 * 1600. Encolher antes de enviar é o que faz a leitura ser barata e rápida — e
 * evita bater no limite da chamada, que era o caminho para uma mensagem de erro
 * sem explicação.
 */
export async function prepararImagem(arquivo) {
  const aceitos = ['image/png', 'image/jpeg', 'image/webp'];
  if (!aceitos.includes(arquivo.type)) {
    throw new Error(`Formato não aceito: ${arquivo.type || 'desconhecido'}. Envie uma captura em PNG ou JPEG.`);
  }

  const bitmap = await createImageBitmap(arquivo);
  const escala = Math.min(1, MAIOR_LADO / Math.max(bitmap.width, bitmap.height));
  const largura = Math.round(bitmap.width * escala);
  const altura = Math.round(bitmap.height * escala);

  const tela = document.createElement('canvas');
  tela.width = largura;
  tela.height = altura;
  tela.getContext('2d').drawImage(bitmap, 0, 0, largura, altura);

  const url = tela.toDataURL('image/jpeg', 0.85);
  return { imagemBase64: url.split(',')[1], tipoMime: 'image/jpeg', largura, altura };
}

/** Chama a leitura no servidor, onde a chave da API vive. */
export async function lerBilhete(arquivo) {
  const { funcoes, httpsCallable } = await import('./firebase.js');
  const { imagemBase64, tipoMime } = await prepararImagem(arquivo);
  const chamar = httpsCallable(funcoes, 'lerPassagem');
  const r = await chamar({ imagemBase64, tipoMime });
  return r.data;
}

/**
 * Um trecho lido virado registro de viagem.
 *
 * Campo ilegível fica nulo, e não com um palpite: a tela pinta o vazio, e vazio
 * pede atenção enquanto palpite passa por conferido.
 */
export function viagemDoTrecho(t, { viajante = null } = {}) {
  const texto = (v) => (v === null || v === undefined || v === '' ? null : String(v).trim());
  const local = (nome, sigla) => [texto(nome), texto(sigla)].filter(Boolean).join(' · ') || null;

  return {
    viajante: texto(t.passageiro) || viajante || null,
    origem: local(t.origem, t.origemSigla),
    destino: local(t.destino, t.destinoSigla),
    ida: /^\d{4}-\d{2}-\d{2}$/.test(String(t.data || '')) ? t.data : null,
    horaPartida: /^\d{1,2}:\d{2}$/.test(String(t.horaPartida || '')) ? t.horaPartida : null,
    horaChegada: /^\d{1,2}:\d{2}$/.test(String(t.horaChegada || '')) ? t.horaChegada : null,
    companhia: texto(t.companhia),
    voo: texto(t.voo),
    localizador: texto(t.localizador),
    assento: texto(t.assento),
    custo: Number.isFinite(Number(t.valor)) && Number(t.valor) > 0 ? Number(t.valor) : null,
    status: 'emitida',
    fonte: 'bilhete lido por imagem',
  };
}

/**
 * A chave de uma viagem.
 *
 * Voo mais data identificam o trecho: o mesmo bilhete reenviado não cria uma
 * segunda linha, e é comum reenviar — a captura circula no grupo do gabinete.
 * Sem número de voo, o par origem-destino com a data serve.
 */
export function chaveDaViagem(v) {
  const limpo = (x) => String(x ?? '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (v.voo && v.ida) return `v-${limpo(v.voo)}-${v.ida}`;
  if (v.localizador && v.ida) return `l-${limpo(v.localizador)}-${v.ida}`;
  if (v.ida && (v.origem || v.destino)) {
    return `t-${v.ida}-${limpo(v.origem).slice(0, 16)}-${limpo(v.destino).slice(0, 16)}`;
  }
  return null;
}

/**
 * O compromisso de agenda correspondente ao voo.
 *
 * O deslocamento ocupa o dia: um voo às 6h20 significa que o parlamentar não
 * está disponível na manhã inteira, e é isso que a agenda precisa saber. Sem
 * hora, o compromisso fica no início do dia — que é o pior caso, e o correto:
 * bloqueia mais do que o necessário em vez de prometer disponibilidade que não
 * existe.
 */
export function compromissoDaViagem(v) {
  if (!v.ida) return null;
  const hora = v.horaPartida ? v.horaPartida.padStart(5, '0') : '00:00';
  const trecho = [v.origem, v.destino].filter(Boolean).join(' → ') || 'Deslocamento';

  return {
    titulo: `Voo ${[v.companhia, v.voo].filter(Boolean).join(' ')} · ${trecho}`.trim(),
    inicio: `${v.ida}T${hora}`,
    fim: v.horaChegada ? `${v.ida}T${v.horaChegada.padStart(5, '0')}` : null,
    tipo: 'pessoal',
    local: v.origem || null,
    observacoes: [
      v.localizador ? `Localizador ${v.localizador}` : null,
      v.assento ? `Assento ${v.assento}` : null,
      v.viajante ? `Passageiro: ${v.viajante}` : null,
      !v.horaPartida ? 'Horário não legível no bilhete — confira antes de contar com a manhã livre.' : null,
    ].filter(Boolean).join(' · ') || null,
  };
}

/** Passadas, hoje e futuras — que é como se olha uma lista de voos. */
export function repartirNoTempo(viagens, hoje = new Date().toISOString().slice(0, 10)) {
  const comData = viagens.filter((v) => v.ida);
  return {
    futuras: comData.filter((v) => v.ida > hoje).sort((a, b) => a.ida.localeCompare(b.ida)),
    hoje: comData.filter((v) => v.ida === hoje),
    passadas: comData.filter((v) => v.ida < hoje).sort((a, b) => b.ida.localeCompare(a.ida)),
    semData: viagens.filter((v) => !v.ida),
  };
}
