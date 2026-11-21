# Área fiscal

## Arquivos
- `index.html` – estrutura da página
- `css/style.css` – estilos originais · `css/temas.css` – paletas (verde, verde escuro, preto e roxo) e celular · `css/design.css` – novo visual (tela "Hoje", revisões, simulado etc.)
- `js/app.js` – o site (login, questões, conteúdo, revisão, caderno) · `js/simulado.js` · `js/lembretes.js` · `js/pwa.js` · `js/ui.js`
- `sw.js` + `manifest.webmanifest` + `icons/` – app instalável e uso offline
- `firebase.json` – configuração do Firebase Hosting

## Publicar (Firebase Hosting, gratuito)
1. `npm i -g firebase-tools` e `firebase login`
2. Na pasta do site: `firebase init hosting` (public = `.`, não sobrescrever `index.html`) ou use o `firebase.json` que já está aqui
3. `firebase deploy`

O site precisa abrir por `https://` (os módulos e o app instalável não funcionam abrindo o arquivo direto do computador).
Ao publicar uma versão nova, troque `const V = "af-v1"` em `sw.js` (por exemplo `af-v2`) para o app instalado atualizar.

## Instalar no iPhone
Abra o endereço no Safari → Compartilhar → Adicionar à Tela de Início. Abra pelo ícone.

## Lembretes
O aviso diário aparece quando o app está aberto ou foi aberto recentemente, e o número no ícone indica as revisões do dia.
Para avisar com o app totalmente fechado é preciso um servidor de push (Firebase Cloud Messaging).
