# AmparA · atualização da página do Instagram

Atualização de `https://amparabeneficios.com.br/instagram.html`, a página do link da bio.

## O que vai para o site

Copiar para a pasta `public/` do projeto do site, mantendo os caminhos:

| Arquivo aqui | Destino no site |
|---|---|
| `instagram.html` | `public/instagram.html` (substitui a página atual) |
| `instagram-assets/foto-*.jpg` | `public/instagram-assets/` (arquivos novos) |
| `instagram-assets/equipe-*.jpg` | `public/instagram-assets/` (fotos da equipe) |
| `instagram-assets/og-ampara-instagram.jpg` | `public/instagram-assets/` (imagem de prévia do link) |

Não precisam ser copiados, porque já existem no site: `instagram-assets/ampara.svg` (está aqui só para a página abrir fora do site), `instagram-assets/gloock.woff2` e `instagram-assets/instrument-sans.woff2`.

O endereço não muda. Nenhuma configuração do site precisa ser alterada.

## Equipe

A parte "Conheça a nossa equipe" fica antes do convite final. Tudo vem de `CONFIG.equipe`, no fim de `instagram.html`:

- `foto` e `fundadoras`: a foto das fundadoras e o nome e o cargo de cada uma, na ordem em que aparecem na foto, da esquerda para a direita.
- `texto` e `lema`: as frases do post "Quem somos".
- `pessoas`: quem tem cartão próprio, com `rotulo`, `nome`, `cargo`, `foto`, `descricao` e `temas`. Sem `foto`, a página mostra a inicial do nome.
- Fotos novas vão em `instagram-assets/` com o nome `equipe-nome.jpg`. Para os cartões, foto em pé na proporção 4 por 5.

Hoje: Hyllana Arrais (Fundadora e CEO) e Vanessa (Cofundadora) na foto principal, e Cristianne Arrais no cartão de parceria.

## De onde vieram os textos e as fotos

- Textos: página `/instagram.html` anterior e página inicial do site, sem alteração de sentido.
- Fotos: recortes das imagens que já estão em `/fotos/` no site.
- Fotos e textos da equipe: posts "Quem somos" e "Parceria que faz a diferença" do Instagram da AmparA, enviados pela Andrea. As fotos foram recortadas sem os textos do post.
- WhatsApp: `5591993401301`, com a mesma mensagem da página anterior. Cada cartão de benefício troca só o tema da mensagem.
