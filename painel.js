import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import { inicializarEstoque } from './database/estoque.js';
import { listarUsuarios } from './database/usuarios.js';
import { limparSessoesVencidas } from './painel/sessoes.js';
import {
  cabecalhosDeSeguranca, exigirEnderecoConhecido, carregarSessao,
  exigirLoginPagina, exigirLoginApi, exigirMesmaOrigem,
} from './painel/seguranca.js';
import rotasConta from './painel/rotas/conta.js';
import rotasDados from './painel/rotas/dados.js';

const PORTA = Number(process.env.PAINEL_PORTA) || 3000;
const ENDERECO = '127.0.0.1';
const DOMINIO_PUBLICO = String(process.env.PAINEL_DOMINIO ?? '')
  .trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
const PASTA_PUBLICA = path.join(path.dirname(fileURLToPath(import.meta.url)), 'painel', 'public');

inicializarEstoque();
limparSessoesVencidas();
setInterval(limparSessoesVencidas, 60 * 60 * 1000).unref();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');

app.use(exigirEnderecoConhecido([`localhost:${PORTA}`, `127.0.0.1:${PORTA}`, DOMINIO_PUBLICO].filter(Boolean)));
app.use(cabecalhosDeSeguranca);
app.use(express.json({ limit: '10kb' }));
app.use(carregarSessao);

app.use('/static', express.static(PASTA_PUBLICA, { index: false, maxAge: '1h' }));

const enviarPagina = (arquivo) => (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(PASTA_PUBLICA, arquivo));
};
app.get('/entrar', (req, res, next) => (req.sessao ? res.redirect(303, '/') : next()), enviarPagina('entrar.html'));
app.get('/', exigirLoginPagina, enviarPagina('index.html'));

app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use('/api', exigirMesmaOrigem);
app.use('/api', rotasConta);
app.use('/api', exigirLoginApi, rotasDados);
app.use('/api', (req, res) => res.status(404).json({ mensagem: 'Não encontrado.' }));

app.use((req, res) => res.status(404).type('text/plain').send('Página não encontrada.'));

app.use((erro, req, res, next) => {
  if (erro.type === 'entity.parse.failed' || erro.type === 'entity.too.large') {
    return res.status(400).json({ mensagem: 'Envio inválido.' });
  }
  console.error('[painel] erro inesperado:', erro);
  res.status(500).json({ mensagem: 'Deu um erro inesperado. Tente de novo.' });
});

const servidor = app.listen(PORTA, ENDERECO, () => {
  console.log(`\n✅ Painel ligado: abra http://localhost:${PORTA} no navegador deste computador.`);
  const contas = listarUsuarios().filter(u => u.ativo);
  if (!contas.length) {
    console.log('⚠️  Ainda não existe nenhuma conta. Crie uma (em outro terminal, nesta pasta):');
    console.log('   node scripts/usuarios.js criar <login> "<Nome>"');
  } else {
    console.log(`   Contas ativas: ${contas.map(u => u.login).join(', ')}`);
  }
  console.log('   Pra desligar: Ctrl + C\n');
  ligarLinkPublico();
});

async function ligarLinkPublico() {
  if (!DOMINIO_PUBLICO || !process.env.NGROK_AUTHTOKEN) {
    if (DOMINIO_PUBLICO || process.env.NGROK_AUTHTOKEN) console.warn('⚠️  Pro link público funcionar, coloque PAINEL_DOMINIO e NGROK_AUTHTOKEN no .env.');
    return;
  }
  try {
    const { default: ngrok } = await import('@ngrok/ngrok');
    const link = await ngrok.forward({ addr: `127.0.0.1:${PORTA}`, authtoken_from_env: true, domain: DOMINIO_PUBLICO });
    console.log(`🌍 Painel aberto na internet: ${link.url()}/entrar`);
  } catch (erro) {
    console.error('⚠️  Não consegui ligar o link público do painel (tento de novo em 1 minuto):', erro.message);
    setTimeout(ligarLinkPublico, 60 * 1000).unref();
  }
}

servidor.on('error', (erro) => {
  if (erro.code === 'EADDRINUSE') {
    console.error(`❌ A porta ${PORTA} já está em uso. O painel já está aberto em outro terminal?`);
    console.error('   (Ou escolha outra porta no .env: PAINEL_PORTA=3001)');
  } else {
    console.error('❌ Não consegui ligar o painel:', erro);
  }
  process.exit(1);
});
