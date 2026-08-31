import { el, limpar, carregando, fmtDinheiro, fmtDinheiroCurto, etiqueta, aviso, modal } from './ui.js';
import { listar } from './dados.js';
import { semAcento, CODIGO_UF, malhaDoEstado, desenharMinimapa } from './mapa.js';
import { chaveDoMunicipio } from './tse.js';
import { telefonePadrao, telefoneVisivel } from './crm.js';
import { consolidarDestinacoes } from './destinacoes.js';

/**
 * Ficha de apresentação de um município.
 *
 * Para que serve, concretamente: o deputado vai a Erechim na quinta. Alguém tem
 * de montar, na quarta, uma folha com quem governa a cidade, como foi a votação,
 * o tamanho do lugar e o que move a economia. Hoje isso é feito à mão, abrindo
 * quatro sistemas — e é sempre a mesma folha, com os mesmos campos.
 *
 * O que a ficha reúne, e de onde:
 *
 *   - O que o mandato destinou: das destinações de emenda, em Orçamento. É a
 *     parte que interessa politicamente — quanto foi, para quê, e se saiu.
 *   - Retrato da cidade: população e região, do IBGE.
 *   - Política local: prefeito, vice, presidente da Câmara e vereadores
 *     aliados, do cadastro de Municípios. Isso nenhuma API entrega.
 *   - Votação: do arquivo do TSE, importado em Municípios. Diz se aquele é um
 *     reduto ou um lugar a conquistar, que muda a conversa inteira.
 *   - Interlocutores: os contatos do gabinete naquele município, que é quem se
 *     liga antes de viajar.
 *
 * Para onde ela vai: tela, papel e mensagem de WhatsApp, todos da mesma fonte.
 * O envio é restrito ao parlamentar e à equipe — a ficha traz a leitura interna
 * do gabinete, e não é material de divulgação.
 *
 * O que ela deliberadamente NÃO faz: inventar leitura política. Nada aqui é
 * gerado por texto livre. Cada linha da ficha tem fonte, e o que não veio de
 * fonte alguma aparece como lacuna — porque uma ficha que preenche buraco com
 * suposição é pior que uma ficha incompleta quando alguém a leva para uma
 * reunião.
 */

const IBGE = 'https://servicodados.ibge.gov.br/api/v1/localidades';

