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

A parte "Conheça a nossa equipe" fica antes do convite final. As pessoas estão no fim de `instagram.html`, em `CONFIG.equipe`:

- A primeira da lista aparece em destaque, com a foto grande dentro do arco.
- Cada pessoa tem `nome`, `cargo`, `foto` e `descricao`.
- Sem `foto`, a página mostra a inicial do nome no lugar. Sem `descricao`, mostra só o cargo e o nome.
- Fotos novas vão em `instagram-assets/` com o nome `equipe-nome.jpg`, em pé, na proporção 4 por 5 (900 x 1125 px).

Hoje: Hyllana Arrais (Fundadora e CEO, com foto) e Vanessa (Cofundadora, ainda sem foto e sem descrição).

## De onde vieram os textos e as fotos

- Textos: página `/instagram.html` anterior e página inicial do site, sem alteração de sentido.
- Fotos: recortes das imagens que já estão em `/fotos/` no site.
- Foto da Hyllana: uma das fotos profissionais que a Andrea enviou para a página da Hyllana.
- WhatsApp: `5591993401301`, com a mesma mensagem da página anterior. Cada cartão de benefício troca só o tema da mensagem.
