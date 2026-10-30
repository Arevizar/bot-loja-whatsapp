export const NOME_LOJA = '';

export const PROMOCAO_ATUAL = '';

export const MINIMO_PEDIDOS_PARA_RANKING = 10;

const PRODUTOS = [
  { ticket: 61, sabor: 'STRAWBERRY',    preco: 25.00, estoque: 20, apelidos: ['morango'] },
  { ticket: 62, sabor: 'PINEAPPLE',     preco: 25.00, estoque: 20, apelidos: ['abacaxi'] },
  { ticket: 63, sabor: 'WATERMELON',    preco: 25.00, estoque: 20, apelidos: ['melancia'] },
  { ticket: 64, sabor: 'GRAPE',         preco: 25.00, estoque: 20, apelidos: ['uva'] },
  { ticket: 65, sabor: 'MANGO',         preco: 25.00, estoque: 20, apelidos: ['manga'] },
  { ticket: 66, sabor: 'BLUEBERRY',     preco: 25.00, estoque: 20, apelidos: ['mirtilo'] },
  { ticket: 67, sabor: 'PASSION FRUIT', preco: 25.00, estoque: 20, apelidos: ['maracuja', 'passion'] },
  { ticket: 68, sabor: 'PEACH',         preco: 25.00, estoque: 20, apelidos: ['pessego'] },
  { ticket: 69, sabor: 'LEMON',         preco: 25.00, estoque: 20, apelidos: ['limao'] },
  { ticket: 70, sabor: 'KIWI',          preco: 25.00, estoque: 20, apelidos: [] },
  { ticket: 71, sabor: 'CHERRY',        preco: 25.00, estoque: 20, apelidos: ['cereja'] },
  { ticket: 72, sabor: 'BANANA',        preco: 25.00, estoque: 20, apelidos: [] },
];

export const CATALOGO = PRODUTOS.map((p, indice) => ({
  id: p.ticket,
  opcao: indice + 1,
  sabor: p.sabor,
  nome: `#TICKET ${p.ticket} - ${p.sabor}`,
  preco: p.preco,
  estoqueInicial: p.estoque,
  apelidos: p.apelidos ?? [],
}));

export function formatarPreco(valor) {
  return `R$ ${Number(valor).toFixed(2).replace('.', ',')}`;
}

export function nomeParaCliente(produto) {
  return produto.sabor || produto.nome;
}

export function formatarCatalogo(consultarEstoque = null) {
  let texto = '🛍️ *CATÁLOGO*\n\n';

  for (const p of CATALOGO) {
    const esgotado = consultarEstoque && consultarEstoque(p.id) <= 0;
    texto += esgotado
      ? `~${p.opcao}. ${p.sabor}~ · _esgotado_\n`
      : `*${p.opcao}.* ${p.sabor} · ${formatarPreco(p.preco)}\n`;
  }

  texto += `\n${comoPedirComExemplos()}`;
  return texto;
}

const EXEMPLO_PRINCIPAL = CATALOGO[Math.min(4, CATALOGO.length - 1)];
const EXEMPLO_SEGUNDO = CATALOGO[0];

export const COMO_PEDIR = EXEMPLO_SEGUNDO === EXEMPLO_PRINCIPAL
  ? `Mande o *número* do sabor que você quer (ex: *${EXEMPLO_PRINCIPAL.opcao}*).`
  : `Mande o *número* do sabor que você quer (ex: *${EXEMPLO_PRINCIPAL.opcao}*). Pra pedir mais de um, mande junto: *${EXEMPLO_SEGUNDO.opcao} e ${EXEMPLO_PRINCIPAL.opcao}*.`;

export const PROXIMO_PASSO = '➕ Quer mais? Mande o número do sabor.\n↩️ Mudou de ideia? Mande *remover*\n✅ Terminou? Mande *fim*';

function comoPedirComExemplos() {
  const a = EXEMPLO_PRINCIPAL;
  const b = EXEMPLO_SEGUNDO;
  const linhas = ['👉 *Como pedir:* mande o número do sabor'];
  linhas.push(`• *${a.opcao}* → 1 ${a.sabor}`);
  if (b !== a) linhas.push(`• *${b.opcao} e ${a.opcao}* → 1 ${b.sabor} e 1 ${a.sabor}`);
  linhas.push(`• *2 ${a.sabor.toLowerCase()}* → 2 ${a.sabor}`);
  linhas.push('');
  linhas.push('↩️ Mudou de ideia? Mande *remover*');
  linhas.push('✅ Terminou? Mande *fim*');
  return linhas.join('\n');
}

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

function extrairPrimeiroNome(nomeCliente) {
  const primeiro = (nomeCliente || '').trim().split(/\s+/)[0] || '';
  return /^[A-Za-zÀ-ÿ]{2,20}$/.test(primeiro) ? primeiro : '';
}

export function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

export function buscarProduto(entrada, modoEstrito = false) {
  const texto = normalizar(entrada);
  if (!texto) return null;

  const m = texto.match(/^(?:#|n[o°º]?\.?|opcao|item)?\s*(\d+)$/);
  if (m) {
    const opcao = Number(m[1]);
    return CATALOGO.find(p => p.opcao === opcao) || null;
  }

  const porTamanho = [...CATALOGO].sort((a, b) => b.sabor.length - a.sabor.length);
  if (modoEstrito) {
    return porTamanho.find(p => normalizar(p.sabor) === texto) || null;
  }
  return porTamanho.find(p => ` ${texto} `.includes(` ${normalizar(p.sabor)} `)) || null;
}

export function buscarProdutoPorTicket(ticket) {
  const numero = Number(ticket);
  return CATALOGO.find(p => p.id === numero) || null;
}
