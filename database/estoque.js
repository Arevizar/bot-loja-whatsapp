import db, { transacao } from './db.js';
import { CATALOGO, buscarProdutoPorTicket } from './catalogo.js';

db.exec(`
CREATE TABLE IF NOT EXISTS estoque (
  produto_id INTEGER PRIMARY KEY,
  quantidade INTEGER NOT NULL DEFAULT 0
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS movimentacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id INTEGER NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('entrada', 'saida')),
  quantidade INTEGER NOT NULL CHECK (quantidade > 0),
  motivo TEXT NOT NULL,
  pedido_id INTEGER,
  usuario TEXT NOT NULL,
  observacao TEXT,
  saldo_apos INTEGER NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_movimentacoes_produto ON movimentacoes (produto_id, criado_em);
CREATE INDEX IF NOT EXISTS idx_movimentacoes_data ON movimentacoes (criado_em);
`);

export const USUARIO_BOT = 'bot';
export const USUARIO_DONO_WHATSAPP = 'dono (WhatsApp)';
export const USUARIO_SISTEMA = 'sistema';

export const MOTIVOS = {
  saldo_inicial: 'Saldo inicial',
  reposicao: 'Reposição',
  venda_bot: 'Venda pelo WhatsApp',
  pagamento_recusado: 'Pagamento recusado (estoque devolvido)',
  cancelado_cliente: 'Pedido cancelado pelo cliente (estoque devolvido)',
  recusa_desfeita: 'Recusa desfeita (venda reativada)',
  baixa_manual: 'Baixa manual',
  ajuste: 'Ajuste de contagem',
};

export function consultarEstoque(produtoId) {
  const row = db.prepare('SELECT quantidade FROM estoque WHERE produto_id = ?').get(produtoId);
  return row ? row.quantidade : 0;
}

const inserirMovimento = db.prepare(`
  INSERT INTO movimentacoes (produto_id, tipo, quantidade, motivo, pedido_id, usuario, observacao, saldo_apos)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const movimentar = transacao(({ produtoId, tipo, quantidade, motivo, pedidoId = null, usuario, observacao = null }) => {
  if (!Number.isInteger(produtoId)) throw new Error(`Produto inválido: ${produtoId}`);
  if (tipo !== 'entrada' && tipo !== 'saida') throw new Error(`Tipo de movimento inválido: ${tipo}`);
  if (!Number.isInteger(quantidade) || quantidade <= 0) throw new Error(`Quantidade inválida: ${quantidade}`);
  if (!(motivo in MOTIVOS)) throw new Error(`Motivo inválido: ${motivo}`);
  if (!usuario) throw new Error('Movimento sem usuário');

  const delta = tipo === 'entrada' ? quantidade : -quantidade;
  const resultado = db.prepare('UPDATE estoque SET quantidade = quantidade + ? WHERE produto_id = ?').run(delta, produtoId);
  if (resultado.changes === 0) {
    db.prepare('INSERT INTO estoque (produto_id, quantidade) VALUES (?, ?)').run(produtoId, delta);
  }

  const saldo = consultarEstoque(produtoId);
  inserirMovimento.run(produtoId, tipo, quantidade, motivo, pedidoId, usuario, observacao, saldo);
  return saldo;
});

export const inicializarEstoque = transacao(() => {
  const inserir = db.prepare('INSERT OR IGNORE INTO estoque (produto_id, quantidade) VALUES (?, ?)');
  for (const produto of CATALOGO) {
    inserir.run(produto.id, produto.estoqueInicial ?? 0);
  }

  const semHistorico = db.prepare(`
    SELECT e.produto_id, e.quantidade FROM estoque e
    WHERE e.quantidade <> 0
      AND NOT EXISTS (SELECT 1 FROM movimentacoes m WHERE m.produto_id = e.produto_id)
  `).all();

  for (const { produto_id, quantidade } of semHistorico) {
    inserirMovimento.run(
      produto_id, quantidade > 0 ? 'entrada' : 'saida', Math.abs(quantidade),
      'saldo_inicial', null, USUARIO_SISTEMA, null, quantidade
    );
  }
});

export function baixarEstoque(produtoId, quantidade = 1, { motivo = 'venda_bot', pedidoId = null, usuario = USUARIO_BOT, observacao = null } = {}) {
  return movimentar({ produtoId, tipo: 'saida', quantidade, motivo, pedidoId, usuario, observacao });
}

export function reporEstoque(produtoId, quantidade, { motivo = 'reposicao', pedidoId = null, usuario = USUARIO_DONO_WHATSAPP, observacao = null } = {}) {
  return movimentar({ produtoId, tipo: 'entrada', quantidade, motivo, pedidoId, usuario, observacao });
}

function validarOperacao(produtoId, quantidade, usuario) {
  if (!buscarProdutoPorTicket(produtoId)) return 'produto_inexistente';
  if (!Number.isInteger(quantidade) || quantidade <= 0) return 'quantidade_invalida';
  if (!usuario) return 'usuario_obrigatorio';
  return null;
}

export const darBaixaManual = transacao(({ produtoId, quantidade, usuario, observacao = null }) => {
  const erro = validarOperacao(produtoId, quantidade, usuario);
  if (erro) return { ok: false, erro };

  const disponivel = consultarEstoque(produtoId);
  if (disponivel < quantidade) return { ok: false, erro: 'estoque_insuficiente', disponivel };

  const saldo = movimentar({ produtoId, tipo: 'saida', quantidade, motivo: 'baixa_manual', usuario, observacao });
  return { ok: true, saldo };
});

export const registrarEntrada = transacao(({ produtoId, quantidade, usuario, observacao = null }) => {
  const erro = validarOperacao(produtoId, quantidade, usuario);
  if (erro) return { ok: false, erro };

  const saldo = movimentar({ produtoId, tipo: 'entrada', quantidade, motivo: 'reposicao', usuario, observacao });
  return { ok: true, saldo };
});

export const ajustarEstoque = transacao(({ produtoId, novaQuantidade, usuario, observacao = null }) => {
  if (!buscarProdutoPorTicket(produtoId)) return { ok: false, erro: 'produto_inexistente' };
  if (!Number.isInteger(novaQuantidade) || novaQuantidade < 0) return { ok: false, erro: 'quantidade_invalida' };
  if (!usuario) return { ok: false, erro: 'usuario_obrigatorio' };

  const atual = consultarEstoque(produtoId);
  const diferenca = novaQuantidade - atual;
  if (diferenca === 0) return { ok: true, saldo: atual, semMudanca: true };

  const saldo = movimentar({
    produtoId,
    tipo: diferenca > 0 ? 'entrada' : 'saida',
    quantidade: Math.abs(diferenca),
    motivo: 'ajuste',
    usuario,
    observacao,
  });
  return { ok: true, saldo };
});

function nomeDoProduto(produtoId) {
  return buscarProdutoPorTicket(produtoId)?.nome ?? `#TICKET ${produtoId} (fora do catálogo)`;
}

