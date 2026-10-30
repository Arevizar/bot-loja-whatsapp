import crypto from 'node:crypto';
import { promisify } from 'node:util';
import db from './db.js';

db.exec(`
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  login TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL,
  senha_hash TEXT NOT NULL,
  papel TEXT NOT NULL DEFAULT 'total',
  ativo INTEGER NOT NULL DEFAULT 1,
  tentativas_falhas INTEGER NOT NULL DEFAULT 0,
  bloqueado_ate TEXT,
  ultimo_login_em TEXT,
  senha_alterada_em TEXT NOT NULL DEFAULT (datetime('now')),
  versao_sessao INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

export const PAPEIS = {
  total: 'Acesso total',
};

export const MAX_TENTATIVAS = 5;
export const MINUTOS_BLOQUEIO = 15;

const SCRYPT = { N: 16384, r: 8, p: 5, tamanho: 64 };
const scryptAsync = promisify(crypto.scrypt);

export const MENSAGENS_ERRO = {
  login_invalido: 'O login deve ter de 3 a 30 caracteres: letras minúsculas sem acento, números, ponto, traço ou _.',
  nome_invalido: 'O nome deve ter de 1 a 60 caracteres.',
  papel_invalido: 'Tipo de acesso inválido.',
  senha_curta: 'A senha precisa ter pelo menos 8 caracteres.',
  senha_longa: 'A senha pode ter no máximo 128 caracteres.',
  senha_igual_login: 'A senha não pode ser igual ao login.',
  senha_fraca: 'Essa senha é fácil demais de adivinhar. Escolha outra.',
  login_existente: 'Já existe uma conta com esse login.',
  usuario_inexistente: 'Não existe conta com esse login.',
  credenciais_invalidas: 'Login ou senha incorretos.',
  bloqueado: `Muitas tentativas erradas. Tente de novo em ${MINUTOS_BLOQUEIO} minutos.`,
};

const SENHAS_OBVIAS = new Set([
  '12345678', '123456789', '1234567890', '87654321', '11111111', '00000000',
  'senha123', 'senha1234', 'password', 'password1', 'qwertyui', 'qwerty123',
  'abcdefgh', 'abc12345', 'mudar123', 'admin123', 'loja1234', 'iloveyou',
]);

export function normalizarLogin(login) {
  return String(login ?? '').trim().toLowerCase();
}

function validarLogin(login) {
  return /^[a-z0-9._-]{3,30}$/.test(login) ? null : 'login_invalido';
}

export function validarSenha(senha, login = '') {
  if (typeof senha !== 'string' || senha.length < 8) return 'senha_curta';
  if (senha.length > 128) return 'senha_longa';
  if (senha.toLowerCase() === normalizarLogin(login)) return 'senha_igual_login';
  if (SENHAS_OBVIAS.has(senha.toLowerCase()) || /^(.)\1+$/.test(senha)) return 'senha_fraca';
  return null;
}

async function gerarHash(senha) {
  const { N, r, p, tamanho } = SCRYPT;
  const sal = crypto.randomBytes(16);
  const hash = await scryptAsync(senha.normalize('NFC'), sal, tamanho, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${sal.toString('base64')}$${hash.toString('base64')}`;
}

async function conferirHash(senha, guardado) {
  const partes = String(guardado).split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false;
  const [N, r, p] = partes.slice(1, 4).map(Number);
  if (![N, r, p].every(Number.isInteger) || N < 1024 || N > 1048576 || r < 1 || r > 32 || p < 1 || p > 16) return false;

  const sal = Buffer.from(partes[4], 'base64');
  const esperado = Buffer.from(partes[5], 'base64');
  if (esperado.length < 32) return false;

  const calculado = await scryptAsync(String(senha).normalize('NFC'), sal, esperado.length, {
    N, r, p, maxmem: 256 * 1024 * 1024,
  });
  return crypto.timingSafeEqual(calculado, esperado);
}

function precisaAtualizarHash(guardado) {
  const [, N, r, p] = String(guardado).split('$').map(Number);
  return N < SCRYPT.N || r < SCRYPT.r || p < SCRYPT.p;
}

let hashFalso = null;
async function obterHashFalso() {
  hashFalso ??= await gerarHash(crypto.randomBytes(24).toString('base64'));
  return hashFalso;
}

const CAMPOS_PUBLICOS = `
  id, login, nome, papel, ativo, tentativas_falhas, senha_alterada_em, criado_em,
  datetime(bloqueado_ate, 'localtime') AS bloqueado_ate,
  datetime(ultimo_login_em, 'localtime') AS ultimo_login_em,
  (bloqueado_ate IS NOT NULL AND bloqueado_ate > datetime('now')) AS bloqueado
`;

