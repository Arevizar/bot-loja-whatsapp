# Bot de pedidos para WhatsApp

Bot que atende os clientes de uma pequena loja pelo WhatsApp: mostra o catálogo, entende pedidos escritos em linguagem natural ("quero 2 de morango e um de uva"), calcula o frete pelo endereço, gera a cobrança PIX e confere o comprovante de pagamento. Os donos acompanham tudo por comandos no próprio WhatsApp e por um painel web.

## Funcionalidades

- **Atendimento automático:** catálogo com estoque, interpretação de pedidos em texto livre (números escritos por extenso, apelidos dos sabores) e confirmação do pedido.
- **Frete por distância:** geocodificação do endereço com o OpenStreetMap (Nominatim), frete grátis num raio e cobrança por km acima dele.
- **PIX:** gera o código "copia e cola" do pedido (payload EMV).
- **Leitura de comprovante:** OCR com tesseract.js em imagens e leitura de PDFs para conferir valor, recebedor e data do pagamento.
- **Modo dono:** os donos recebem cada pedido, respondem com comandos ou reações e recebem um resumo diário às 18h (node-cron).
- **Horário de funcionamento:** pedidos só dentro do horário configurado.
- **Painel web:** Express com login (senhas com scrypt), sessões, cabeçalhos de segurança e proteção contra requisições de outra origem; pode ser publicado com um domínio do ngrok.
- **Relatórios:** vendas por produto, faturamento, ranking e previsão de vendas a partir do banco SQLite.

## Tecnologias

- Node.js (ES Modules)
- [Baileys](https://github.com/WhiskeySockets/Baileys) (conexão com o WhatsApp)
- SQLite com better-sqlite3
- Express (painel web)
- node-cron, tesseract.js, unpdf, sharp
- ngrok (link público opcional para o painel)

## Como rodar

Pré-requisitos: Node.js 20+ e um número de WhatsApp só para a loja.

1. Instale as dependências:
   ```
   npm install
   ```
2. Crie um arquivo `.env` na pasta do projeto com as variáveis abaixo.
3. Ligue o bot e escaneie o QR code que aparece no terminal (WhatsApp → Aparelhos conectados → Conectar um aparelho):
   ```
   npm run bot
   ```
   A sessão fica salva na pasta `auth_info/`, então só é preciso escanear de novo se o aparelho for desconectado.
4. Crie uma conta para o painel e ligue-o (em outro terminal):
   ```
   node scripts/usuarios.js criar <login> "<Nome>"
   npm run painel
   ```
   O painel abre em `http://localhost:3000`.

### Variáveis de ambiente

| Variável | Para que serve |
|---|---|
| `NUMERO_DONO`, `NUMERO_DONO_2` | números dos donos (recebem pedidos e o resumo diário) |
| `PIX_CHAVE`, `PIX_NOME_BENEFICIARIO`, `PIX_CIDADE` | dados para gerar a cobrança PIX |
| `ENDERECO_ORIGEM` | endereço de saída das entregas, usado no cálculo do frete |
| `PAINEL_PORTA` | porta do painel (padrão 3000) |
| `PAINEL_DOMINIO`, `NGROK_AUTHTOKEN` | opcionais, para abrir o painel na internet pelo ngrok |

## Estrutura

| Pasta / arquivo | Conteúdo |
|---|---|
| `index.js` | conecta no WhatsApp e encaminha as mensagens |
| `flows/` | conversa com o cliente, interpretação de pedidos, comandos dos donos e leitura de comprovantes |
| `database/` | banco SQLite: catálogo, estoque, vendas, frete, PIX, usuários e relatórios |
| `jobs/` | horário de funcionamento e resumo diário |
| `painel.js`, `painel/` | servidor e telas do painel web |
| `scripts/usuarios.js` | criação e gerenciamento das contas do painel |

## Privacidade

Nenhum dado real vai para o repositório: o `.env`, a sessão do WhatsApp (`auth_info/`), o banco (`*.db`) e os comprovantes dos clientes estão no `.gitignore`.
