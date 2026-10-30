import { Router } from 'express';
import { verificarLogin, MENSAGENS_ERRO } from '../../database/usuarios.js';
import { criarSessao, encerrarSessao } from '../sessoes.js';
import {
  gravarCookieSessao, apagarCookieSessao, exigirLoginApi, exigirCodigoCsrf,
  ipBloqueado, registrarErroDeLogin, limparErrosDeLogin,
} from '../seguranca.js';

const rotas = Router();

rotas.post('/entrar', async (req, res) => {
  const ip = req.ip;
  if (ipBloqueado(ip)) {
    console.log(`[painel] login bloqueado por excesso de tentativas deste computador (${ip})`);
    return res.status(429).json({ erro: 'muitas_tentativas', mensagem: 'Muitas tentativas erradas deste computador. Espere 15 minutos.' });
  }

  const login = typeof req.body?.login === 'string' ? req.body.login.slice(0, 60) : '';
  const senha = typeof req.body?.senha === 'string' ? req.body.senha : '';
  const resultado = await verificarLogin(login, senha);

  if (!resultado.ok) {
    registrarErroDeLogin(ip);
    console.log(`[painel] login recusado: "${login.replace(/[^\w.-]/g, '?')}" (${ip}) ${resultado.erro}`);
    const status = resultado.erro === 'bloqueado' ? 423 : 401;
    return res.status(status).json({ erro: resultado.erro, mensagem: MENSAGENS_ERRO[resultado.erro] });
  }

  limparErrosDeLogin(ip);
  if (req.tokenSessao) encerrarSessao(req.tokenSessao);
  const token = criarSessao(resultado.usuario.id, { ip, navegador: req.headers['user-agent'] });
  gravarCookieSessao(req, res, token);
  console.log(`[painel] ${resultado.usuario.login} entrou (${ip})`);
  res.json({ ok: true });
});

rotas.post('/sair', exigirLoginApi, exigirCodigoCsrf, (req, res) => {
  encerrarSessao(req.tokenSessao);
  apagarCookieSessao(req, res);
  console.log(`[painel] ${req.sessao.usuario.login} saiu`);
  res.json({ ok: true });
});

rotas.get('/eu', exigirLoginApi, (req, res) => {
  res.json({ usuario: req.sessao.usuario, csrf: req.sessao.csrf });
});

export default rotas;