export function listarUsuarios() {
  return db.prepare(`SELECT ${CAMPOS_PUBLICOS} FROM usuarios ORDER BY id`).all();
}

export function buscarUsuario(login) {
  return db.prepare(`SELECT ${CAMPOS_PUBLICOS} FROM usuarios WHERE login = ?`).get(normalizarLogin(login)) ?? null;
}

export function buscarUsuarioPorId(id) {
  return db.prepare(`SELECT ${CAMPOS_PUBLICOS} FROM usuarios WHERE id = ?`).get(id) ?? null;
}

export async function criarUsuario({ login, nome, senha, papel = 'total' }) {
  login = normalizarLogin(login);
  nome = String(nome ?? '').trim();

  const erro = validarLogin(login)
    ?? (nome.length < 1 || nome.length > 60 ? 'nome_invalido' : null)
    ?? (papel in PAPEIS ? null : 'papel_invalido')
    ?? validarSenha(senha, login);
  if (erro) return { ok: false, erro };

  if (buscarUsuario(login)) return { ok: false, erro: 'login_existente' };

  const senhaHash = await gerarHash(senha);
  try {
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO usuarios (login, nome, senha_hash, papel) VALUES (?, ?, ?, ?)'
    ).run(login, nome, senhaHash, papel);
    return { ok: true, id: Number(lastInsertRowid) };
  } catch (e) {
    if (String(e.code).startsWith('SQLITE_CONSTRAINT')) return { ok: false, erro: 'login_existente' };
    throw e;
  }
}

export async function alterarSenha(login, novaSenha) {
  login = normalizarLogin(login);
  if (!buscarUsuario(login)) return { ok: false, erro: 'usuario_inexistente' };

  const erro = validarSenha(novaSenha, login);
  if (erro) return { ok: false, erro };

  const senhaHash = await gerarHash(novaSenha);
  db.prepare(`
    UPDATE usuarios
    SET senha_hash = ?, senha_alterada_em = datetime('now'), versao_sessao = versao_sessao + 1,
        tentativas_falhas = 0, bloqueado_ate = NULL
    WHERE login = ?
  `).run(senhaHash, login);
  return { ok: true };
}

export function definirAtivo(login, ativo) {
  const { changes } = db.prepare('UPDATE usuarios SET ativo = ? WHERE login = ?').run(ativo ? 1 : 0, normalizarLogin(login));
  return changes ? { ok: true } : { ok: false, erro: 'usuario_inexistente' };
}

export function desbloquear(login) {
  const { changes } = db.prepare(
    'UPDATE usuarios SET tentativas_falhas = 0, bloqueado_ate = NULL WHERE login = ?'
  ).run(normalizarLogin(login));
  return changes ? { ok: true } : { ok: false, erro: 'usuario_inexistente' };
}

export async function verificarLogin(login, senha) {
  login = normalizarLogin(login);
  const linha = /^[a-z0-9._-]{3,30}$/.test(login)
    ? db.prepare(`
        SELECT id, senha_hash, ativo, (bloqueado_ate IS NOT NULL AND bloqueado_ate > datetime('now')) AS bloqueado
        FROM usuarios WHERE login = ?
      `).get(login)
    : null;

  if (typeof senha !== 'string' || senha.length === 0 || senha.length > 128) {
    return { ok: false, erro: 'credenciais_invalidas' };
  }

  if (!linha) {
    await conferirHash(senha, await obterHashFalso());
    return { ok: false, erro: 'credenciais_invalidas' };
  }

  if (linha.bloqueado) return { ok: false, erro: 'bloqueado' };

  const senhaCerta = await conferirHash(senha, linha.senha_hash);

  if (!senhaCerta || !linha.ativo) {
    if (!senhaCerta) {
      const { tentativas_falhas } = db.prepare(`
        UPDATE usuarios SET tentativas_falhas = tentativas_falhas + 1 WHERE id = ? RETURNING tentativas_falhas
      `).get(linha.id);
      if (tentativas_falhas >= MAX_TENTATIVAS) {
        db.prepare(`
          UPDATE usuarios SET tentativas_falhas = 0, bloqueado_ate = datetime('now', ?) WHERE id = ?
        `).run(`+${MINUTOS_BLOQUEIO} minutes`, linha.id);
        return { ok: false, erro: 'bloqueado' };
      }
    }
    return { ok: false, erro: 'credenciais_invalidas' };
  }

  db.prepare(`
    UPDATE usuarios SET tentativas_falhas = 0, bloqueado_ate = NULL, ultimo_login_em = datetime('now') WHERE id = ?
  `).run(linha.id);

  if (precisaAtualizarHash(linha.senha_hash)) {
    db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(await gerarHash(senha), linha.id);
  }

  return { ok: true, usuario: buscarUsuarioPorId(linha.id) };
}