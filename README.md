# Gestão de Gabinete Parlamentar

Sistema web para o trabalho diário de um gabinete parlamentar, dividido em cinco áreas:
**Chefia de gabinete**, **Administrativo**, **Legislativo**, **Comunicação** e **Orçamento**.

Entra-se com conta Google, mas só passa quem estiver na lista de pessoas autorizadas.
Todos os integrantes enxergam todas as áreas; cada setor edita a sua. A agenda do
deputado é a única exceção — apenas a chefia altera.

O mesmo sistema atende **mais de um gabinete**: cada registro nasce vinculado a um, e a
separação é garantida pelas regras de segurança do banco, não pela tela.

---

## Como é feito

Não há etapa de compilação nem dependências para instalar. São arquivos estáticos que
falam direto com o Firebase pelo navegador — publicar é copiar a pasta.

| Arquivo | Papel |
| --- | --- |
| `index.html`, `app.css` | Casca e aparência |
| `js/config.js` | Chaves do Firebase, áreas, papéis e regra de permissão |
| `js/modulos.js` | **Catálogo dos módulos.** Descreve os campos de cada tela |
| `js/crud.js` | Gera listagem e formulário a partir do catálogo |
| `js/paineis.js` | Painéis consolidados (gabinete, cota, emendas por município) |
| `js/destinacoes.js` | Leitura das duas planilhas de emenda e a conciliação entre elas |
| `js/sessao.js` | Login, lista de autorizados e vínculo com o gabinete |
| `js/admin.js` | Tela de liberação de acessos |
| `js/camara.js` | Integração com os dados abertos da Câmara |
| `firestore.rules` | **Onde as permissões realmente valem** |

Para acrescentar um campo — ou uma tela inteira — mexe-se em `js/modulos.js`. A interface
é derivada de lá.

---

## Instalação

### 1. Criar o projeto no Firebase

1. Abra <https://console.firebase.google.com> e crie um projeto.
2. Em **Criação › Firestore Database**, crie o banco. Três escolhas importam:
   - **Anote o ID do banco.** Um projeto aceita vários, e o SDK só acha aquele que
     estiver escrito em `FIRESTORE_DATABASE_ID`, em `js/config.js`. Banco errado dá
     erro de "cliente offline" — que parece problema de rede e não é.
   - **Edição Padrão** e **modo nativo**. O SDK do Firebase não fala com o modo
     Datastore, e a edição Corporativos tem preço e comportamento diferentes.
   - Região `southamerica-east1` (São Paulo). Essa não dá para mudar depois.
3. Em **Criação › Authentication › Sign-in method**, ative o provedor **Google**.
4. Ainda em Authentication, aba **Settings › Authorized domains**, confira que o domínio
   onde o sistema vai rodar está na lista.

### 2. Conectar o sistema ao projeto

Em **Configurações do projeto › Seus apps**, registre um app da Web e copie o bloco de
configuração. Cole os valores em `js/config.js`, no lugar dos campos `COLE_AQUI`.

Essas chaves são públicas por natureza — quem protege os dados é o `firestore.rules`.

### 3. Publicar as regras de segurança

Os comandos abaixo precisam rodar **dentro da pasta do projeto** — é lá que está o
`firebase.json`. No Cloud Shell, que abre na pasta pessoal:

```bash
cd ~/applegis || git clone https://github.com/hthiago/applegis.git ~/applegis && cd ~/applegis
git pull origin main       # publica as regras de agora, não as do último clone
```

```bash
npm install -g firebase-tools
firebase login
firebase use --add          # escolha o projeto criado
firebase deploy --only firestore:rules
```

**Não pule este passo.** Sem as regras publicadas, o banco fica aberto ou fechado demais.

**O `firebase.json` precisa nomear o banco.** Este projeto usa um banco Firestore nomeado
(`appgab`), não o `(default)`. Sem a chave `database` no `firebase.json`, o deploy publica
no `(default)` sem avisar — e o banco que o sistema lê continua com as regras antigas.
O sintoma é traiçoeiro: as coleções que já estavam nas regras continuam gravando, só as
novas falham, e republicar não muda nada. Um teste da suíte confere essa correspondência.

