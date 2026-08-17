import { el, limpar, carregando, fmtDinheiro, fmtDinheiroCurto, etiqueta, aviso } from './ui.js';
import { listar } from './dados.js';
import { consolidarPorMunicipio, situacaoDoLugar, detalhesDeUmLugar } from './paineis.js';
import { semAcento, CODIGO_UF } from './mapa.js';

/**
 * Ficha de apresentação de um município.
 *
 * Para que serve, concretamente: o deputado vai a Erechim na quinta. Alguém tem
 * de montar, na quarta, uma folha com o que o mandato fez ali, quem são os
 * interlocutores, o tamanho da cidade e o que está travado. Hoje isso é feito à
 * mão, abrindo quatro sistemas — e é sempre a mesma folha, com os mesmos campos.
 *
 * O que a ficha reúne, e de onde:
 *
 *   - Emendas e execução: do que o gabinete já importou. É a parte que
 *     interessa politicamente — quanto foi, para quê, e o que travou.
 *   - Retrato da cidade: população, área e região, do IBGE. Dá escala ao número
 *     da emenda: um milhão em Aceguá não é um milhão em Porto Alegre.
 *   - Interlocutores: os contatos do gabinete naquele município, que é quem se
 *     liga antes de viajar.
 *
 * O que ela deliberadamente NÃO faz: inventar leitura política. Nada aqui é
 * gerado por texto livre. Cada linha da ficha tem fonte, e o que não veio de
 * fonte alguma aparece como lacuna — porque uma ficha que preenche buraco com
 * suposição é pior que uma ficha incompleta quando alguém a leva para uma
 * reunião.
 */

const IBGE = 'https://servicodados.ibge.gov.br/api/v1/localidades';

/** O retrato do município no IBGE: escala para ler o valor da emenda. */
export async function retratoDoMunicipio(nome, uf) {
  const codigo = CODIGO_UF[String(uf || '').toUpperCase()];
  if (!codigo || !nome) return null;

  try {
    const lista = await fetch(`${IBGE}/estados/${codigo}/municipios`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))));
    const achado = lista.find((m) => semAcento(m.nome) === semAcento(nome));
    if (!achado) return null;

    // A população vem de outra base e pode não responder; a ficha continua útil
    // sem ela, então a falha aqui não derruba o resto.
    let populacao = null;
    try {
      const r = await fetch(`https://servicodados.ibge.gov.br/api/v3/agregados/6579/periodos/-1/variaveis/9345?localidades=N6[${achado.id}]`);
      if (r.ok) {
        const dados = await r.json();
        const serie = dados?.[0]?.resultados?.[0]?.series?.[0]?.serie || {};
        const ultimo = Object.entries(serie).sort()[Object.keys(serie).length - 1];
        populacao = ultimo ? Number(ultimo[1]) || null : null;
      }
    } catch { /* segue sem população */ }

    return {
      nome: achado.nome,
      codigo: String(achado.id),
      uf: achado.microrregiao?.mesorregiao?.UF?.sigla || String(uf).toUpperCase(),
      microrregiao: achado.microrregiao?.nome || null,
      mesorregiao: achado.microrregiao?.mesorregiao?.nome || null,
      regiaoImediata: achado['regiao-imediata']?.nome || null,
      populacao,
    };
  } catch (erro) {
    console.warn('IBGE indisponível para o retrato do município:', erro.message);
    return null;
  }
}