export function listarMovimentacoes({ produtoId = null, tipo = null, de = null, ate = null, limite = 200 } = {}) {
  const condicoes = [];
  const parametros = [];

  if (produtoId !== null) { condicoes.push('produto_id = ?'); parametros.push(produtoId); }
  if (tipo !== null) { condicoes.push('tipo = ?'); parametros.push(tipo); }
  if (de !== null) { condicoes.push(`date(criado_em, 'localtime') >= ?`); parametros.push(de); }
  if (ate !== null) { condicoes.push(`date(criado_em, 'localtime') <= ?`); parametros.push(ate); }

  const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
  const linhas = db.prepare(`
    SELECT *, datetime(criado_em, 'localtime') AS criado_em_local
    FROM movimentacoes ${where}
    ORDER BY id DESC
    LIMIT ?
  `).all(...parametros, Math.min(Math.max(Number(limite) || 200, 1), 5000));

  return linhas.map(m => ({
    ...m,
    produto: nomeDoProduto(m.produto_id),
    motivoTexto: MOTIVOS[m.motivo] ?? m.motivo,
  }));
}

export function resumoMovimentacoes({ de = null, ate = null } = {}) {
  const condicoes = [];
  const parametros = [];
  if (de !== null) { condicoes.push(`date(criado_em, 'localtime') >= ?`); parametros.push(de); }
  if (ate !== null) { condicoes.push(`date(criado_em, 'localtime') <= ?`); parametros.push(ate); }
  const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';

  return db.prepare(`
    SELECT produto_id,
           SUM(CASE WHEN tipo = 'entrada' THEN quantidade ELSE 0 END) AS entradas,
           SUM(CASE WHEN tipo = 'saida' THEN quantidade ELSE 0 END) AS saidas
    FROM movimentacoes ${where}
    GROUP BY produto_id
    ORDER BY produto_id
  `).all(...parametros).map(r => ({ ...r, produto: nomeDoProduto(r.produto_id) }));
}

export function conferirHistorico() {
  return db.prepare(`
    SELECT e.produto_id, e.quantidade AS estoque,
           COALESCE(SUM(CASE WHEN m.tipo = 'entrada' THEN m.quantidade ELSE -m.quantidade END), 0) AS pelo_historico
    FROM estoque e
    LEFT JOIN movimentacoes m ON m.produto_id = e.produto_id
    GROUP BY e.produto_id
    HAVING estoque <> pelo_historico
  `).all();
}

export function listarEstoque() {
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