**E repita-o sempre que uma aba nova aparecer no sistema.** O `firestore.rules` traz um
mapa de coleções; coleção que não está nele não é gravável por ninguém — nem pela chefia.
Quando isso acontece, o Firebase responde `Missing or insufficient permissions`, que
parece problema de perfil de usuário e não é. O sistema traduz esse erro na tela e diz
qual coleção falhou, mas quem resolve é este comando.

### 4. Publicar o site

```bash
firebase deploy --only hosting
```

### 5. Fazer o primeiro acesso

Abra o site e entre com sua conta Google. Como o banco está vazio, o sistema mostra a tela
**Vamos criar o gabinete**: preencha o nome, crie, e você entra já como chefe de gabinete.

**Faça isso logo depois de publicar as regras.** Enquanto o gabinete não existe, qualquer
pessoa que entre pode reivindicá-lo — é a única janela aberta do sistema, e ela se fecha
sozinha e em definitivo assim que o primeiro gabinete é criado.

A partir daí, use a tela **Acessos** para liberar o resto da equipe. Não é preciso voltar
ao console do Firebase.

> O ID do deputado na Câmara — campo opcional, usado depois para buscar proposições e
> despesas — está em
> <https://dadosabertos.camara.leg.br/api/v2/deputados?nome=SOBRENOME>.

### 6. Abrir outros gabinetes (opcional)

O primeiro gabinete nasce pela tela de instalação. Para atender mais de um, promova
alguém a `admin` editando o documento correspondente em `autorizados` no console: esse
papel não edita conteúdo, mas cria novos gabinetes e administra os acessos de todos eles.

---

## Papéis

| Papel | Alcance |
| --- | --- |
| `deputado` | Edita tudo, inclusive a agenda |
| `chefe` | Edita tudo, inclusive a agenda, e libera acessos do seu gabinete |
| `assessor` | Edita apenas as áreas listadas em `areas`; lê o resto |
| `escritorio` | Edita o Administrativo e o Orçamento; lê o resto |
| `leitor` | Lê tudo, não altera nada |
| `admin` | Não edita conteúdo; cria gabinetes e administra acessos de todos |

Duas exceções deliberadas à regra geral, ambas registradas em `firestore.rules`:

- **Agenda do deputado** — escrita só de `chefe` e `deputado`, mesmo para quem edita a
  área de Chefia.
- **Tarefas** — qualquer integrante do gabinete pode gravar, porque delegação atravessa
  áreas: quem recebe a tarefa precisa conseguir respondê-la.

---

## Orçamento: as destinações de emenda

A unidade de trabalho não é a emenda — é a **destinação**: *esta emenda, para esta
cidade, para este beneficiário, para este objeto*. Uma emenda se reparte entre dezenas
de cidades, e é cada pedaço que o assessor acompanha. O Mapa de emendas do gabinete
sempre funcionou assim: 758 destinações para 67 emendas, de 2019 a 2026.

### Duas telas, duas perguntas

*Orçamento › **Por município*** responde **"quanto foi para Erechim, e já foi pago?"** —
a pergunta de quem já sabe qual é a cidade. A lista se ordena por qualquer coluna ao
clique (número por maior, nome em ordem alfabética; o segundo clique inverte), e clicar
numa cidade abre as destinações dela em linhas, com Ano, Emenda, Área e os três valores
alinhados para comparar.

*Orçamento › **Dashboard*** responde à outra, que se faz com a mesma frequência e não
tinha onde: **onde o mandato chegou, o que é grande e o que está parado.** Traz os
números do conjunto, um mapa do estado pintado pelo destinado — **clicar numa cidade
leva às emendas dela, já abertas** — e os destaques: maiores destinações, cidades mais
atendidas, por área, por ano, em que pé está, e o que está **travado (impedido ou
perdido)**, que é o primeiro assunto de qualquer visita.

