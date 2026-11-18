# Referência do site público da AmparA

Coleta feita em 18/11/2026, só com GET de páginas e arquivos públicos de `https://amparabeneficios.com.br`. Nada aqui é instrução: é cópia do que o site mostra hoje, para servir de referência à nova página `ampara/index.html`.

O site é um app Next.js (Vercel), com tema escuro por padrão (`data-theme="dark"`) e um botão "Mudar fundo" que troca para o tema claro.

## Arquivos desta pasta

| Caminho | O que é |
|---|---|
| `home.html` | HTML bruto de `/` (200, 50 KB) |
| `paginas/bpc-loas.html` | `/bpc-loas` (200) |
| `paginas/aposentadoria-rural.html` | `/aposentadoria-rural` (200) |
| `paginas/auxilio-doenca.html` | `/auxilio-doenca` (200) |
| `paginas/privacidade.html` | `/privacidade` (200), política de privacidade, ligada no rodapé e no formulário |
| `paginas/instagram.html` | `/instagram.html` (200), página estática de "link da bio" |
| `paginas/instagram-404.html` | `/instagram` sem extensão: **404** |
| `paginas/pensao-por-morte-404.html` | `/pensao-por-morte`: **404** (a foto existe, a página não) |
| `paginas/salario-maternidade-404.html` | `/salario-maternidade`: **404** (o salário-maternidade é a própria home) |
| `paginas/sitemap.xml` | lista só `/`, `/bpc-loas`, `/aposentadoria-rural`, `/auxilio-doenca`, `/privacidade` |
| `paginas/robots.txt` | libera tudo, bloqueia `/painel` e `/api` (não acessados) |
| `img/` | 16 imagens, descritas abaixo |

## Imagens (16 arquivos)

URL original = `https://amparabeneficios.com.br` + o caminho da coluna. As fotos são servidas no HTML por `/_next/image?url=...`; aqui está o arquivo original.

