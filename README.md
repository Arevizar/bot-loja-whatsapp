# LOJA MONACO/CAPIVA

# Bot de pedidos — WhatsApp (Baileys)


Bot que recebe pedidos pelo WhatsApp da loja, guarda tudo em um banco SQLite local,
encerra os pedidos automaticamente às 18h e manda o resumo do dia pro dono.

## Estrutura

```
bot-loja/
  index.js              → conecta no WhatsApp e liga tudo
  database/
    db.js                → banco SQLite (estado da conversa + pedidos)
    catalogo.js           → lista de produtos (edite aqui!)
  flows/
    messageHandler.js     → a lógica de cada etapa da conversa
  jobs/
    horario.js            → regra do horário limite (18h)
    resumoDiario.js        → cron job que manda o resumo às 18h
  .env.example            → modelo de variáveis de ambiente
```

## Como rodar (quando já tiver o chip/número novo)

1. Copie `.env.example` para `.env` e preencha `NUMERO_DONO` com seu número pessoal
   (o que vai receber o resumo diário dos pedidos).

2. Instale as dependências (se ainda não instalou):
   ```
   npm install
   ```

3. Rode o bot:
   ```
   node index.js
   ```

4. Um QR code vai aparecer no terminal. Abra o WhatsApp **do número novo (chip da loja)**,
   vá em **Aparelhos conectados > Conectar um aparelho** e escaneie o QR code.

5. Pronto — a partir daí a sessão fica salva na pasta `auth_info/`, então não
   precisa escanear de novo toda vez que reiniciar o bot (só se deslogar).

## Editando o catálogo

Edite `database/catalogo.js` e coloque os produtos reais da sua loja (nome e preço).

## Ajustando o horário limite

Edite a constante `HORA_LIMITE` em `jobs/horario.js`.

## Fluxo da conversa

1. Cliente manda qualquer mensagem → bot responde com o catálogo
2. Cliente digita o número dos produtos que quer (pode escolher vários)
3. Cliente digita "fim" → bot pede o endereço
4. Cliente manda o endereço → bot mostra o resumo e pede confirmação (A ou B)
5. Cliente confirma → pedido salvo no banco, disponível para o resumo das 18h

## Próximos passos possíveis

- Trocar a lógica de resposta simples por chamada a uma IA (ex: API da Anthropic)
  para conversas mais livres
- Adicionar imagens no catálogo (Baileys suporta enviar imagem)
- Múltiplos produtos com quantidade, não só 1 unidade por item