### Duas planilhas, dois botões

Em *Orçamento › Por município*:

- **Importar Mapa de emendas** — a planilha do gabinete. **Comece por ela.**
- **Confirmar pelo painel** — a exportação do SERPRO, que confirma valores no que já
  está aqui.

Cada botão diz o que faz antes de o arquivo ser escolhido, e recusa o arquivo do outro
com o nome do botão certo. Se o arquivo tiver várias abas, o erro lista todas e diz qual
foi lida.

| Planilha | Papel | O que ela traz |
|---|---|---|
| **Mapa de emendas** (do gabinete) | **A fonte.** Importe esta primeiro | Cidade, região, endereço, beneficiário, objeto, área, valor destinado e o que já se sabe do andamento |
| **Exportação do painel** (`dd-publico.serpro.gov.br`) | A confirmação | Empenhado e pago oficiais, nº do instrumento e o link do convênio |
| Aba **Conciliação** (no mesmo arquivo do Mapa) | A auditoria | Resultado por linha contra SIGA-Brasil, Transferegov e transferências especiais: prioridade, correção sugerida, evidência e URL pública |

A planilha do gabinete é a fonte primária, e os números explicam por quê: ela tem 758
destinações, 298 municípios e 67 emendas; a exportação do painel tem 198, 117 e 25.
Todos os municípios do painel já estão nela. O painel só enxerga o que virou convênio
celebrado — não vê a Segurança Pública, não vê o fundo a fundo da Saúde, não vê 2019.

### A aba "Conciliação" entra de carona

Se o arquivo do Mapa tiver uma aba chamada **Conciliação**, ela é importada junto, sem
botão próprio — são o mesmo arquivo, e escolher entre importar o mapa e importar a
auditoria dele seria uma escolha que não existe.

Ela é a auditoria que o gabinete faz do Mapa contra **SIGA-Brasil**, **Transferegov** e o
**painel de transferências especiais** — o trabalho que nenhuma base entrega pronta e que
o sistema não tem como fazer sozinho. O que ele faz é não perdê-lo: para cada linha,
guarda o resultado da conciliação, a prioridade da revisão, o nº de emenda conciliado, a
**correção sugerida**, a nota de evidência, o CNPJ na fonte pública e a URL.

As duas abas se encontram pela coluna **"Linha no novo mapa"** — o número da linha, não
uma chave derivada do conteúdo. É exato quando as abas vêm do mesmo arquivo, e um desastre
silencioso quando não vêm: por isso o ano e o município são conferidos antes de aplicar, e
o que não confere não é aplicado e é contado no aviso.

O que a auditoria marcou como **Crítica** ou **Alta** vira o indicador *A revisar*, um
bloco próprio no Dashboard, uma faixa vermelha na linha da destinação com a correção
sugerida, e a primeira coisa na folha da cidade — *"Confira antes de citar"*. Nos outros
casos o número está certo e o repasse é que travou; aqui o próprio número pode estar
errado, e número errado dito numa reunião não se desdiz.

### Três coisas que a reimportação não faz

- **Não apaga com vazio.** Uma versão nova do Mapa pode vir com uma coluna quebrada — a
  Região saiu como erro de fórmula em 753 das 764 linhas de uma delas. Célula vazia é
  "não sei", não é "não tem": o que já estava preenchido fica, e o aviso diz quantos
  campos foram preservados. Zero não entra nessa regra — em dinheiro, zero é um valor que
  alguém escreveu.
- **Não engole erro de fórmula.** `#NAME?`, `#REF!`, `#N/A` e companhia entram como célula
  vazia, e não como o texto `#NAME?` dentro do sistema.
- **Não apaga o que não veio.** Corrigir o nº de uma emenda na planilha muda a chave da
  destinação, e a linha antiga fica para trás — com o andamento escrito nela. Apagar
  sozinho seria pior: uma planilha importada pela metade levaria junto o trabalho de todo
  mundo. Elas ficam, e o aviso conta quantas são.

### Quando as duas divergem

