import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, 'loja.db'));

db.pragma('journal_mode = WAL');

// Guarda em que ponto da conversa cada cliente está + o carrinho atual dele
db.exec(`
CREATE TABLE IF NOT EXISTS clientes_estado (
  numero TEXT PRIMARY KEY,
  etapa TEXT NOT NULL DEFAULT 'inicio',
  carrinho TEXT DEFAULT '[]',
  endereco TEXT,
  frete REAL DEFAULT 0,
  frete_confirmado INTEGER DEFAULT 1,
  tentativas_endereco INTEGER DEFAULT 0,
  atualizado_em TEXT DEFAULT (datetime('now'))
);
`);

// Pedidos. As colunas *_enviado / *_notificado marcam se a mensagem
// correspondente REALMENTE saiu. A recuperação automática (que roda sempre
// que o bot conecta) usa esses marcadores pra reenviar o que ficou pela metade.
db.exec(`
CREATE TABLE IF NOT EXISTS pedidos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  numero_cliente TEXT NOT NULL,
  nome_cliente TEXT,
  itens TEXT NOT NULL,
  endereco TEXT NOT NULL,
  frete REAL DEFAULT 0,
  frete_confirmado INTEGER DEFAULT 1,
  status TEXT DEFAULT 'confirmado',
  pix_enviado INTEGER DEFAULT 0,
  dono_notificado INTEGER DEFAULT 0,
  pagamento_notificado INTEGER DEFAULT 0,
  resultado_notificado INTEGER DEFAULT 0,
  criado_em TEXT DEFAULT (datetime('now'))
);
`);

// Atualiza bancos antigos sozinho: se faltar alguma coluna nova, adiciona.
// Assim você não precisa apagar o loja.db quando o código ganhar colunas novas.
function garantirColuna(tabela, coluna, definicao) {
  const colunas = db.prepare(`PRAGMA table_info(${tabela})`).all().map(c => c.name);
  if (!colunas.includes(coluna)) {
    db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${definicao}`);
  }
}
garantirColuna('clientes_estado', 'frete', 'REAL DEFAULT 0');
garantirColuna('clientes_estado', 'frete_confirmado', 'INTEGER DEFAULT 1');
garantirColuna('clientes_estado', 'tentativas_endereco', 'INTEGER DEFAULT 0');
garantirColuna('pedidos', 'frete', 'REAL DEFAULT 0');
garantirColuna('pedidos', 'frete_confirmado', 'INTEGER DEFAULT 1');
garantirColuna('pedidos', 'pix_enviado', 'INTEGER DEFAULT 0');
garantirColuna('pedidos', 'dono_notificado', 'INTEGER DEFAULT 0');
garantirColuna('pedidos', 'pagamento_notificado', 'INTEGER DEFAULT 0');
garantirColuna('pedidos', 'resultado_notificado', 'INTEGER DEFAULT 0');

// --- Funções de acesso ao estado do cliente ---

export function getEstado(numero) {
  const row = db.prepare('SELECT * FROM clientes_estado WHERE numero = ?').get(numero);
  if (!row) return null;
  return { ...row, carrinho: JSON.parse(row.carrinho) };
}

export function criarEstado(numero) {
  db.prepare(`
    INSERT OR REPLACE INTO clientes_estado (numero, etapa, carrinho)
    VALUES (?, 'aguardando_produto', '[]')
  `).run(numero);
}

export function atualizarEstado(numero, campos) {
  const atual = getEstado(numero);
  if (!atual) return; // cliente sem conversa ativa: nada pra atualizar
  const novo = { ...atual, ...campos };
  db.prepare(`
    UPDATE clientes_estado
    SET etapa = ?, carrinho = ?, endereco = ?, frete = ?, frete_confirmado = ?, tentativas_endereco = ?, atualizado_em = datetime('now')
    WHERE numero = ?
  `).run(
    novo.etapa,
    JSON.stringify(novo.carrinho ?? []),
    novo.endereco ?? null,
    novo.frete ?? 0,
    novo.frete_confirmado ?? 1,
    novo.tentativas_endereco ?? 0,
    numero
  );
}

export function resetarEstado(numero) {
  db.prepare('DELETE FROM clientes_estado WHERE numero = ?').run(numero);
}

// Usado pelos testes pra simular um cliente que sumiu por dias
export function envelhecerEstado(numero, horas) {
  db.prepare(`UPDATE clientes_estado SET atualizado_em = datetime('now', ?) WHERE numero = ?`)
    .run(`-${horas} hours`, numero);
}

// --- Funções de pedidos ---

export function salvarPedido({ numero_cliente, nome_cliente, itens, endereco, frete = 0, frete_confirmado = 1, status = 'aguardando_pagamento' }) {
  const resultado = db.prepare(`
    INSERT INTO pedidos (numero_cliente, nome_cliente, itens, endereco, frete, frete_confirmado, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(numero_cliente, nome_cliente, JSON.stringify(itens), endereco, frete, frete_confirmado, status);
  return Number(resultado.lastInsertRowid);
}

export function pedidosDeHoje() {
  return db.prepare(`
    SELECT * FROM pedidos
    WHERE date(criado_em) = date('now')
    ORDER BY criado_em ASC
  `).all().map(p => ({ ...p, itens: JSON.parse(p.itens) }));
}

export function buscarPedidoPorId(id) {
  const row = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(id);
  if (!row) return null;
  return { ...row, itens: JSON.parse(row.itens) };
}

export function buscarPedidosPorStatus(status) {
  return db.prepare('SELECT * FROM pedidos WHERE status = ? ORDER BY id ASC').all(status)
    .map(p => ({ ...p, itens: JSON.parse(p.itens) }));
}

export function atualizarStatusPedido(id, status) {
  db.prepare('UPDATE pedidos SET status = ? WHERE id = ?').run(status, id);
}

export function definirFretePedido(id, frete) {
  db.prepare('UPDATE pedidos SET frete = ?, frete_confirmado = 1 WHERE id = ?').run(frete, id);
}

// Marcadores de "mensagem entregue de verdade"
const COLUNAS_MARCADOR = ['pix_enviado', 'dono_notificado', 'pagamento_notificado', 'resultado_notificado'];

export function marcarPedido(id, coluna, valor = 1) {
  if (!COLUNAS_MARCADOR.includes(coluna)) throw new Error(`Marcador inválido: ${coluna}`);
  db.prepare(`UPDATE pedidos SET ${coluna} = ? WHERE id = ?`).run(valor, id);
}

// Último pedido do cliente: usado pra saber a qual pedido o "paguei" se refere
export function ultimoPedidoDoCliente(numero) {
  const row = db.prepare(`
    SELECT * FROM pedidos
    WHERE numero_cliente = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(numero);
  if (!row) return null;
  return { ...row, itens: JSON.parse(row.itens) };
}

export default db;