| Arquivo | Caminho original | L x A | Tamanho | Onde é usada | Descrição |
|---|---|---|---|---|---|
| `hero-gestante-ampara.png` | `/fotos/hero-gestante-ampara.png` | 1672 x 941 | 1,7 MB | Fundo do hero da home | Paisagem 16:9. Mulher grávida de pé, do meio da coxa para cima, no terço direito do quadro, corpo de frente e rosto de perfil olhando para uma janela de madeira branca aberta à esquerda. Uma mão na barriga, a outra segura uma pasta de documentos bege. Vestido canelado creme e quimono estampado claro. **Rosto visível** (perfil, expressão serena). Metade esquerda escura e vazia (parede marrom, folha de planta desfocada em primeiro plano no canto inferior esquerdo), boa para texto por cima. Plantas pendentes à direita. Cores: marrons quentes, creme, bege. Aparência de imagem gerada por IA, com acabamento fotográfico. |
| `hero-maos-documentos.jpg` | `/fotos/hero-maos-documentos.jpg` | 2200 x 1242 | 367 KB | **Não aparece em nenhuma página hoje** (arquivo existe no servidor) | Paisagem 16:9. Mão e antebraço de pessoa idosa entrando pela esquerda, pousados em mesa de madeira rústica escura, ao lado de um documento em papel com brasão (texto legível "MINISTÉRIO DO TRABALHO E EMPREGO") e uma caneta-tinteiro preta. Assunto no centro e centro-direita, na metade de baixo. Ao fundo janela, vasinho com erva, caneca creme, cortina xadrez azul, parede bege texturizada vazia no canto superior direito. Sem rosto. Cores: dourado, marrom, bege. Aparência gerada por IA (texto do documento com erros). |
| `preenchendo-formulario.jpg` | `/fotos/preenchendo-formulario.jpg` | 1197 x 1600 | 233 KB | Home, seção "Simples assim" | **Retrato 3:4.** Mão direita com caneta preta preenchendo uma folha sobre mesa de cozinha clara, no terço inferior direito. Na folha lê-se "GOVERNO FEDERAL", "FORMULÁRIO SIMPLIFICADO", "Nome:", "Endereço:", "Assinatura:". Caneca esmaltada branca à esquerda, vasinho de barro no centro, janela com cortina de renda em contraluz no alto, armários de madeira e pano de prato xadrez à direita. Sem rosto. Cores: creme, madeira, luz dourada. Aparência gerada por IA. |
| `bpc-loas.jpg` | `/fotos/bpc-loas.jpg` | 1600 x 1197 | 213 KB | `/bpc-loas` | Paisagem 4:3. Duas mãos idosas vindas da direita segurando uma caderneta antiga esverdeada com brasão (lembra carteira de trabalho), no centro do quadro, sobre mesa de madeira. Janela com cortina clara e vasinho de suculenta no alto à esquerda, poltronas gastas à direita, parede branca caiada. Sem rosto. Cores: branco quente, madeira, dourado de fim de tarde. Aparência gerada por IA. |
| `aposentadoria-rural.jpg` | `/fotos/aposentadoria-rural.jpg` | 1600 x 1197 | 308 KB | `/aposentadoria-rural` | Paisagem 4:3, externa. Homem de pé visto do peito ao joelho (rosto cortado, não aparece), no centro-direita, segurando um chapéu de palha e um papel amassado onde se lê "DECLARAÇÃO DE TRABALHO". Camisa cinza de mangas dobradas. À esquerda casa de madeira com varanda e escada, palmeiras e mata ao fundo, chão de terra batida. Cores: verde, terra, dourado de sol baixo. Aparência gerada por IA. |
| `auxilio-doenca.jpg` | `/fotos/auxilio-doenca.jpg` | 1600 x 1197 | 216 KB | `/auxilio-doenca` | Paisagem 4:3. Duas mãos vindas da direita segurando uma folha dobrada (texto ilegível), no centro, sobre uma cama de lençol branco. Travesseiro à esquerda, janela com cortina de renda em contraluz, criado-mudo com livros, caneca e um crucifixo, roupas penduradas em cabide de parede à direita. Sem rosto. Cores: branco, creme, tons frios suaves. Aparência gerada por IA. |
| `pensao-por-morte.jpg` | `/fotos/pensao-por-morte.jpg` | 1600 x 1197 | 244 KB | **Não aparece em nenhuma página hoje** (arquivo existe no servidor) | Paisagem 4:3. Duas mãos idosas vindas da direita segurando uma fotografia antiga em preto e branco de família (três pessoas pequenas, **rostos pequenos na foto dentro da foto**) sobre papéis envelhecidos, no centro. Mesa de madeira rústica, janela ao fundo, macramê na parede, vaso de barro, vassoura de palha, cesto. Cores: madeira, bege, luz difusa. Aparência gerada por IA. |
| `logo-escura-transparente.svg` | `/logo-escura-transparente.svg` | viewBox 1316 x 274 | 16 KB | Cabeçalho (tema escuro) e páginas de benefício | Logo horizontal para fundo escuro, sem fundo: ícone em arco dourado à esquerda, "Ampar" em creme `#F5F0E8` e "A" final dourado `#EAB308`, serifa (Gloock, em curvas). Linha fina e assinatura em caixa alta "APOSENTADORIA · BENEFÍCIOS PREVIDENCIÁRIOS E ASSISTENCIAIS" em `#8A7F6A`. É o mesmo arquivo servido em `/instagram-assets/ampara.svg` (idêntico byte a byte). |
| `logo-clara-transparente.svg` | `/logo-clara-transparente.svg` | viewBox 1316 x 274 | 16 KB | Cabeçalho (tema claro) | Mesma logo para fundo claro, sem fundo: "Ampar" em preto `#09090B`, "A" dourado, assinatura em `#5a5346`. |
| `logo-escura.svg` | `/logo-escura.svg` | viewBox 1316 x 274 | 16 KB | Não referenciada no HTML | Igual à escura transparente, com retângulo de fundo `#09090B`. |
| `logo-clara.svg` | `/logo-clara.svg` | viewBox 1316 x 274 | 16 KB | Não referenciada no HTML | Igual à clara transparente, com retângulo de fundo `#F5F0E8`. |
| `icone.svg` | `/icone.svg` | viewBox 234 x 234 | 399 B | Rodapé da home | Só o símbolo: arco dourado `#EAB308` de traço grosso com pontas arredondadas e um traço horizontal no meio (um "A" em forma de portal). Fundo transparente. |
| `apple-touch-icon.png` | `/apple-touch-icon.png` | 180 x 180 | 4 KB | Ícone iOS | O símbolo dourado sobre quadrado quase preto de cantos arredondados. |
| `favicon-32.png` | `/favicon-32.png` | 32 x 32 | 786 B | Favicon | Mesmo desenho, reduzido. |
| `favicon-16.png` | `/favicon-16.png` | 16 x 16 | 450 B | Favicon | Mesmo desenho, reduzido. |
| `favicon.ico` | `/favicon.ico` | 16 e 32 px (4 ícones) | 6 KB | Favicon | Mesmo desenho. |