/** O retrato do município no IBGE: o tamanho da cidade, em números. */
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
      // O código do IBGE segue sendo lido — é a chave de busca da malha e da
      // população —, mas não aparece na folha: quem leva a ficha para uma
      // reunião não tem o que fazer com ele.
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
export function municipiosConhecidos(cadastros = []) {
  const nomes = new Map();
  for (const c of cadastros) {
    if (!c?.nome) continue;
    const chave = semAcento(c.nome);
    if (!nomes.has(chave)) nomes.set(chave, c.nome);
  }
  return [...nomes.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

/** Contatos do gabinete naquele município — quem se liga antes de viajar. */
export function contatosDoMunicipio(contatos, nome) {
  const alvo = semAcento(nome);
  return contatos.filter((c) => semAcento(c.municipio || c.cidade || '') === alvo);
}

/** Acha o cadastro do município pela chave, e por nome quando a chave não bate. */
export function cadastroDoMunicipio(cadastros, nome, uf) {
  const chave = chaveDoMunicipio(nome, uf);
  const alvo = semAcento(nome);
  return cadastros.find((c) => c.id === chave)
    || cadastros.find((c) => semAcento(c.nome) === alvo
      && (!uf || !c.uf || String(c.uf).toUpperCase() === String(uf).toUpperCase()))
    || null;
}

const numero = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);

/**
 * A votação do parlamentar naquela cidade, pronta para leitura.
 *
 * O percentual é recalculado aqui em vez de guardado: votos e votos válidos
 * podem ser corrigidos à mão no cadastro, e um percentual gravado sobreviveria à
 * correção contando outra história.
 */
export function votacaoDoMunicipio(cadastro) {
  const votos = numero(cadastro?.votosParlamentar);
  if (!votos) return null;
  const validos = numero(cadastro?.votosValidos);
  return {
    votos,
    validos,
    colocacao: numero(cadastro?.colocacao),
    ano: numero(cadastro?.anoEleicao),
    percentual: validos ? (votos / validos) * 100 : null,
  };
}

/**
 * Renda, produção e o que importa — em poucas linhas.
 *
 * O parlamentar lê isto no carro, a caminho. Por isso é frase curta e não
 * relatório; e por isso cada frase sai de um campo preenchido, nunca de texto
 * gerado. Sem campo preenchido a seção diz que falta, e diz onde preencher.
 */
export function resumoEconomico(cadastro, retrato) {
  const linhas = [];
  const populacao = numero(retrato?.populacao) ?? numero(cadastro?.populacao);
  const renda = numero(cadastro?.rendaMedia);
  const pib = numero(cadastro?.pibPerCapita);

  if (populacao) {
    const porte = populacao < 5000 ? 'município de pequeno porte'
      : populacao < 20000 ? 'município de porte médio-pequeno'
        : populacao < 100000 ? 'município de porte médio' : 'município de grande porte';
    linhas.push(`${populacao.toLocaleString('pt-BR')} habitantes — ${porte}.`);
  }
  if (renda) linhas.push(`Renda média mensal de ${fmtDinheiro(renda)}.`);
  if (pib) linhas.push(`PIB per capita de ${fmtDinheiro(pib)}.`);
  if (cadastro?.atividades) linhas.push(`Economia movida por ${String(cadastro.atividades).replace(/\.$/, '')}.`);

  return {
    linhas,
    // O texto do gabinete vem inteiro e separado: é a leitura de quem conhece a
    // cidade, e resumi-la seria justamente perder o que ela tem de melhor.
    doGabinete: cadastro?.resumo || null,
    fonte: cadastro?.fonteEconomia || null,
    vazio: !linhas.length && !cadastro?.resumo,
  };
}

/**
 * A ficha inteira em um objeto, antes de virar tela.
 *
 * Existe separada da renderização porque é ela que vira papel e vira mensagem
 * de WhatsApp. Três saídas, uma fonte — do contrário a folha impressa e a
 * mensagem enviada divergem, e ninguém percebe qual das duas está velha.
 */
export function dadosDaFicha({ nome, uf, retrato, cadastro, contatos }) {
  const populacao = numero(retrato?.populacao) ?? numero(cadastro?.populacao);
  return {
    nome: retrato?.nome || cadastro?.nome || nome,
    uf: retrato?.uf || cadastro?.uf || uf || null,
    populacao,
    populacaoFonte: numero(retrato?.populacao) ? 'IBGE' : (numero(cadastro?.populacao) ? 'cadastro do gabinete' : null),
    regiao: retrato?.regiaoImediata || retrato?.microrregiao || null,
    mesorregiao: retrato?.mesorregiao || null,
    prefeito: cadastro?.prefeito || null,
    partidoPrefeito: cadastro?.partidoPrefeito || null,
    vicePrefeito: cadastro?.vicePrefeito || null,
    presidenteCamara: cadastro?.presidenteCamara || null,
    vereadores: [].concat(cadastro?.vereadores || []).filter(Boolean),
    fonteGoverno: cadastro?.fonteGoverno || null,
    governoConfirmado: !!cadastro?.governoConfirmado,
    votacao: votacaoDoMunicipio(cadastro),
    economia: resumoEconomico(cadastro, retrato),
    contatos,
  };
}

/**
 * A ficha como texto puro, para mandar por mensagem.
 *
 * Enxuta de propósito: no WhatsApp ninguém rola quinze parágrafos. Vai o que se
 * responde numa conversa de porta de prefeitura — tamanho, quem governa,
 * votação, quanto foi e o que travou.
 */
export function textoDaFicha(f, { gabinete = null } = {}) {
  const l = [];
  l.push(`*${f.nome}${f.uf ? `/${f.uf}` : ''}*`);
  if (f.populacao) l.push(`${f.populacao.toLocaleString('pt-BR')} habitantes${f.regiao ? ` · ${f.regiao}` : ''}`);

  if (f.prefeito) {
    l.push('', `*${f.governoConfirmado ? 'Prefeito' : 'Prefeito eleito'}*: ${f.prefeito}${f.partidoPrefeito ? ` (${f.partidoPrefeito})` : ''}`);
    if (f.presidenteCamara) l.push(`Presidente da Câmara: ${f.presidenteCamara}`);
  }
  if (f.vereadores.length) l.push(`Vereadores aliados: ${f.vereadores.join(', ')}`);

  if (f.votacao) {
    const partes = [`${f.votacao.votos.toLocaleString('pt-BR')} votos`];
    if (f.votacao.percentual != null) partes.push(`${f.votacao.percentual.toFixed(1)}%`);
    if (f.votacao.colocacao) partes.push(`${f.votacao.colocacao}º lugar`);
    l.push('', `*Votação${f.votacao.ano ? ` ${f.votacao.ano}` : ''}*: ${partes.join(' · ')}`);
  }

  if (f.economia.linhas.length || f.economia.doGabinete) {
    l.push('', '*Economia*');
    f.economia.linhas.forEach((t) => l.push(`• ${t}`));
    if (f.economia.doGabinete) l.push(f.economia.doGabinete);
  }

  l.push('', `Ficha gerada em ${new Date().toLocaleDateString('pt-BR')}${gabinete?.nome ? ` — ${gabinete.nome}` : ''}.`);
  return l.join('\n');
}

/**
 * O endereço do WhatsApp.
 *
 * `wa.me` é o link oficial e funciona hoje, no celular e no desktop, sem chave,
 * sem cadastro e sem custo — que é o que o gabinete precisa nesta semana. Quando
 * a API oficial for definida, é esta função que muda: o resto da ficha não sabe
 * como a mensagem sai daqui.
 *
 * Sem número, o link abre o seletor de contatos do próprio WhatsApp — útil para
 * mandar a alguém que não está no CRM.
 */
export function linkDoWhatsapp(telefone, texto) {
  const d = String(telefone ?? '').replace(/\D/g, '');
  const numeroCompleto = !d ? '' : (d.length <= 11 ? `55${d}` : d);
  return `https://wa.me/${numeroCompleto}?text=${encodeURIComponent(texto)}`;
}

/**
 * Para quem se pode mandar a ficha: o parlamentar e a equipe. Mais ninguém.
 *
 * A ficha não é material de divulgação. Ela traz o que está impedido, o que a
 * prefeitura vai cobrar e a leitura que o gabinete faz da cidade — coisas que
 * se dizem dentro do gabinete e não se mandam para o prefeito sobre quem foram
 * escritas. Um seletor com trezentos contatos do CRM transformaria um toque
 * errado num vazamento, e é por isso que o CRM não entra aqui.
 *
 * Sem número cadastrado a pessoa não aparece: um envio "sem destinatário" cairia
 * no seletor de contatos do próprio WhatsApp, que é justamente a porta que esta
 * lista existe para fechar.
 *
 * O parlamentar vem primeiro e sempre: a ficha é feita para ele, e obrigá-lo a
 * procurar o próprio nome no meio da lista seria uma piada de mau gosto com quem
 * usa isto às sete da manhã.
 */
export function destinatariosPossiveis({ gabinete, equipe = [] }) {
  const lista = [];
  const visto = new Set();
  const juntar = (nome, telefone, grupo, cargo = null) => {
    const tel = telefonePadrao(telefone);
    if (!nome || !tel) return;
    if (visto.has(tel)) return;
    visto.add(tel);
    lista.push({ nome, telefone: tel, grupo, cargo });
  };

  juntar(gabinete?.deputado || 'Parlamentar', gabinete?.whatsappParlamentar, 'Parlamentar');

  for (const p of equipe) {
    // Quem saiu do gabinete não recebe documento interno do gabinete.
    if (p?.situacao && p.situacao !== 'ativo') continue;
    juntar(p?.nome, p?.telefone, 'Equipe do gabinete', p?.cargo || null);
  }

  const ordem = { Parlamentar: 0, 'Equipe do gabinete': 1 };
  return lista.sort((a, b) => (ordem[a.grupo] - ordem[b.grupo])
    || a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** A janela de envio: escolher a quem, conferir o texto e abrir o WhatsApp. */
function abrirEnvio(ficha, destinatarios, gabinete) {
  const form = el('form', { class: 'form' });

  // Ninguém com número cadastrado: dizer onde se cadastra é a única resposta
  // útil. Oferecer um campo de número livre aqui abriria de novo a porta que
  // esta tela fecha.
  if (!destinatarios.length) {
    const fechar = modal(`Enviar a ficha de ${ficha.nome}`, form);
    form.append(
      el('p', { texto: 'A ficha só é enviada ao parlamentar e à equipe do gabinete, e ninguém tem número de WhatsApp cadastrado ainda.' }),
      el('ul', {}, [
        el('li', { texto: 'O número do parlamentar fica em Acessos → Dados do gabinete.' }),
        el('li', {}, [
          el('span', { texto: 'O da equipe, no cadastro de ' }),
          el('a', { href: '#/administrativo/equipe', texto: 'Equipe' }),
          el('span', { texto: '.' }),
        ]),
      ]),
      el('div', { class: 'modal-acoes' }, [
        el('button', { class: 'btn btn--primario', type: 'button', texto: 'Entendi', onclick: () => fechar() }),
      ]),
    );
    return;
  }

  const escolha = el('select', {});
  const grupos = new Map();
  destinatarios.forEach((d, i) => {
    if (!grupos.has(d.grupo)) {
      const g = el('optgroup', { label: d.grupo });
      grupos.set(d.grupo, g);
      escolha.appendChild(g);
    }
    grupos.get(d.grupo).appendChild(el('option', {
      value: String(i),
      texto: `${d.nome}${d.cargo ? ` (${d.cargo})` : ''} — ${telefoneVisivel(d.telefone)}`,
    }));
  });

  const corpo = el('textarea', { rows: '12', class: 'ficha-mensagem' });
  corpo.value = textoDaFicha(ficha, { gabinete });

  form.append(
    el('div', { class: 'campo' }, [
      el('label', { texto: 'Enviar para' }),
      escolha,
      el('p', {
        class: 'campo-dica',
        // Dito na tela porque a pergunta aparece na primeira vez que se usa, e
        // porque a restrição precisa ter um motivo visível para não parecer
        // limitação do sistema.
        texto: 'Só o parlamentar e a equipe do gabinete: a ficha traz pendências e leitura interna, que não são material de divulgação. A equipe sai do cadastro de Equipe; o número do parlamentar, de Acessos → Dados do gabinete.',
      }),
    ]),
    el('div', { class: 'campo' }, [
      el('label', { texto: 'Mensagem' }),
      corpo,
      el('p', { class: 'campo-dica', texto: 'Abre o WhatsApp com a mensagem pronta — você confere e envia. Pode editar antes.' }),
    ]),
  );

  const btn = el('button', { class: 'btn btn--primario', type: 'submit', texto: 'Abrir no WhatsApp' });
  const fechar = modal(`Enviar a ficha de ${ficha.nome}`, form);
  form.appendChild(el('div', { class: 'modal-acoes' }, [
    el('button', { class: 'btn btn--fantasma', type: 'button', texto: 'Cancelar', onclick: () => fechar() }),
    btn,
  ]));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const alvo = destinatarios[Number(escolha.value)];
    if (!alvo?.telefone) { aviso('Escolha quem vai receber a ficha.', 'erro'); return; }
    window.open(linkDoWhatsapp(alvo.telefone, corpo.value), '_blank', 'noopener');
    fechar();
  });
}

export async function painelFicha(container) {
  limpar(container).appendChild(carregando());

  const { sessao } = await import('./sessao.js');
  const [contatos, cadastros, equipe, destinacoes] = await Promise.all([
    listar('contatos', { recarregar: true }).catch(() => []),
    listar('municipios', { recarregar: true }).catch(() => []),
    // Só para o envio: é a equipe, e não o CRM, que pode receber a ficha.
    listar('equipe', { recarregar: true }).catch(() => []),
    // O que o mandato destinou àquela cidade — a área de Orçamento é a fonte,
    // e a ficha só mostra. Sem ela a folha vira um retrato sem o essencial.
    listar('destinacoes', { recarregar: true }).catch(() => []),
  ]);
  const cidades = consolidarDestinacoes(destinacoes);

  const conhecidos = municipiosConhecidos(cadastros);
  const uf = sessao.gabinete?.uf || null;

  limpar(container);
  container.appendChild(el('header', { class: 'modulo-topo' }, [
    el('div', { class: 'modulo-titulo' }, [
      el('h1', { texto: 'Ficha de apresentação' }),
      el('p', { texto: 'O município em uma folha: o tamanho da cidade, quem governa, como foi a votação, o que o mandato fez ali e o que está travado. Feita para ser impressa ou mandada ao parlamentar.' }),
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
  let atual = null;

  const montar = async (nome) => {
    if (!nome) return;
    atual = null;
    limpar(folha).appendChild(carregando());

    const cadastro = cadastroDoMunicipio(cadastros, nome, uf);
    const retrato = await retratoDoMunicipio(nome, cadastro?.uf || uf);
    const daCidade = contatosDoMunicipio(contatos, nome);

    const f = dadosDaFicha({ nome, uf, retrato, cadastro, contatos: daCidade });
    atual = f;

    limpar(folha);

    // ── cabeçalho da folha ──
    // O nome do gabinete só aparece aqui porque a folha sai da tela e vira
    // papel na mão de outra pessoa, que precisa saber de onde ela veio.
    const identificacao = el('div', { class: 'ficha-identificacao' }, [
      el('div', { class: 'ficha-topo' }, [
        el('h2', { texto: f.nome }),
        f.uf ? etiqueta(f.uf, 'neutro') : null,
      ].filter(Boolean)),
      el('p', { class: 'ficha-origem', texto: [sessao.gabinete?.nome, sessao.gabinete?.deputado].filter(Boolean).join(' · ') }),
    ]);

    const caixaMapa = el('div', { class: 'ficha-minimapa' });
    folha.appendChild(el('header', { class: 'ficha-cabecalho' }, [identificacao, caixaMapa]));
    desenharLocalizacao(caixaMapa, f);

    // ── retrato ──
    const retratoItens = [
      f.populacao ? ['População', `${f.populacao.toLocaleString('pt-BR')} hab.`] : null,
      f.regiao ? ['Região', f.regiao] : null,
      f.mesorregiao ? ['Mesorregião', f.mesorregiao] : null,
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

    // ── quem governa ──
    // "Prefeito eleito" e não "prefeito": o TSE publica quem ganhou a eleição,
    // e entre a eleição e a visita cabem renúncia, cassação e o vice assumindo.
    // Chamar o eleito de prefeito numa folha que vai para a mão do parlamentar
    // é o tipo de precisão que se descobre que faltava na frente do interessado.
    const rotuloPrefeito = f.governoConfirmado ? 'Prefeito' : 'Prefeito eleito';
    const politicos = [
      f.prefeito ? [rotuloPrefeito, f.prefeito + (f.partidoPrefeito ? ` (${f.partidoPrefeito})` : '')] : null,
      f.vicePrefeito ? ['Vice-prefeito', f.vicePrefeito] : null,
      f.presidenteCamara ? ['Presidente da Câmara', f.presidenteCamara] : null,
    ].filter(Boolean);

    folha.appendChild(el('div', { class: 'ficha-secao' }, [
      el('h3', { texto: 'Quem governa a cidade' }),
      politicos.length
        ? el('dl', { class: 'ficha-dados' }, politicos.flatMap(([r, v]) => [
          el('dt', { texto: r }), el('dd', { texto: v }),
        ]))
        : el('p', { class: 'campo-dica', texto: 'Prefeito e Câmara ainda não cadastrados. Em Municípios, use "Importar candidaturas (TSE)" — o arquivo da eleição municipal traz prefeito, vice e os vereadores do partido para o estado inteiro de uma vez.' }),
      f.vereadores.length
        ? el('div', { class: 'ficha-vereadores' }, [
          el('h4', { texto: 'Vereadores aliados' }),
          el('div', { class: 'etiquetas' }, f.vereadores.map((v) => etiqueta(v, 'neutro'))),
        ])
        : null,
      // O presidente da Câmara é eleito pelos pares, em sessão que o TSE não
      // registra: é a única linha desta seção que continua sendo de quem
      // conhece a cidade. Dizer isso evita procurar defeito onde não há.
      f.prefeito && !f.presidenteCamara
        ? el('p', { class: 'campo-dica', texto: 'O presidente da Câmara não vem do TSE — é eleito pelos vereadores. Preencha em Municípios.' })
        : null,
      // Não existe base pública que diga quem está sentado na cadeira hoje. O
      // que dá para fazer é não afirmar mais do que se sabe, e mostrar onde
      // quem sabe registra o que conferiu.
      f.prefeito && !f.governoConfirmado
        ? el('p', { class: 'campo-dica', texto: 'Quem tomou posse pode não ser quem está no cargo: cabe renúncia, cassação e o vice assumindo. Conferido? Marque "Confirmado pelo gabinete" em Municípios — a partir daí a importação do TSE não mexe mais nestes nomes.' })
        : null,
      f.fonteGoverno
        ? el('p', { class: 'ficha-fonte', texto: f.governoConfirmado ? `${f.fonteGoverno} · confirmado pelo gabinete` : f.fonteGoverno })
        : null,
    ].filter(Boolean)));

    // ── votação ──
    if (f.votacao) {
      folha.appendChild(el('div', { class: 'ficha-secao' }, [
        el('h3', { texto: `Votação do parlamentar${f.votacao.ano ? ` em ${f.votacao.ano}` : ''}` }),
        el('div', { class: 'indicadores indicadores--compactos' }, [
          indicadorSimples('Votos', f.votacao.votos.toLocaleString('pt-BR')),
          f.votacao.percentual != null ? indicadorSimples('Dos válidos', `${f.votacao.percentual.toFixed(1)}%`) : null,
          f.votacao.colocacao ? indicadorSimples('Colocação', `${f.votacao.colocacao}º`) : null,
          f.votacao.validos ? indicadorSimples('Votos válidos', f.votacao.validos.toLocaleString('pt-BR')) : null,
        ].filter(Boolean)),
        el('p', { class: 'campo-dica', texto: 'Fonte: dados abertos eleitorais do TSE.' }),
      ]));
    } else {
      folha.appendChild(el('div', { class: 'ficha-secao' }, [
        el('h3', { texto: 'Votação do parlamentar' }),
        el('p', { class: 'campo-dica', texto: 'Sem votação importada para esta cidade. Em Municípios, use "Importar votação (TSE)" com o arquivo de votação por município.' }),
      ]));
    }

    // ── economia ──
    folha.appendChild(el('div', { class: 'ficha-secao' }, [
      el('h3', { texto: 'Renda, produção e o que importa' }),
      f.economia.vazio
        ? el('p', { class: 'campo-dica', texto: 'Nada preenchido ainda. Em Municípios, "Atualizar economia (IBGE)" traz PIB per capita, renda e de onde vem a produção de todas as cidades cadastradas. "O que importa nesta cidade" continua sendo do gabinete — é a leitura que o parlamentar lê a caminho.' })
        : el('div', {}, [
          f.economia.linhas.length
            ? el('ul', { class: 'ficha-resumo' }, f.economia.linhas.map((t) => el('li', { texto: t })))
            : null,
          f.economia.doGabinete
            ? el('p', { class: 'ficha-resumo-texto', texto: f.economia.doGabinete })
            : null,
          f.economia.fonte ? el('p', { class: 'ficha-fonte', texto: f.economia.fonte }) : null,
        ].filter(Boolean)),
    ]));

    // ── o que o mandato destinou ──
    const cidade = cidades.find((c) => semAcento(c.municipio) === semAcento(nome)) || null;
    folha.appendChild(el('div', { class: 'ficha-secao' }, [
      el('h3', { texto: 'Emendas do mandato' }),
      cidade
        ? el('div', {}, [
          el('div', { class: 'indicadores indicadores--compactos' }, [
            indicadorSimples('Destinações', String(cidade.destinacoes.length)),
            indicadorSimples('Destinado', fmtDinheiroCurto(cidade.destinado)),
            cidade.empenhado ? indicadorSimples('Empenhado', fmtDinheiroCurto(cidade.empenhado)) : null,
            cidade.pago ? indicadorSimples('Pago', fmtDinheiroCurto(cidade.pago)) : null,
            // Um milhão em Aceguá não é um milhão em Porto Alegre.
            f.populacao ? indicadorSimples('Por habitante', fmtDinheiro(cidade.destinado / f.populacao)) : null,
          ].filter(Boolean)),
          el('ul', { class: 'ficha-resumo' }, cidade.destinacoes.slice(0, 12).map((d) => el('li', {}, [
            el('strong', { texto: d.beneficiario || d.instituicao || 'sem beneficiário' }),
            el('span', { texto: ` — ${d.objeto || 'objeto não informado'}` }),
            el('span', { class: 'topo-sub', texto: [d.ano, d.valorDestinado ? fmtDinheiro(d.valorDestinado) : null, ROTULOS_SITUACAO[d.situacao]].filter(Boolean).join(' · ') }),
          ]))),
          // A ficha é o retrato da cidade; a folha é o papel das emendas dela.
          // Quem está preparando a visita quer as duas, e uma manda para a
          // outra em vez de repetir o que a outra faz melhor.
          el('p', { class: 'campo-dica' }, [
            cidade.destinacoes.length > 12
              ? el('span', { texto: `e mais ${cidade.destinacoes.length - 12} destinações. ` })
              : null,
            el('a', {
              href: `#/orcamento/folha/${encodeURIComponent(cidade.municipio)}`,
              texto: 'Folha das emendas desta cidade, inteira, para levar à visita',
            }),
          ].filter(Boolean)),
          cidade.divergentes
            ? el('p', { class: 'campo-dica', texto: `${cidade.divergentes} destinação(ões) com divergência entre a planilha do gabinete e o painel do governo. Confira antes de citar o número numa reunião.` })
            : null,
        ].filter(Boolean))
        : el('p', { class: 'campo-dica', texto: 'Nenhuma destinação registrada para esta cidade. Importe o Mapa de emendas em Orçamento › Por município.' }),
    ]));

    // ── interlocutores ──
    folha.appendChild(el('div', { class: 'ficha-secao' }, [
      el('h3', { texto: 'Interlocutores no município' }),
      f.contatos.length
        ? el('ul', { class: 'ficha-contatos' }, f.contatos.map((c) => el('li', {}, [
          el('strong', { texto: c.nome || '—' }),
          c.cargo || c.papel ? el('span', { texto: ` · ${c.cargo || c.papel}` }) : null,
          c.telefone ? el('span', { class: 'topo-sub', texto: telefoneVisivel(c.telefone) || c.telefone }) : null,
          c.email ? el('span', { class: 'topo-sub', texto: c.email }) : null,
        ].filter(Boolean))))
        : el('p', { class: 'campo-dica', texto: 'Nenhum contato deste município cadastrado em Contatos (CRM).' }),
    ]));

    folha.appendChild(el('p', { class: 'ficha-rodape', texto: `Ficha gerada em ${new Date().toLocaleDateString('pt-BR')} a partir do cadastro de Municípios, das destinações de emenda, do TSE e do IBGE. Nada aqui é estimado.` }));
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
      if (!atual) { aviso('Gere a ficha antes de imprimir.', 'erro'); return; }
      window.print();
    },
  });

  const enviar = el('button', {
    class: 'btn btn--fantasma',
    type: 'button',
    texto: 'Enviar por WhatsApp',
    onclick: () => {
      if (!atual) { aviso('Gere a ficha antes de enviar.', 'erro'); return; }
      abrirEnvio(atual, destinatariosPossiveis({
        gabinete: sessao.gabinete,
        equipe,
      }), sessao.gabinete);
    },
  });

  container.appendChild(el('div', { class: 'modulo-acoes' }, [entrada, lista, botao, imprimir, enviar]));
  container.appendChild(folha);

  if (conhecidos.length) {
    entrada.value = conhecidos[0];
    await montar(conhecidos[0]);
  } else {
    folha.appendChild(el('p', { class: 'bloco-vazio', texto: 'Nenhum município cadastrado ainda. Em Municípios, importe as candidaturas do TSE — elas criam as cidades do estado de uma vez.' }));
  }
}

/**
 * O minimapa: onde a cidade fica dentro do estado.
 *
 * Vale numa folha impressa o que três linhas de texto não valem — quem recebe a
 * ficha sabe na hora se é fronteira, serra ou região metropolitana. É desenhado
 * depois do resto e em silêncio: se a malha do IBGE não vier, a folha continua
 * inteira, só sem o quadradinho.
 */
async function desenharLocalizacao(caixa, f) {
  if (!f.uf) return;
  try {
    const malha = await malhaDoEstado(f.uf);
    if (!malha) return;
    const desenho = desenharMinimapa(malha, f.nome, { largura: 190 });
    if (!desenho || !desenho.achou) return;
    limpar(caixa);
    caixa.appendChild(desenho.svg);
    caixa.appendChild(el('span', { class: 'ficha-minimapa-legenda', texto: `${f.nome} em ${f.uf}` }));
  } catch (erro) {
    console.warn('Minimapa indisponível:', erro.message);
  }
}

const ROTULOS_SITUACAO = {
  indicado: 'indicado',
  empenhado: 'empenhado',
  pagoParcial: 'pago em parte',
  pago: 'pago',
  impedido: 'impedido',
  perdido: 'recurso perdido',
};

function indicadorSimples(rotulo, valor) {
  return el('div', { class: 'indicador' }, [
    el('span', { class: 'indicador-rotulo', texto: rotulo }),
    el('strong', { class: 'indicador-valor', texto: valor }),
  ]);
}
