// ============================================================================
// CATÁLOGO DA LOJA — edite só a lista PRODUTOS abaixo.
//
//   ticket  → código interno do produto (NÃO aparece pro cliente). Não pode repetir.
//             Aparece só pra vocês: avisos de pedido, estoque, resumo, "repor".
//   sabor   → nome que o cliente vê
//   preco   → preço em reais (use ponto: 25.00, 32.90...)
//   estoque → quantidade inicial (só vale na 1ª vez que o produto aparece;
//             depois disso o estoque é controlado pelo bot e pelo comando "repor")
//
// Pro cliente, os produtos aparecem numerados como opções (1, 2, 3...), na
// mesma ordem desta lista. Ele pede digitando o número da opção ou o sabor.
// ============================================================================

// Nome da loja que aparece na saudação. Deixe '' (vazio) pra não mostrar nome.
export const NOME_LOJA = '';

const PRODUTOS = [
  { ticket: 61, sabor: 'STRAWBERRY',    preco: 25.00, estoque: 20 },
  { ticket: 62, sabor: 'PINEAPPLE',     preco: 25.00, estoque: 20 },
  { ticket: 63, sabor: 'WATERMELON',    preco: 25.00, estoque: 20 },
  { ticket: 64, sabor: 'GRAPE',         preco: 25.00, estoque: 20 },
  { ticket: 65, sabor: 'MANGO',         preco: 25.00, estoque: 20 },
  { ticket: 66, sabor: 'BLUEBERRY',     preco: 25.00, estoque: 20 },
  { ticket: 67, sabor: 'PASSION FRUIT', preco: 25.00, estoque: 20 },
  { ticket: 68, sabor: 'PEACH',         preco: 25.00, estoque: 20 },
  { ticket: 69, sabor: 'LEMON',         preco: 25.00, estoque: 20 },
  { ticket: 70, sabor: 'KIWI',          preco: 25.00, estoque: 20 },
  { ticket: 71, sabor: 'CHERRY',        preco: 25.00, estoque: 20 },
  { ticket: 72, sabor: 'BANANA',        preco: 25.00, estoque: 20 },
];

// Formato usado pelo resto do bot:
//   id    → ticket (usado no banco, no estoque e nos comandos do dono)
//   opcao → número que o cliente vê e digita (1, 2, 3...)
//   sabor → nome que o cliente vê
//   nome  → nome interno com ticket, usado nas mensagens pro dono
export const CATALOGO = PRODUTOS.map((p, indice) => ({
  id: p.ticket,
  opcao: indice + 1,
  sabor: p.sabor,
  nome: `#TICKET ${p.ticket} - ${p.sabor}`,
  preco: p.preco,
  estoqueInicial: p.estoque,
}));

function formatarPreco(valor) {
  return `R$ ${valor.toFixed(2).replace('.', ',')}`;
}

// Nome do produto pro CLIENTE (sem ticket). O fallback cobre carrinhos antigos.
export function nomeParaCliente(produto) {
  return produto.sabor || produto.nome;
}

/**
 * Monta o catálogo que o cliente vê. Se receber a função de consulta de
 * estoque, marca os produtos esgotados.
 */
export function formatarCatalogo(consultarEstoque = null) {
  let texto = '🛍️ *CATÁLOGO*\n\n';

  for (const p of CATALOGO) {
    const esgotado = consultarEstoque && consultarEstoque(p.id) <= 0;
    texto += esgotado
      ? `~${p.opcao}. ${p.sabor}~ · _esgotado_\n`
      : `*${p.opcao}.* ${p.sabor} · ${formatarPreco(p.preco)}\n`;
  }

  texto += '\n👉 Pra pedir, digite o *número da opção* (ex: *1*) ou o nome do sabor.';
  texto += '\nPode escolher vários, um por mensagem.';
  texto += '\nQuando terminar, digite *fim*.';
  return texto;
}

/**
 * Primeira mensagem da conversa: saudação + catálogo, tudo junto.
 */
export function mensagemBoasVindas(nomeCliente = '', consultarEstoque = null) {
  const primeiroNome = extrairPrimeiroNome(nomeCliente);
  const saudacao = primeiroNome ? `Oi, ${primeiroNome}, tudo bem? 👋` : 'Oi, tudo bem? 👋';
  const loja = NOME_LOJA ? ` à *${NOME_LOJA}*` : '';

  return (
    `${saudacao}\n` +
    `Seja bem-vindo(a)${loja}! Dá uma olhada no nosso catálogo 👇\n\n` +
    formatarCatalogo(consultarEstoque)
  );
}

// Usa só o primeiro nome, e só se parecer um nome de verdade
// (evita "Oi, 🔥🔥, tudo bem?" quando o nome do WhatsApp é só emoji)
function extrairPrimeiroNome(nomeCliente) {
  const primeiro = (nomeCliente || '').trim().split(/\s+/)[0] || '';
  return /^[A-Za-zÀ-ÿ]{2,20}$/.test(primeiro) ? primeiro : '';
}

// Tira acento, deixa minúsculo e sem espaços sobrando, pra comparar texto
function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Descobre qual produto o CLIENTE quis dizer, pelo número da opção ou pelo sabor.
 *   modoEstrito = true  → só aceita se a mensagem for exatamente a opção ou o
 *                         sabor ("1", "opção 1", "strawberry"). Usado na primeira
 *                         mensagem, pra não confundir um "oi" com um pedido.
 *   modoEstrito = false → também aceita o sabor no meio da frase ("quero mango").
 */
export function buscarProduto(entrada, modoEstrito = false) {
  const texto = normalizar(entrada);
  if (!texto) return null;

  // Número da opção: "1", "#1", "opcao 1", "opção 1", "item 1", "nº 1"
  const m = texto.match(/^(?:#|n[o°º]?\.?|opcao|item)?\s*(\d+)$/);
  if (m) {
    const opcao = Number(m[1]);
    return CATALOGO.find(p => p.opcao === opcao) || null;
  }

  // Sabor escrito por extenso (os nomes mais longos primeiro, pra
  // "passion fruit" não ser confundido com um sabor mais curto)
  const porTamanho = [...CATALOGO].sort((a, b) => b.sabor.length - a.sabor.length);
  if (modoEstrito) {
    return porTamanho.find(p => normalizar(p.sabor) === texto) || null;
  }
  return porTamanho.find(p => ` ${texto} `.includes(` ${normalizar(p.sabor)} `)) || null;
}

/**
 * Busca pelo TICKET (uso interno: comandos do dono, como "repor 61 10").
 */
export function buscarProdutoPorTicket(ticket) {
  const numero = Number(ticket);
  return CATALOGO.find(p => p.id === numero) || null;
}