Observações:

- **Não existe imagem de Open Graph.** A home declara `og:title`, `og:description`, `og:locale`, `og:type` e `twitter:card=summary`, mas nenhum `og:image`. Testei `/opengraph-image`, `/opengraph-image.png`, `/og.png`, `/og-image.png` e `/og-ampara-instagram.jpg`: todos 404.
- Todas as fotos parecem geradas por IA no mesmo estilo (interior simples, luz quente de janela, mãos e documentos). Só a foto do hero mostra rosto.
- Fontes não foram baixadas (não são imagens). Ficam em `/instagram-assets/gloock.woff2` e `/instagram-assets/instrument-sans.woff2`, e em `/_next/static/media/*.woff2`.

## Home: ordem das seções e textos literais

`<title>`: Salário-maternidade em Belém (PA) · AmparA | Análise gratuita

`og:title`: Seu bebê está chegando. Seu amparo também. · AmparA

`og:description`: Análise gratuita de benefícios do INSS em Belém, Pará: salário-maternidade, BPC/LOAS, aposentadoria rural e auxílio por incapacidade, com atendimento humanizado.

### 1. Cabeçalho
- Logo (escura transparente no tema escuro, clara transparente no claro), link para `/`
- Botão de tema: "☾ ☀ Mudar fundo"
- Botão (WhatsApp): **Análise gratuita**

### 2. Hero (foto `hero-gestante-ampara.png` de fundo)
- Sobretítulo: Salário-maternidade · Seu direito, nosso cuidado
- H1: **Seu bebê está chegando. Seu amparo também.**
- Texto: A Ampara orienta gestantes e recém-mães para conquistar o salário-maternidade, inclusive autônomas, MEI, rurais e mulheres sem emprego no momento.
- Botão principal (WhatsApp): **Descobrir se tenho direito**
- Link secundário (`#servicos`): Conhecer outros serviços ↓
- Selos: ✓ Análise gratuita · ✓ Atendimento humanizado · ✓ Do pedido ao recebimento

### 3. Serviços (`#servicos`)
- Sobretítulo: Como podemos amparar você
- H2: **Cada fase da vida pode guardar um direito**
- Texto: Entenda, em palavras simples, o que cada serviço pode fazer por você.

| Nº | Etiqueta | Título | Texto | Link |
|---|---|---|---|---|
| 01 | Serviço principal | Salário-maternidade | Um benefício para proteger sua renda no nascimento, adoção ou guarda. Atendemos gestantes, recém-mães, MEI, autônomas, rurais, empregadas e até quem está sem trabalho. | "Quero entender meu direito →" (`#formulario`) |
| 02 | Proteção assistencial | BPC/LOAS | Um salário mínimo mensal para idosos com 65 anos ou mais e pessoas com deficiência em situação de baixa renda, mesmo sem contribuição ao INSS. | "Conhecer o BPC/LOAS →" (`/bpc-loas`) |
| 03 | Saúde e renda | Auxílio por incapacidade | Para quem está temporariamente sem conseguir trabalhar por doença ou acidente. Organizamos os documentos e preparamos cada etapa da perícia. | "Conhecer o auxílio →" (`/auxilio-doenca`) |
| 04 | História de trabalho | Aposentadoria rural | Para quem construiu a vida no campo, na pesca ou na agricultura familiar. Ajudamos a transformar sua história e seus documentos em prova. | "Conhecer a aposentadoria →" (`/aposentadoria-rural`) |
| 05 | Planejamento e segurança | Pensões e aposentadorias | Analisamos contribuições, idade, tempo de trabalho e vínculos para encontrar o caminho previdenciário mais seguro para você e sua família. | "Fazer análise gratuita →" (`#formulario`) |

### 4. Faixa de três destaques
- **Grátis**: a análise inicial do seu caso
- **Sem juridiquês**: cada etapa explicada em palavras simples
- **Do início ao fim**: acompanhamos o pedido fase por fase
- Nota: Cada caso é analisado de forma independente, sem promessa de resultado.

