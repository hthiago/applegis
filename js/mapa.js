/**
 * Mapa municipal desenhado no próprio navegador.
 *
 * Por que assim, e não com uma biblioteca de mapas: o gabinete publica num site
 * estático e o sistema não carrega nada de terceiros — nem mapa de fundo, nem
 * CDN, nem chave de serviço. A malha municipal é dado público do IBGE, o
 * navegador a alcança, e desenhar polígono em SVG não precisa de mais nada.
 * Um mapa de tiles traria dependência externa, rastreamento de quem consulta e
 * uma chave para administrar — em troca de um fundo bonito que a pergunta
 * "quanto foi para esta cidade" não precisa.
 *
 * A malha é grande e não muda: fica guardada no navegador depois da primeira
 * vez. Se o IBGE não responder, quem chama recebe `null` e mostra a distribuição
 * em lista — um mapa que não carrega não pode levar embora a resposta.
 */

const IBGE = 'https://servicodados.ibge.gov.br/api';

/** Código do IBGE de cada UF, que é como a malha é pedida. */
export const CODIGO_UF = {
  RO: 11, AC: 12, AM: 13, RR: 14, PA: 15, AP: 16, TO: 17,
  MA: 21, PI: 22, CE: 23, RN: 24, PB: 25, PE: 26, AL: 27, SE: 28, BA: 29,
  MG: 31, ES: 32, RJ: 33, SP: 35,
  PR: 41, SC: 42, RS: 43,
  MS: 50, MT: 51, GO: 52, DF: 53,
};

const VERSAO_CACHE = 'malha-v1';

export const semAcento = (t) => String(t ?? '')
  .toUpperCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^A-Z0-9 ]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/**
 * A malha de um estado: um polígono por município, com nome e código.
 *
 * Duas chamadas: a geometria e a lista de nomes. A malha identifica o município
 * só pelo código, e um mapa em que passar o mouse mostra "4307005" não responde
 * pergunta nenhuma.
 */
export async function malhaDoEstado(uf) {
  const codigo = CODIGO_UF[String(uf || '').toUpperCase()];
  if (!codigo) return null;

  const chave = `${VERSAO_CACHE}:${codigo}`;
  try {
    const guardada = localStorage.getItem(chave);
    if (guardada) return JSON.parse(guardada);
  } catch { /* cache indisponível não impede buscar */ }

  try {
    const [malha, municipios] = await Promise.all([
      fetch(`${IBGE}/v3/malhas/estados/${codigo}?formato=application/vnd.geo+json&intrarregiao=municipio`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`malha ${r.status}`)))),
      fetch(`${IBGE}/v1/localidades/estados/${codigo}/municipios`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`municípios ${r.status}`)))),
    ]);

    const nomePorCodigo = new Map(municipios.map((m) => [String(m.id), m.nome]));
    const pronta = {
      uf: String(uf).toUpperCase(),
      municipios: (malha.features || []).map((f) => {
        const cod = String(f.properties?.codarea ?? f.properties?.CD_MUN ?? '').trim();
        return {
          codigo: cod,
          nome: nomePorCodigo.get(cod) || cod,
          poligonos: aneis(f.geometry),
        };
      }).filter((m) => m.poligonos.length),
    };

    try { localStorage.setItem(chave, JSON.stringify(pronta)); } catch { /* cheio, tudo bem */ }
    return pronta;
  } catch (erro) {
    // Aviso, não erro: a indisponibilidade do IBGE é prevista e tratada — a
    // tela cai na lista. Registrar como erro faria um caminho que funciona
    // parecer defeito.
    console.warn('malha do IBGE indisponível, a distribuição vai em lista:', erro.message);
    return null;
  }
}

/** Só o contorno externo de cada parte: ilha e lagoa não mudam a resposta. */
function aneis(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates[0]];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.map((p) => p[0]);
  return [];
}

/**
 * A escala de cor.
 *
 * Por faixas e não linear: uma cidade que recebeu dez milhões e cinquenta que
 * receberam quatrocentos mil, numa escala linear, viram uma cidade escura e
 * cinquenta indistinguíveis do zero. As faixas são calculadas sobre os valores
 * que existem, então a comparação é entre os municípios atendidos.
 */
export function faixas(valores) {
  const positivos = valores.filter((v) => v > 0).sort((a, b) => a - b);
  if (!positivos.length) return [];
  const corte = (p) => positivos[Math.min(positivos.length - 1, Math.floor(positivos.length * p))];
  return [...new Set([corte(0.2), corte(0.4), corte(0.6), corte(0.8)])];
}

export const TONS = ['#e8eef2', '#cfe0e8', '#a9c9d8', '#75a7bf', '#3f7c9c'];

export function tomDoValor(valor, cortes) {
  if (!valor) return '#f4f2ee';
  const i = cortes.findIndex((c) => valor <= c);
  return TONS[i === -1 ? TONS.length - 1 : i];
}

