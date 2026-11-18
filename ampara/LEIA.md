# AmparA · atualização da página do Instagram

Atualização de `https://amparabeneficios.com.br/instagram.html`, a página do link da bio.

## O que vai para o site

Copiar para a pasta `public/` do projeto do site, mantendo os caminhos:

| Arquivo aqui | Destino no site |
|---|---|
| `instagram.html` | `public/instagram.html` (substitui a página atual) |
| `instagram-assets/foto-*.jpg` | `public/instagram-assets/` (arquivos novos) |
| `instagram-assets/og-ampara-instagram.jpg` | `public/instagram-assets/` (imagem de prévia do link) |

Não precisam ser copiados, porque já existem no site: `instagram-assets/ampara.svg` (está aqui só para a página abrir fora do site), `instagram-assets/gloock.woff2` e `instagram-assets/instrument-sans.woff2`.

O endereço não muda. Nenhuma configuração do site precisa ser alterada.

## Foto da equipe

A seção "Sobre a AMPARA" tem o espaço da foto da equipe. Para ligar:

1. Salvar a foto em `instagram-assets/equipe.jpg` (largura de 1200 a 1600 px).
2. No fim de `instagram.html`, em `CONFIG.equipe`, preencher `foto: A + 'equipe.jpg'` e, se quiser, `legenda`.

Enquanto `foto` estiver vazio, a seção mostra `foto-sobre.jpg`, que é uma foto do próprio site.

## De onde vieram os textos e as fotos

- Textos: página `/instagram.html` anterior e página inicial do site, sem alteração de sentido.
- Fotos: recortes das imagens que já estão em `/fotos/` no site.
- WhatsApp: `5591993401301`, com a mesma mensagem da página anterior. Cada cartão de benefício troca só o tema da mensagem.