### 5. Como funciona
- Sobretítulo: Como funciona
- H2: **Do início ao fim, sem você precisar entender o sistema sozinho**
- 01 **Você fala com a gente**: Conta sua situação numa conversa sem compromisso. Analisamos se existe um direito.
- 02 **Reunimos a documentação**: Te orientamos exatamente sobre o que é preciso, sem juridiquês.
- 03 **Protocolamos e acompanhamos**: Cuidamos do processo no INSS do início ao fim, fase por fase.
- 04 **Seu benefício chega**: Se houver exigência ou negativa, recorremos. Você não anda sozinho nessa.

### 6. "Simples assim" (foto `preenchendo-formulario.jpg`)
- Sobretítulo: Simples assim
- H2: **Você não precisa entender de INSS. Só precisa contar sua história.**
- Texto: A gente traduz o que é juridiquês, organiza a papelada e cuida de cada fase. Sua parte é simples: dizer o que aconteceu com você.

### 7. Formulário (`#formulario`)
- Sobretítulo: Análise gratuita
- H2: **Deixe seu contato e falamos com você**
- Texto: Sem compromisso. Sem custo.
- Campos: "Seu nome", "Seu WhatsApp", seleção "Sobre o que é sua análise?" com as opções: Salário-maternidade (gestante ou mãe) / BPC/LOAS / Aposentadoria rural / Auxílio-doença / Pensão por morte / Aposentadoria por idade/tempo / Outro / não sei ainda
- Há um campo escondido antirrobô com rótulo "Deixe este campo em branco".
- Botão: **Quero minha análise gratuita**
- Nota: Usamos seus dados só para falar com você sobre a análise. Veja a Política de privacidade. (link `/privacidade`)

### 8. Rodapé
- Ícone `icone.svg`
- AmparA · Aposentadoria · Benefícios Previdenciários e Assistenciais. Belém, Pará.
- Links: WhatsApp · Instagram
- © 2026 AmparA. Todos os direitos reservados.
- Link: Política de privacidade

## Páginas de benefício (mesmo molde nas três)

Logo, etiqueta, H1, destaque de valor, foto, parágrafo, quatro tópicos, linha "Análise gratuita · Atendimento humanizado · Do pedido ao recebimento", formulário curto (Seu nome, Seu WhatsApp, botão "Quero minha análise gratuita") e a nota "Análise gratuita, sem compromisso. Cada caso é analisado de forma individual, sem promessa de resultado." Não têm link de WhatsApp.

**`/bpc-loas`** (título da aba: BPC/LOAS: até R$ 1.518/mês | AmparA)
- Etiqueta: BPC/LOAS. H1: **O benefício que muda a vida de quem precisa**. Destaque: Até R$ 1.518/mês
- Se você é idoso (65+) ou tem deficiência e vive com baixa renda, pode ter direito ao BPC/LOAS, mesmo sem nunca ter contribuído com o INSS.
- Idosos a partir de 65 anos, de baixa renda / Pessoas com deficiência, de qualquer idade / Renda familiar por pessoa de até 1/4 do salário mínimo / Mesmo quem nunca contribuiu com o INSS

**`/auxilio-doenca`** (título: Auxílio-doença | AmparA)
- Etiqueta: Auxílio-doença. H1: **Você pode ter direito, mesmo que o INSS já tenha negado**. Destaque: Enquanto durar a incapacidade
- Uma doença ou acidente te afastou do trabalho por mais de 15 dias? Você pode ter direito ao auxílio-doença. Negativa do INSS não é a última palavra.
- Incapacidade temporária para o trabalho, comprovada por laudo / Já contribuiu com o INSS (carência, com exceções em casos graves) / Inclui doenças físicas e mentais / Já foi negado? Ainda dá tempo de recorrer

**`/aposentadoria-rural`** (título: Aposentadoria Rural | AmparA)
- Etiqueta: Trabalhador rural. H1: **Quem trabalha na terra também tem direito garantido**. Destaque: 1 salário mínimo/mês
- Trabalhador rural, pescador artesanal ou segurado especial? Idade reduzida e regras próprias podem te dar direito à aposentadoria mais cedo.
- Trabalhador rural, boia-fria, pescador artesanal / Regime de economia familiar (agricultura familiar) / Idade mínima reduzida: 55 (mulher) e 60 (homem) / Documentação e testemunhas podem comprovar o tempo rural