Elas se encontram por **ano + nº da emenda + município**: 153 destinações, em 127
convênios. Quando o painel registra mais que o destinado, a linha é **marcada como
divergente** — e alguém do gabinete escolhe qual fonte vale, com o motivo registrado.
Nada é conciliado automaticamente: foi isso que produziu, nas versões anteriores desta
área, número que ninguém sabia defender numa reunião.

**O valor do painel é do convênio, não da linha.** Cinco compras de equipamento sob a
mesma emenda casam com um convênio só; somar por linha contaria o mesmo repasse cinco
vezes — R$ 95 milhões onde há R$ 60. A tela conta uma vez por convênio.

**A cidade escrita de três jeitos é uma cidade só.** A planilha foi digitada por muitas
mãos ao longo de sete anos e traz "Caxias do sul", "Caxias Do Sul" e "Caxias do Sul"
como se fossem lugares diferentes — três linhas com um terço do valor cada, e a tela
respondendo errado justamente a pergunta que ela existe para responder. As 298 grafias
do arquivo são **292 municípios**. A grafia que aparece na tela é escolhida entre as que
foram escritas, nunca inventada: caixa automática produziria "Caxias Do Sul", que está
errado em português.

### Anotar sem abrir o registro

Abrir a destinação inteira para escrever uma frase é atravessar 36 campos para mexer em
um. Na linha de cada destinação há o botão **Anotar**, que abre ali mesmo:

- **Andamento** — o que aconteceu. Entra **datado e assinado**, no **topo** do histórico:
  quem lê antes de viajar quer o último capítulo, não o primeiro.
- **Responsável na cidade** — nome, cargo e telefone, que é o que se procura na véspera.
- **Qual fonte vale** — só aparece na linha em que as duas fontes divergem. O **motivo é
  obrigatório**: a decisão vai ser dita em voz alta na frente de um prefeito, e o que não
  está escrito ninguém lembra. Fica registrada com quem decidiu e quando, a linha passa a
  mostrar a decisão, e o contador *A conciliar* desce.

Quem não edita o Orçamento lê a mesma tabela sem a coluna de anotar e sem os botões de
importar — e não descobre que não pode pelo erro de gravação.

### Três campos que não existem em planilha nenhuma

- **Responsável na cidade** — a pessoa de lá, com cargo e telefone. É quem se liga antes
  de viajar.
- **Andamento** — o histórico datado. Na planilha ele estava espremido na coluna
  "Situação", que por isso tinha 54 valores distintos enquanto "Andamento" ficava
  preenchida em 11% das linhas.
- **Conciliação** — qual fonte vale, por quê, quem decidiu e quando.

### A folha da cidade, para levar à visita

A tela é para conferir; a folha é para levar. Numa reunião de prefeitura ninguém rola uma
tabela — abre-se uma folha, e o que está nela é o que se responde. Abra a cidade em
*Por município* e clique em **Folha desta cidade**, ou vá direto a
`#/orcamento/folha/<cidade>` — o endereço pode ser guardado e mandado a quem vai.

A folha não é a tabela impressa. Ela começa por **o que vão perguntar primeiro** — o que
está impedido ou perdido, e o que ainda não bate entre as duas fontes, com a instrução de
**não citar o valor sem conferir**. Depois vêm as destinações **por ano**, cada uma
inteira: beneficiário, objeto, os três valores, emenda e modalidade, **o andamento
completo** escrito pelo gabinete (a pergunta na reunião é "desde quando?"), quem se
procura na cidade, e a decisão de conciliação quando houve. Termina em **linhas em
branco**: o que se combina na reunião é anotado à mão, na hora.

A **Ficha de apresentação** continua sendo o retrato da cidade — população, quem governa,
votação, economia — e agora manda para a folha em vez de repetir o que ela faz melhor.

---

## Integrações

