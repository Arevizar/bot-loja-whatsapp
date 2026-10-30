import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from './db.js';

export const PASTA_COMPROVANTES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'comprovantes');

db.exec(`
CREATE TABLE IF NOT EXISTS comprovantes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id INTEGER NOT NULL,
  numero_cliente TEXT,
  nome_cliente TEXT,
  arquivo TEXT,
  tipo_arquivo TEXT,
  valor REAL,
  pagador TEXT,
  banco_pagador TEXT,
  recebedor TEXT,
  banco_recebedor TEXT,
  data_pagamento TEXT,
  hora_pagamento TEXT,
  id_transacao TEXT,
  valor_confere INTEGER,
  recebedor_confere INTEGER,
  data_confere INTEGER,
  duplicado_do_pedido INTEGER,
  leu_o_comprovante INTEGER NOT NULL DEFAULT 0,
  texto_lido TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comprovantes_pedido ON comprovantes (pedido_id);
CREATE INDEX IF NOT EXISTS idx_comprovantes_transacao ON comprovantes (id_transacao);

CREATE TABLE IF NOT EXISTS avisos_dono (
  mensagem_id TEXT PRIMARY KEY,
  pedido_id INTEGER NOT NULL,
  tipo TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

const EXTENSOES = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic',
  'application/pdf': 'pdf',
};

export const TIPOS_DE_ARQUIVO = Object.fromEntries(Object.entries(EXTENSOES).map(([tipo, ext]) => [ext, tipo]));

export function salvarArquivoComprovante(pedidoId, buffer, tipo) {
  fs.mkdirSync(PASTA_COMPROVANTES, { recursive: true });
  const extensao = EXTENSOES[tipo] || 'jpg';
  const nome = `pedido-${pedidoId}-${Date.now()}.${extensao}`;
  fs.writeFileSync(path.join(PASTA_COMPROVANTES, nome), buffer);
  return nome;
}

export function caminhoDoArquivo(nome) {
  if (typeof nome !== 'string' || !/^pedido-\d+-\d+\.[a-z]{3,4}$/.test(nome)) return null;
  const caminho = path.join(PASTA_COMPROVANTES, nome);
  return fs.existsSync(caminho) ? caminho : null;
}

export function registrarComprovante(dados) {
  const campos = [
    'pedido_id', 'numero_cliente', 'nome_cliente', 'arquivo', 'tipo_arquivo', 'valor', 'pagador', 'banco_pagador',
    'recebedor', 'banco_recebedor', 'data_pagamento', 'hora_pagamento', 'id_transacao', 'valor_confere',
    'recebedor_confere', 'data_confere', 'duplicado_do_pedido', 'leu_o_comprovante', 'texto_lido',
  ];
  const valores = campos.map(c => {
    const v = dados[c];
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v ?? null;
  });
  const { lastInsertRowid } = db.prepare(
    `INSERT INTO comprovantes (${campos.join(', ')}) VALUES (${campos.map(() => '?').join(', ')})`
  ).run(...valores);
  return Number(lastInsertRowid);
}

export function comprovanteRepetido({ idTransacao, pagador, valor, data, hora }) {
  if (idTransacao) {
    const porId = db.prepare(
      'SELECT id, pedido_id FROM comprovantes WHERE id_transacao = ? AND duplicado_do_pedido IS NULL ORDER BY id LIMIT 1'
    ).get(idTransacao);
    if (porId) return porId;
  }
  if (pagador && valor != null && data && hora) {
    const porDados = db.prepare(`
      SELECT id, pedido_id FROM comprovantes
      WHERE lower(pagador) = lower(?) AND abs(valor - ?) < 0.005 AND data_pagamento = ? AND hora_pagamento = ?
        AND duplicado_do_pedido IS NULL
      ORDER BY id LIMIT 1
    `).get(pagador, valor, data, hora);
    if (porDados) return porDados;
  }
  return null;
}

export function somaDosComprovantes(pedidoId) {
  const linha = db.prepare(`
    SELECT COUNT(*) AS quantos, COALESCE(SUM(valor), 0) AS soma, SUM(CASE WHEN valor IS NULL THEN 1 ELSE 0 END) AS sem_valor
    FROM comprovantes WHERE pedido_id = ? AND duplicado_do_pedido IS NULL
  `).get(pedidoId);
  return { quantos: linha.quantos, soma: Math.round(linha.soma * 100) / 100, semValor: linha.sem_valor || 0 };
}

export function ultimoComprovanteDoPedido(pedidoId) {
  return db.prepare('SELECT * FROM comprovantes WHERE pedido_id = ? AND duplicado_do_pedido IS NULL ORDER BY id DESC LIMIT 1').get(pedidoId) ?? null;
}

export function comprovantesDosPedidos(ids) {
  const lista = [...new Set(ids.filter(Number.isInteger))];
  if (!lista.length) return new Map();
  const linhas = db.prepare(`
    SELECT id, pedido_id, valor, pagador, banco_pagador, recebedor, data_pagamento, hora_pagamento, id_transacao,
           valor_confere, recebedor_confere, data_confere, duplicado_do_pedido, leu_o_comprovante, arquivo, tipo_arquivo,
           datetime(criado_em, 'localtime') AS recebido_em
    FROM comprovantes WHERE pedido_id IN (${lista.map(() => '?').join(', ')})
    ORDER BY id
  `).all(...lista);
  const mapa = new Map();
  for (const l of linhas) {
    if (!mapa.has(l.pedido_id)) mapa.set(l.pedido_id, []);
    mapa.get(l.pedido_id).push(l);
  }
  return mapa;
}

export function buscarComprovante(id) {
  return db.prepare('SELECT * FROM comprovantes WHERE id = ?').get(id) ?? null;
}

export function registrarAvisoDono(mensagemId, pedidoId, tipo) {
  if (!mensagemId || !pedidoId) return;
  db.prepare('INSERT OR REPLACE INTO avisos_dono (mensagem_id, pedido_id, tipo) VALUES (?, ?, ?)').run(mensagemId, pedidoId, tipo);
}

export function avisoDono(mensagemId) {
  if (!mensagemId) return null;
  return db.prepare('SELECT pedido_id, tipo FROM avisos_dono WHERE mensagem_id = ?').get(mensagemId) ?? null;
}
