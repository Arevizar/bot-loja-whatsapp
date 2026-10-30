import crypto from 'node:crypto';
import { validarSessao } from './sessoes.js';

export const NOME_COOKIE = 'painel_sessao';

export function cabecalhosDeSeguranca(req, res, next) {
  res.set({
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  });
  next();
}

export function exigirEnderecoConhecido(enderecosPermitidos) {
  const permitidos = new Set(enderecosPermitidos.map(e => e.toLowerCase()));
  return (req, res, next) => {
    const host = String(req.headers.host ?? '').toLowerCase();
    if (!permitidos.has(host)) {
      return res.status(421).type('text/plain').send('Endereço não permitido.');
    }
    next();
  };
}

export function lerCookie(req, nome) {
  const cabecalho = req.headers.cookie;
  if (!cabecalho) return null;
  for (const parte of cabecalho.split(';')) {
    const i = parte.indexOf('=');
    if (i === -1) continue;
    if (parte.slice(0, i).trim() === nome) {
      try { return decodeURIComponent(parte.slice(i + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

export function gravarCookieSessao(req, res, token) {
  res.cookie(NOME_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: req.secure,
    path: '/',
  });
}

export function apagarCookieSessao(req, res) {
  res.clearCookie(NOME_COOKIE, { httpOnly: true, sameSite: 'strict', secure: req.secure, path: '/' });
}

export function carregarSessao(req, res, next) {
  const token = lerCookie(req, NOME_COOKIE);
  req.tokenSessao = token;
  req.sessao = token ? validarSessao(token) : null;
  if (token && !req.sessao) apagarCookieSessao(req, res);
  next();
}

export function exigirLoginPagina(req, res, next) {
  if (!req.sessao) return res.redirect(303, '/entrar');
  next();
}

export function exigirLoginApi(req, res, next) {
  if (!req.sessao) return res.status(401).json({ erro: 'sessao_expirada', mensagem: 'Sua sessão terminou. Entre de novo.' });
  next();
}

export function exigirMesmaOrigem(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();

  const origem = req.headers.origin;
  const esperada = `${req.protocol}://${req.headers.host}`;
  const mesmaOrigem = origem
    ? origem === esperada
    : req.headers['sec-fetch-site'] === 'same-origin';

  if (!mesmaOrigem) return res.status(403).json({ erro: 'origem_invalida', mensagem: 'Envio recusado.' });
  if (!req.is('application/json')) return res.status(415).json({ erro: 'formato_invalido', mensagem: 'Envio recusado.' });
  next();
}

export function exigirCodigoCsrf(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const recebido = Buffer.from(String(req.headers['x-csrf-token'] ?? ''));
  const esperado = Buffer.from(req.sessao?.csrf ?? '');
  if (!esperado.length || recebido.length !== esperado.length || !crypto.timingSafeEqual(recebido, esperado)) {
    return res.status(403).json({ erro: 'csrf_invalido', mensagem: 'Recarregue a página e tente de novo.' });
  }
  next();
}

const MAX_ERROS_POR_IP = 10;
const JANELA_MS = 15 * 60 * 1000;
const errosPorIp = new Map();

function errosRecentes(ip) {
  const agora = Date.now();
  const lista = (errosPorIp.get(ip) ?? []).filter(t => agora - t < JANELA_MS);
  if (lista.length) errosPorIp.set(ip, lista); else errosPorIp.delete(ip);
  return lista;
}

export function ipBloqueado(ip) {
  return errosRecentes(ip).length >= MAX_ERROS_POR_IP;
}

export function registrarErroDeLogin(ip) {
  const lista = errosRecentes(ip);
  lista.push(Date.now());
  errosPorIp.set(ip, lista);
}

export function limparErrosDeLogin(ip) {
  errosPorIp.delete(ip);
}