/** Os nomes de município que a base do gabinete conhece, para sugerir. */
export function municipiosConhecidos(lugares) {
  return lugares
    .map((l) => l.municipio)
    .filter((n) => n && !/^A detalhar/.test(n) && !/^Sem munic/.test(n))
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

/** Contatos do gabinete naquele município — quem se liga antes de viajar. */
export function contatosDoMunicipio(contatos, nome) {
  const alvo = semAcento(nome);
  return contatos.filter((c) => semAcento(c.municipio || c.cidade || '') === alvo);
}

/**
 * O que está travado, em uma lista.
 *
 * É o primeiro assunto de qualquer visita: a prefeitura vai perguntar. Trazê-lo
 * no topo evita a cena de o parlamentar descobrir o impedimento na frente do
 * prefeito.
 */
export function travas(lugar) {
  const vistas = new Set();
  const saida = [];
  for (const d of lugar?.destinos || []) {
    const texto = d.situacao;
    if (!texto || !/impedi|indefer|cancelad|devolvid/i.test(texto)) continue;
    if (vistas.has(texto)) continue;
    vistas.add(texto);
    saida.push({ emenda: d.codigoEmenda || null, texto });
  }
  return saida;
}

export async function painelFicha(container) {
  limpar(container).appendChild(carregando());

  const { sessao } = await import('./sessao.js');
  const [emendas, transferencias, contatos] = await Promise.all([
    listar('emendas', { recarregar: true }),
    listar('transferencias', { recarregar: true }).catch(() => []),
    listar('contatos', { recarregar: true }).catch(() => []),
  ]);

  const lugares = consolidarPorMunicipio(emendas, transferencias);
  const conhecidos = municipiosConhecidos(lugares);
  const uf = sessao.gabinete?.uf || null;

  limpar(container);
  container.appendChild(el('header', { class: 'modulo-topo' }, [
    el('div', { class: 'modulo-titulo' }, [
      el('h1', { texto: 'Ficha de apresentação' }),
      el('p', { texto: 'O município em uma folha: o que o mandato fez ali, o que está travado, quem são os interlocutores e o tamanho da cidade.' }),
    ]),
  ]));

  const entrada = el('input', {
    type: 'text',
    class: 'busca',
    list: 'municipios-conhecidos',
    placeholder: 'Digite o município e pressione Enter',
    'aria-label': 'Município',
  });
  const lista = el('datalist', { id: 'municipios-conhecidos' },
    conhecidos.map((n) => el('option', { value: n })));

  const folha = el('section', { class: 'ficha' });

  const montar = async (nome) => {
    if (!nome) return;
    limpar(folha).appendChild(carregando());

    const lugar = lugares.find((l) => semAcento(l.municipio) === semAcento(nome)) || null;
    const retrato = await retratoDoMunicipio(nome, uf);
    const daCidade = contatosDoMunicipio(contatos, nome);
    const travadas = travas(lugar);

    limpar(folha);
    folha.appendChild(el('header', { class: 'ficha-topo' }, [
      el('h2', { texto: retrato?.nome || nome }),
      retrato?.uf ? etiqueta(retrato.uf, 'neutro') : null,
      lugar ? etiqueta(situacaoDoLugar(lugar).texto, situacaoDoLugar(lugar).cor) : null,
    ].filter(Boolean)));

    // ── retrato ──
    const retratoItens = [
      retrato?.populacao ? ['População', retrato.populacao.toLocaleString('pt-BR')] : null,
      retrato?.regiaoImediata ? ['Região imediata', retrato.regiaoImediata] : null,
      retrato?.microrregiao ? ['Microrregião', retrato.microrregiao] : null,
      retrato?.mesorregiao ? ['Mesorregião', retrato.mesorregiao] : null,
      retrato?.codigo ? ['Código IBGE', retrato.codigo] : null,
    ].filter(Boolean);

    folha.appendChild(el('div', { class: 'ficha-secao' }, [
      el('h3', { texto: 'Retrato' }),
      retratoItens.length
        ? el('dl', { class: 'ficha-dados' }, retratoItens.flatMap(([r, v]) => [
          el('dt', { texto: r }), el('dd', { texto: v }),
        ]))
        // Lacuna dita é lacuna: melhor que um campo vazio que parece defeito.
        : el('p', { class: 'campo-dica', texto: uf
          ? 'O IBGE não respondeu agora — o retrato da cidade fica de fora desta folha.'
          : 'Informe a UF do gabinete em Acessos → Dados do gabinete para trazer o retrato da cidade.' }),
    ]));

    // ── o que o mandato fez ──
    if (lugar) {
      const porHabitante = retrato?.populacao
        ? (lugar.destinado || lugar.empenhado || lugar.pago) / retrato.populacao
        : null;

      folha.appendChild(el('div', { class: 'ficha-secao' }, [
        el('h3', { texto: 'Emendas do mandato' }),
        el('div', { class: 'indicadores indicadores--compactos' }, [
          indicadorSimples('Emendas', String(lugar.emendas.length)),
          indicadorSimples('Destinado', fmtDinheiroCurto(lugar.destinado || 0)),
          indicadorSimples('Empenhado', fmtDinheiroCurto(lugar.empenhado || 0)),
          indicadorSimples('Pago', fmtDinheiroCurto(lugar.pago || 0)),
          // O valor por habitante é o que torna comparável o incomparável: um
          // milhão em Aceguá e um milhão em Porto Alegre não são a mesma coisa.
          porHabitante ? indicadorSimples('Por habitante', fmtDinheiro(porHabitante)) : null,
        ].filter(Boolean)),
        detalhesDeUmLugar(lugar),
      ]));
    } else {
      folha.appendChild(el('div', { class: 'ficha-secao' }, [
        el('h3', { texto: 'Emendas do mandato' }),
        el('p', { class: 'campo-dica', texto: 'Nenhuma emenda registrada para este município no que já foi importado. Se houver, rode "Consultar Portal" e "Detalhar emendas" na aba Emendas.' }),
      ]));
    }

    // ── o que está travado ──
    if (travadas.length) {
      folha.appendChild(el('div', { class: 'ficha-secao ficha-secao--alerta' }, [
        el('h3', { texto: 'Pendências a explicar' }),
        el('p', { class: 'campo-dica', texto: 'A prefeitura vai perguntar sobre isto.' }),
        el('ul', {}, travadas.map((t) => el('li', {}, [
          t.emenda ? el('strong', { texto: `${t.emenda}: ` }) : null,
          el('span', { texto: t.texto }),
        ].filter(Boolean)))),
      ]));
    }

    // ── interlocutores ──
    folha.appendChild(el('div', { class: 'ficha-secao' }, [
      el('h3', { texto: 'Interlocutores no município' }),
      daCidade.length
        ? el('ul', { class: 'ficha-contatos' }, daCidade.map((c) => el('li', {}, [
          el('strong', { texto: c.nome || '—' }),
          c.cargo || c.papel ? el('span', { texto: ` · ${c.cargo || c.papel}` }) : null,
          c.telefone ? el('span', { class: 'topo-sub', texto: c.telefone }) : null,
          c.email ? el('span', { class: 'topo-sub', texto: c.email }) : null,
        ].filter(Boolean))))
        : el('p', { class: 'campo-dica', texto: 'Nenhum contato deste município cadastrado em Contatos (CRM).' }),
    ]));

    folha.appendChild(el('p', { class: 'ficha-rodape', texto: `Ficha gerada em ${new Date().toLocaleDateString('pt-BR')} a partir do que está importado no sistema, do IBGE e do CRM do gabinete. Nada aqui é estimado.` }));
  };

  const botao = el('button', {
    class: 'btn btn--primario',
    type: 'button',
    texto: 'Gerar ficha',
    onclick: () => montar(entrada.value.trim()),
  });
  entrada.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); montar(entrada.value.trim()); }
  });

  const imprimir = el('button', {
    class: 'btn btn--fantasma',
    type: 'button',
    texto: 'Imprimir',
    title: 'A ficha é feita para ser levada em papel a uma reunião',
    onclick: () => {
      if (!folha.textContent.trim()) { aviso('Gere a ficha antes de imprimir.', 'erro'); return; }
      window.print();
    },
  });

  container.appendChild(el('div', { class: 'modulo-acoes' }, [entrada, lista, botao, imprimir]));
  container.appendChild(folha);

  if (conhecidos.length) {
    entrada.value = conhecidos[0];
    await montar(conhecidos[0]);
  } else {
    folha.appendChild(el('p', { class: 'bloco-vazio', texto: 'Nenhum município conhecido ainda. Importe as emendas primeiro.' }));
  }
}

function indicadorSimples(rotulo, valor) {
  return el('div', { class: 'indicador' }, [
    el('span', { class: 'indicador-rotulo', texto: rotulo }),
    el('strong', { class: 'indicador-valor', texto: valor }),
  ]);
}