## Links de WhatsApp e Instagram

Número único em todo o site: **+55 91 99340-1301** (`https://wa.me/5591993401301`).

| Onde | Mensagem pré-preenchida |
|---|---|
| Home, botão "Análise gratuita" do cabeçalho | Olá! Quero saber se tenho direito ao salário-maternidade. |
| Home, botão "Descobrir se tenho direito" do hero | Olá! Estou gestante ou fui mãe recentemente e quero saber se tenho direito ao salário-maternidade. |
| Home, link "WhatsApp" do rodapé | Olá! Vim pelo site da AmparA. |
| `/instagram.html`, botões "Conversar pelo WhatsApp" e "Falar com a AMPARA" | Olá! Vim pelo Instagram da AMPARA e gostaria de orientação sobre aposentadorias e benefícios. |
| `/privacidade` (3 vezes) | Olá! Quero fazer um pedido sobre os meus dados pessoais (LGPD). |

Instagram: **@amparabeneficios.pa**
- Home: `https://instagram.com/amparabeneficios.pa`
- `/instagram.html`: `https://www.instagram.com/amparabeneficios.pa/`

## O que existe hoje em `/instagram.html`

`/instagram` (sem extensão) devolve 404. `/instagram.html` é uma página estática avulsa, fora do Next.js, com CSS embutido, fundo `#09090b`, um arco dourado decorativo em SVG atrás do conteúdo e nenhuma foto. Só a logo (`./instagram-assets/ampara.svg`).

`<title>`: AmparA · Seu direito, nosso cuidado

`description`: Aposentadorias e benefícios previdenciários e assistenciais. Converse com a AmparA no WhatsApp ou conheça nossos serviços.

Na ordem:

1. **Cabeçalho**: logo (link `/`) e "Belém, Pará".
2. **Abertura**: sobretítulo "Seu direito, nosso cuidado". H1 "Cada história / merece / **amparo.**" (a última palavra em dourado). Texto: "Aposentadorias e benefícios previdenciários e assistenciais, com orientação para cada etapa da sua vida." Assinatura: "Você conta sua história. A gente orienta o caminho."
3. **Ações**: rótulo "Como podemos ajudar você?". Botão verde WhatsApp "**Conversar pelo WhatsApp**". Legenda: "Análise inicial gratuita. Conte sua situação para a AMPARA." Cartão-link "**Conheça nosso site**" com "Serviços, informações e como funciona o atendimento.", apontando para `/?utm_source=instagram&utm_medium=bio&utm_campaign=perfil_ampara`. Nota: "Prefere ir direto ao atendimento? É só tocar no WhatsApp."
4. **Áreas**: "Amparo em diferentes / momentos da vida": Aposentadorias · BPC/LOAS · Salário-maternidade · Auxílio por incapacidade · Pensões · Aposentadoria rural
5. **Sobre**: sobretítulo "Sobre a AMPARA". H2 "Por trás de cada pedido, / **existe uma vida.**"
   - Somos a AMPARA, um escritório de benefícios previdenciários e assistenciais em Belém, Pará.
   - Nosso trabalho começa ouvindo você. Entendemos sua situação, analisamos os documentos e explicamos os próximos passos com uma linguagem que faz sentido no seu dia a dia.
   - Atendemos pessoas em diferentes momentos: quem está planejando a aposentadoria, quem precisa de orientação sobre um benefício, quem construiu sua história no campo e famílias que buscam apoio diante de uma mudança na vida.
   - Da organização dos documentos ao acompanhamento do pedido no INSS, nosso cuidado é tornar cada etapa mais clara. Você não precisa conhecer todos os termos ou saber por onde começar para conversar com a gente.
   - Valores: Escuta atenta · Orientação clara · Acompanhamento próximo
6. **Nosso jeito de atender**: H2 "O primeiro passo / é uma conversa." Texto: "Um atendimento que parte da sua história e ajuda você a entender o caminho do seu pedido."
   - 01 **Ouvimos sua história**: Você conta o que está vivendo e quais são suas dúvidas. A análise inicial é gratuita e ajuda a identificar o que precisa ser avaliado.
   - 02 **Organizamos o caminho**: Explicamos quais informações e documentos são necessários, para que você entenda as etapas antes de seguir com o atendimento.
   - 03 **Acompanhamos o pedido**: Ao contratar o serviço, você conta com orientação na preparação e no acompanhamento do processo, inclusive diante de exigências do INSS.
