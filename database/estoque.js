import db from './db.js';
import { CATALOGO } from './catalogo.js';

db.exec(`
CREATE TABLE IF NOT EXISTS estoque (
  produto_id INTEGER PRIMARY KEY,
  quantidade INTEGER NOT NULL DEFAULT 0
);
`);

// Roda uma vez quando o bot liga: garante que todo produto do catálogo
// tem uma linha de estoque (só cria se ainda não existir, nunca sobrescreve).
export function inicializarEstoque() {
  const inserir = db.prepare(`
    INSERT OR IGNORE INTO estoque (produto_id, quantidade) VALUES (?, ?)
  `);
  for (const produto of CATALOGO) {
    inserir.run(produto.id, produto.estoqueInicial ?? 0);
  }
}

export function consultarEstoque(produtoId) {
  const row = db.prepare('SELECT quantidade FROM estoque WHERE produto_id = ?').get(produtoId);
  return row ? row.quantidade : 0;
}

export function baixarEstoque(produtoId, quantidade = 1) {
  db.prepare('UPDATE estoque SET quantidade = quantidade - ? WHERE produto_id = ?').run(quantidade, produtoId);
}

export function reporEstoque(produtoId, quantidade) {
  db.prepare('UPDATE estoque SET quantidade = quantidade + ? WHERE produto_id = ?').run(quantidade, produtoId);
}

export function listarEstoque() {
  // Mostra só produtos que estão no catálogo atual (ignora restos de testes antigos)
  return CATALOGO.map(produto => ({
    id: produto.id,
    nome: produto.nome,
    quantidade: consultarEstoque(produto.id),
  }));
}

export function formatarEstoque() {
  const itens = listarEstoque();
  let texto = '📦 *Estoque atual*\n\n';
  for (const item of itens) {
    const aviso = item.quantidade <= 0 ? ' ❌ esgotado' : item.quantidade <= 3 ? ' ⚠️ acabando' : '';
    texto += `${item.nome}: *${item.quantidade}* un.${aviso}\n`;
  }
  texto += '\nPra repor: *repor [ticket] [quantidade]* — ex: repor 61 10';
  return texto;
}
