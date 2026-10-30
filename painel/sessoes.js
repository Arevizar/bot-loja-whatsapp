import crypto from 'node:crypto';
import db from '../database/db.js';

export const MINUTOS_INATIVIDADE = 120;
export const HORAS_MAXIMAS = 12;

db.exec(`
CREATE TABLE IF NOT EXISTS sessoes (
  id TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL,
  versao_sessao INTEGER NOT NULL,
  csrf TEXT NOT NULL,
  ip TEXT,
  navegador TEXT,
  criada_em TEXT NOT NULL DEFAULT (datetime('now')),
  ultimo_uso_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessoes_usuario ON sessoes (usuario_id);
`);

const impressaoDigital = (token) => crypto.createHash('sha256').update(token).digest('hex');

export function criarSessao(usuarioId, { ip = null, navegador = null } = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(24).toString('base64url');
  const { changes } = db.prepare(`
    INSERT INTO sessoes (id, usuario_id, versao_sessao, csrf, ip, navegador)
    SELECT ?, id, versao_sessao, ?, ?, ? FROM usuarios WHERE id = ?
  `).run(impressaoDigital(token), csrf, ip, String(navegador ?? '').slice(0, 200), usuarioId);
  if (!changes) throw new Error(`Conta ${usuarioId} não existe`);
  return token;
}

export function validarSessao(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const id = impressaoDigital(token);

  const linha = db.prepare(`
    SELECT s.id, s.csrf, s.ultimo_uso_em,
           u.id AS usuario_id, u.login, u.nome, u.papel,
           (u.ativo = 1
             AND s.versao_sessao = u.versao_sessao
             AND s.ultimo_uso_em > datetime('now', ?)
             AND s.criada_em > datetime('now', ?)) AS valida,
           (s.ultimo_uso_em < datetime('now', '-1 minute')) AS atualizar_uso
    FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
    WHERE s.id = ?
  `).get(`-${MINUTOS_INATIVIDADE} minutes`, `-${HORAS_MAXIMAS} hours`, id);

  if (!linha) return null;
  if (!linha.valida) {
    encerrarSessaoPorId(id);
    return null;
  }

  if (linha.atualizar_uso) {
    db.prepare(`UPDATE sessoes SET ultimo_uso_em = datetime('now') WHERE id = ?`).run(id);
  }

  return {
    csrf: linha.csrf,
    usuario: { id: linha.usuario_id, login: linha.login, nome: linha.nome, papel: linha.papel },
  };
}

function encerrarSessaoPorId(id) {
  db.prepare('DELETE FROM sessoes WHERE id = ?').run(id);
}

export function encerrarSessao(token) {
  if (typeof token === 'string' && token) encerrarSessaoPorId(impressaoDigital(token));
}

export function encerrarSessoesDoUsuario(usuarioId) {
  return db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(usuarioId).changes;
}

export function limparSessoesVencidas() {
  return db.prepare(`
    DELETE FROM sessoes
    WHERE ultimo_uso_em <= datetime('now', ?)
       OR criada_em <= datetime('now', ?)
       OR usuario_id NOT IN (SELECT id FROM usuarios WHERE ativo = 1)
       OR versao_sessao <> (SELECT versao_sessao FROM usuarios WHERE id = sessoes.usuario_id)
  `).run(`-${MINUTOS_INATIVIDADE} minutes`, `-${HORAS_MAXIMAS} hours`).changes;
}