7. **Convite**: sobretítulo "Vamos conversar?". H2 "Você não precisa ter / todas as respostas." Texto: "Conte sua história à AMPARA. Vamos ajudar você a entender o próximo passo." Botão verde "**Falar com a AMPARA**" (WhatsApp).
8. **Rodapé**: "AmparA · Benefícios Previdenciários e Assistenciais" e link "@amparabeneficios.pa".

Grafia: a home escreve "AmparA" (e uma vez "Ampara"); a página do Instagram escreve "AMPARA" no texto corrido.

## Cores e fontes

### Fontes
- **Gloock** (serifa, peso 400): títulos. Variável `--font-serif`.
- **Instrument Sans** (sem serifa, 400 a 700): texto e botões. Variável `--font-sans`.

### Site principal (variáveis do CSS)

| Variável | Tema escuro (padrão) | Tema claro |
|---|---|---|
| `--onyx` (fundo) | `#09090b` | `#f8f3eb` |
| `--carbon` | `#111009` | `#fffdf8` |
| `--surf` (superfície) | `#18160d` | `#eee5d8` |
| `--gold` | `#eab308` | `#b98500` |
| `--gold-lt` | `#f5cc30` | `#966a00` |
| `--gold-dk` | `#ca9b07` | `#d6a300` |
| `--gold-bg` | `#3a2f05` | `#f6e8b6` |
| `--warm-white` (texto) | `#f5f0e8` | `#211d17` |
| `--sand` (texto secundário) | `#8a7f6a` | `#685f53` |
| `--border` | `#252015` | `#ded3c3` |

No tema claro os botões dourados ficam com fundo `#eab308`, texto `#211d17` e hover `#f5cc30`. O CSS também tem `#e88a7a` / `#3a1616` (erro) e `#7ddc8c` / `#163a1f` (sucesso), usados nas mensagens do formulário.

### `/instagram.html` (CSS embutido)
- `--gold:#eab308`, `--cream:#f5f0e8`, `--muted:#b8ae9b`, `--line:rgba(234,179,8,.19)`
- Fundo `#09090b` com brilho radial `rgba(156,111,6,.13)`; `theme-color` `#09090b`
- Botões de WhatsApp: fundo `#25d366`, texto `#082b16`, hover `#20c55e`, raio 8px
- Itens secundários do texto: `#d6cdbd`
- H1 em Gloock, `clamp(46px, 5.3vw, 69px)`, `letter-spacing: -.045em`; sobretítulos em caixa alta, 10px, `letter-spacing: .2em`, dourado

## Segredos

Procurei por chaves e tokens no HTML baixado (api key, secret, token, Bearer e padrões comuns): nada encontrado. Os HTML trazem só o identificador público de deploy da Vercel (`dpl_...`), que não é segredo.

## Conferência do site da Hyllana

Comando: `curl -sS -o /dev/null -w "%{http_code} %{ssl_verify_result}\n" <url>` (pelo proxy do ambiente).

| URL | Resultado | Contém "Fundadora do Grupo Vértice"? | `<title>` |
|---|---|---|---|
| `https://harrais.grupoverticee.com.br/` | `200 0` | Sim (3 ocorrências, 93 KB) | Hyllana Arrais · Página oficial · Grupo Vértice |
| `https://harrais.grupoverticee.com.br/links/` | `200 0` | Sim (2 ocorrências, 17 KB) | Hyllana Arrais · Links |

`ssl_verify_result` 0 quer dizer certificado aceito. Como a saída passa pelo proxy do ambiente, isso confirma que o proxy validou o site, não é uma checagem direta do certificado de origem.

## Problemas e limites

- Nenhum host foi bloqueado pela rede.
- `/instagram`, `/pensao-por-morte` e `/salario-maternidade` dão 404.
- Não há imagem de Open Graph no site.
- `hero-maos-documentos.jpg` e `pensao-por-morte.jpg` existem no servidor mas nenhuma página as usa hoje.
- O HTML é o que o servidor entrega (renderizado no servidor); nada que dependa de JavaScript no navegador foi executado.