/**
 * Desenha a malha e devolve o SVG.
 *
 * `valores` é um mapa de nome normalizado para número; `aoClicar` recebe o nome
 * do município como o IBGE o escreve. A projeção é simples — equiretangular com
 * correção de latitude —, o que basta para um estado: o mapa aqui serve para
 * apontar e clicar, não para medir distância.
 */
export function desenharMalha(malha, { valores = new Map(), aoClicar = () => {}, largura = 720 } = {}) {
  let minLon = Infinity; let maxLon = -Infinity;
  let minLat = Infinity; let maxLat = -Infinity;

  for (const m of malha.municipios) {
    for (const anel of m.poligonos) {
      for (const [lon, lat] of anel) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
  }
  if (!Number.isFinite(minLon)) return null;

  const fatorLon = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180));
  const larguraGeo = (maxLon - minLon) * fatorLon;
  const alturaGeo = maxLat - minLat;
  const escala = largura / larguraGeo;
  const altura = Math.round(alturaGeo * escala);

  const ponto = ([lon, lat]) => [
    ((lon - minLon) * fatorLon * escala).toFixed(1),
    ((maxLat - lat) * escala).toFixed(1),
  ];
  const caminho = (anel) => `M${anel.map(ponto).map(([x, y]) => `${x},${y}`).join('L')}Z`;

  const cortes = faixas([...valores.values()]);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${Math.round(largura)} ${altura}`);
  svg.setAttribute('class', 'mapa');
  svg.setAttribute('role', 'group');
  svg.setAttribute('aria-label', `Municípios de ${malha.uf}`);

  for (const m of malha.municipios) {
    const valor = valores.get(semAcento(m.nome)) || 0;
    const forma = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    forma.setAttribute('d', m.poligonos.map(caminho).join(' '));
    forma.setAttribute('fill', tomDoValor(valor, cortes));
    forma.setAttribute('class', `mapa-municipio${valor ? ' mapa-municipio--com-emenda' : ''}`);
    forma.setAttribute('tabindex', valor ? '0' : '-1');
    forma.setAttribute('role', valor ? 'button' : 'presentation');
    // O título é o que aparece ao passar o mouse. Sem ele, um mapa de manchas
    // não diz nem que cidade é aquela.
    const titulo = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    titulo.textContent = valor
      ? `${m.nome} — ${valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`
      : `${m.nome} — sem emenda registrada`;
    forma.appendChild(titulo);

    if (valor) {
      forma.addEventListener('click', () => aoClicar(m.nome));
      forma.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); aoClicar(m.nome); }
      });
    }
    svg.appendChild(forma);
  }

  return { svg, cortes };
}

/**
 * Minimapa: o estado inteiro em cinza, com uma cidade acesa.
 *
 * Responde a pergunta que ninguém faz em voz alta e todo mundo tem: onde fica
 * isso? Numa ficha que o parlamentar lê no carro, "Noroeste Rio-Grandense" não
 * situa; a mancha no mapa situa em um segundo. Sem rótulo, sem interação e sem
 * cor — é um ícone, não uma ferramenta.
 */
export function desenharMinimapa(malha, nomeDestaque, { largura = 200 } = {}) {
  let minLon = Infinity; let maxLon = -Infinity;
  let minLat = Infinity; let maxLat = -Infinity;
  for (const m of malha.municipios) {
    for (const anel of m.poligonos) {
      for (const [lon, lat] of anel) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
  }
  if (!Number.isFinite(minLon)) return null;

  const fatorLon = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180));
  const escala = largura / ((maxLon - minLon) * fatorLon);
  const altura = Math.round((maxLat - minLat) * escala);
  const ponto = ([lon, lat]) => `${((lon - minLon) * fatorLon * escala).toFixed(1)},${((maxLat - lat) * escala).toFixed(1)}`;
  const caminho = (anel) => `M${anel.map(ponto).join('L')}Z`;

  const alvo = semAcento(nomeDestaque);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${Math.round(largura)} ${altura}`);
  svg.setAttribute('class', 'minimapa');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Localização de ${nomeDestaque} em ${malha.uf}`);

  // O estado inteiro num traço só: um caminho por município deixaria o SVG
  // dez vezes maior sem mudar o que se enxerga num quadrado de dois centímetros.
  const fundo = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  fundo.setAttribute('d', malha.municipios.flatMap((m) => m.poligonos.map(caminho)).join(' '));
  fundo.setAttribute('class', 'minimapa-estado');
  svg.appendChild(fundo);

  const cidade = malha.municipios.find((m) => semAcento(m.nome) === alvo);
  if (cidade) {
    const marca = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    marca.setAttribute('d', cidade.poligonos.map(caminho).join(' '));
    marca.setAttribute('class', 'minimapa-cidade');
    svg.appendChild(marca);
  }
  return { svg, achou: !!cidade };
}