**Dados abertos da Câmara** (ativa, sem cadastro). Em *Legislativo › Proposições
acompanhadas*, o botão **Buscar na Câmara** importa uma proposição pelo tipo, número e
ano; **Atualizar situações** relê a situação e o órgão de tudo que está na lista.
Em *Produção do gabinete*, **Importar da Câmara** traz tudo que o parlamentar assinou.
Em *Administrativo › Cota parlamentar*, **Buscar na Câmara** traz as despesas da CEAP.

**Municípios: três importações, três fontes** (ativas, sem cadastro). Em
*Administrativo › Municípios*, o cadastro que alimenta a ficha de apresentação se
preenche sozinho para o estado inteiro. Cada botão escreve só os seus campos, então as
três convivem no mesmo registro sem se apagarem.

| Botão | Arquivo / fonte | Preenche |
|---|---|---|
| **Importar candidaturas (TSE)** | `consulta_cand_<ano>_<UF>.csv` da eleição **municipal** (2024), em [dadosabertos.tse.jus.br](https://dadosabertos.tse.jus.br) | Prefeito, partido, vice e os vereadores eleitos **do partido do parlamentar** |
| **Importar votação (TSE)** | `votacao_candidato_munzona_<ano>_<UF>.csv` da eleição **geral** (2022) | Votos na cidade, votos válidos, colocação e percentual |
| **Atualizar economia (IBGE)** | API do IBGE, sem arquivo | PIB per capita, renda média e de onde vem a produção |

Para os vereadores aliados, informe o **partido** em *Acessos › Dados do gabinete* — sem
ele a importação traz prefeito e vice, e diz na tela que não guardou vereador nenhum.

Os arquivos do TSE passam de cem megabytes. Eles são lidos **em fluxo**, pedaço a pedaço,
somando o que interessa e descartando o resto — carregar o arquivo inteiro derrubava a
aba. O botão mostra a porcentagem enquanto lê.

**Eleito não é o mesmo que empossado.** O TSE publica quem ganhou a eleição, e entre ela
e a visita cabem renúncia, cassação, morte e o vice assumindo — não existe base pública
federal com quem está no cargo hoje. Então a ficha escreve **"Prefeito eleito"** e diz de
que ano. Quando alguém do gabinete confere, marque **"Confirmado pelo gabinete"** no
município: o rótulo passa a ser "Prefeito" e as importações seguintes do TSE não mexem
mais naqueles nomes.

**Ficha de apresentação** (ativa). Em *Administrativo › Ficha de apresentação*, o
município em uma folha: população e região (IBGE), um minimapa mostrando onde a cidade
fica no estado, quem governa e os vereadores aliados, a votação do parlamentar ali, renda
e produção, e os contatos do gabinete na cidade. **Imprimir** gera a folha física em A4. **Enviar por WhatsApp** monta
a versão curta e abre a conversa com a mensagem pronta.

O envio é restrito ao **parlamentar e à equipe do gabinete** — a ficha traz pendências,
impedimentos e a leitura interna da cidade, e não é material de divulgação. O CRM não
aparece nessa lista, e não há campo de número livre. O número do parlamentar fica em
*Acessos › Dados do gabinete*; o da equipe, no cadastro de *Equipe* (fora da navegação,
acessível por `#/administrativo/equipe`).

**Contatos (CRM)** (ativa). Em *Administrativo › Contatos*, **Importar lista** lê uma
planilha em CSV e padroniza telefone, nome, município e categoria na entrada.

**Ainda por ligar:** Google Agenda (leitura para o gabinete, escrita para a chefia) e
Google Drive (documentos guardam o link, não o arquivo).

---

## Cloud Functions

Sobrou **uma** função no servidor: a leitura de bilhete de passagem por imagem
(*Administrativo › Viagens › Ler bilhete*). Ela precisa estar lá por um motivo só — a
chave da API de leitura não pode ficar em código de navegador, onde ficaria visível para
qualquer visitante da página.

A ponte de consulta às bases de execução orçamentária saiu junto com as importações
automáticas. Uma ponte que ninguém chama é superfície de ataque sem contrapartida, mesmo
fechada por lista de hosts e por lista de autorizados.

### Passo a passo

1. **Mude o projeto para o plano Blaze.** Cloud Functions exige cartão cadastrado. O
   plano é por uso e tem cota gratuita generosa.
2. Cadastre a chave do provedor de leitura:

   ```
   firebase functions:secrets:set CHAVE_OPENAI
   ```

   Ou `CHAVE_ANTHROPIC`, se preferir. A função usa a que existir, OpenAI primeiro.
3. Implante:

   ```
   firebase deploy --only functions
   ```
4. Ligue `CONSULTA_AUTOMATICA` em `js/config.js` e publique o site.

Se você já usou as importações automáticas de emenda, a chave do Portal ficou sem uso —
a área de Orçamento foi removida — e pode ser destruída:

```
firebase functions:secrets:destroy CHAVE_PORTAL_TRANSPARENCIA
```


## Dados pessoais

Com o CRM e o atendimento ao cidadão, o banco guarda dados de pessoas que não trabalham no
gabinete. Três cuidados que fazem parte do desenho:

- Guarde o mínimo necessário. O cadastro de equipe não pede CPF de propósito.
- Não registre dado sensível — saúde, opinião política de terceiros — em campo livre.
- Todo registro grava quem criou e quem alterou por último (`criadoPor`, `atualizadoPor`).

---

## Desenvolvimento local

```bash
npx serve .
```

Qualquer servidor estático serve. Abrir o `index.html` direto do disco **não funciona**:
os módulos JavaScript exigem `http://` ou `https://`.

## Testes

```bash
npm install -D playwright && npx playwright install chromium
node teste/rodar.mjs
```

Abre o sistema num navegador de verdade e troca o SDK do Firebase por um duplo em
memória (`teste/stub-firebase.js`), sem tocar em nenhum projeto real. São 25 verificações
em duas frentes: o uso normal — login, as quatro áreas, cadastro, busca, painéis — e a
**matriz de permissão**, papel por papel.

Vale rodar sempre que mexer em `js/config.js` ou em `firestore.rules`: a segunda suíte
existe justamente para flagrar quando a tela e as regras do banco discordam sobre quem
pode editar o quê.

## Documentação

`docs/anamnese.html` é o levantamento que originou o sistema: o escopo de cada área, a
matriz de permissão, as integrações, os riscos e o que ficou de fora. Abra no navegador.


### Leitura de bilhetes de passagem

A aba **Viagens e passagens** lê a captura de um e-ticket ou cartão de embarque e
preenche os campos — origem, destino, data, hora, voo, localizador — em vez de
alguém redigitá-los na planilha e na agenda. A leitura acontece numa Cloud
Function, porque a chave da API não pode ficar em código de navegador.

A leitura aceita dois provedores, escolhidos pela chave que estiver cadastrada.
A OpenAI vem primeiro quando as duas existem:

```bash
firebase functions:secrets:set CHAVE_OPENAI        # platform.openai.com
# ou
firebase functions:secrets:set CHAVE_ANTHROPIC     # console.anthropic.com

firebase deploy --only functions
```

Para fixar o modelo, ponha `MODELO_LEITURA` em `functions/.env` — o padrão é
`gpt-4o` na OpenAI e `claude-opus-5` na Anthropic. O gasto é por imagem lida e o
volume de um gabinete é pequeno: algumas dezenas de bilhetes por mês.

As duas implementações ficam no código de propósito. A parte difícil — o esquema
dos campos e a instrução de não adivinhar — é a mesma nas duas; o que muda é o
envelope. Arrancar uma para trocar de provedor obrigaria a reescrever tudo na
próxima troca, e "momentaneamente" é uma palavra que costuma durar.

**Nada é gravado sem confirmação.** A função devolve o que leu, a tela mostra
campo por campo com o que ficou ilegível em destaque, e quem confirma é uma
pessoa. Leitura de imagem erra, e uma viagem gravada sozinha com a data errada é
pior que uma viagem não gravada: a segunda alguém percebe que falta, a primeira
ninguém percebe até o embarque.
