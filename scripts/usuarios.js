import readline from 'node:readline';
import {
  criarUsuario, alterarSenha, listarUsuarios, buscarUsuario, definirAtivo, desbloquear,
  validarSenha, normalizarLogin, MENSAGENS_ERRO, PAPEIS,
} from '../database/usuarios.js';

const AJUDA = `
Como usar (na pasta do bot):

  node scripts/usuarios.js criar <login> "<Nome>"   cria uma conta (pede a senha)
  node scripts/usuarios.js senha <login>            troca a senha de uma conta
  node scripts/usuarios.js listar                   mostra as contas
  node scripts/usuarios.js desativar <login>        impede a conta de entrar
  node scripts/usuarios.js ativar <login>           libera a conta de novo
  node scripts/usuarios.js desbloquear <login>      tira o bloqueio por senha errada

Exemplo:  node scripts/usuarios.js criar maria "Maria Silva"
`;

let linhasPendentes = null;
function lerLinhaSemTerminal() {
  if (!linhasPendentes) {
    linhasPendentes = { fila: [], esperando: [], fim: false };
    const rl = readline.createInterface({ input: process.stdin, terminal: false });
    rl.on('line', linha => {
      const quem = linhasPendentes.esperando.shift();
      quem ? quem(linha) : linhasPendentes.fila.push(linha);
    });
    rl.on('close', () => {
      linhasPendentes.fim = true;
      for (const quem of linhasPendentes.esperando.splice(0)) quem(null);
    });
  }
  if (linhasPendentes.fila.length) return Promise.resolve(linhasPendentes.fila.shift());
  if (linhasPendentes.fim) return Promise.resolve(null);
  return new Promise(resolve => linhasPendentes.esperando.push(resolve));
}

function perguntarSenha(pergunta) {
  process.stdout.write(pergunta);

  if (!process.stdin.isTTY) {
    return lerLinhaSemTerminal().then(linha => {
      process.stdout.write('\n');
      return linha;
    });
  }

  return new Promise(resolve => {
    const entrada = process.stdin;
    let senha = '';

    const terminar = (valor) => {
      entrada.removeListener('data', aoDigitar);
      entrada.setRawMode(false);
      entrada.pause();
      process.stdout.write('\n');
      resolve(valor);
    };

    const aoDigitar = (pedaco) => {
      for (const ch of pedaco) {
        if (ch === '\r' || ch === '\n') return terminar(senha);
        if (ch === '\u0003') {
          terminar(null);
          console.log('Cancelado.');
          process.exit(130);
        }
        if (ch === '\u001b') return;
        if (ch === '\u007f' || ch === '\b') {
          if (senha.length) {
            senha = [...senha].slice(0, -1).join('');
            process.stdout.write('\b \b');
          }
          continue;
        }
        if (ch >= ' ') {
          senha += ch;
          process.stdout.write('*');
        }
      }
    };

    entrada.setRawMode(true);
    entrada.setEncoding('utf8');
    entrada.resume();
    entrada.on('data', aoDigitar);
  });
}

async function pedirNovaSenha(login) {
  console.log('Regras: no mínimo 8 caracteres, diferente do login. Quanto mais longa, melhor');
  console.log('(uma frase curta funciona bem, ex: "cafe com pao de queijo").\n');

  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    const senha = await perguntarSenha('Nova senha: ');
    if (senha === null) return null;

    const erro = validarSenha(senha, login);
    if (erro) {
      console.log(`✗ ${MENSAGENS_ERRO[erro]}\n`);
      continue;
    }

    const repetida = await perguntarSenha('Repita a senha: ');
    if (repetida === null) return null;
    if (repetida !== senha) {
      console.log('✗ As duas senhas não são iguais. Vamos de novo.\n');
      continue;
    }
    return senha;
  }
  console.log('Muitas tentativas. Rode o comando de novo.');
  return null;
}

function falhar(mensagem) {
  console.log(`✗ ${mensagem}`);
  process.exitCode = 1;
}

async function comandoCriar(login, nome) {
  if (!login || !nome) return falhar(`Faltou o login ou o nome.\n${AJUDA}`);
  login = normalizarLogin(login);
  if (buscarUsuario(login)) return falhar(MENSAGENS_ERRO.login_existente);

  console.log(`\nCriando a conta "${login}" (${nome}) com ${PAPEIS.total.toLowerCase()}.`);
  const senha = await pedirNovaSenha(login);
  if (!senha) return falhar('Conta não foi criada.');

  const resultado = await criarUsuario({ login, nome, senha });
  if (!resultado.ok) return falhar(MENSAGENS_ERRO[resultado.erro] ?? resultado.erro);
  console.log(`\n✓ Conta "${login}" criada.`);
}

async function comandoSenha(login) {
  if (!login) return falhar(`Faltou o login.\n${AJUDA}`);
  const usuario = buscarUsuario(login);
  if (!usuario) return falhar(MENSAGENS_ERRO.usuario_inexistente);

  console.log(`\nTrocando a senha de "${usuario.login}" (${usuario.nome}).`);
  const senha = await pedirNovaSenha(usuario.login);
  if (!senha) return falhar('A senha não foi trocada.');

  const resultado = await alterarSenha(usuario.login, senha);
  if (!resultado.ok) return falhar(MENSAGENS_ERRO[resultado.erro] ?? resultado.erro);
  console.log(`\n✓ Senha de "${usuario.login}" trocada.`);
}

function comandoListar() {
  const usuarios = listarUsuarios();
  if (!usuarios.length) {
    console.log('Nenhuma conta criada ainda. Use: node scripts/usuarios.js criar <login> "<Nome>"');
    return;
  }
  console.table(usuarios.map(u => ({
    login: u.login,
    nome: u.nome,
    acesso: PAPEIS[u.papel] ?? u.papel,
    situação: !u.ativo ? 'desativada' : u.bloqueado ? `bloqueada até ${u.bloqueado_ate}` : 'ativa',
    'último login': u.ultimo_login_em ?? '—',
  })));
}

function comandoSimples(funcao, login, mensagemOk) {
  if (!login) return falhar(`Faltou o login.\n${AJUDA}`);
  const resultado = funcao(login);
  if (!resultado.ok) return falhar(MENSAGENS_ERRO[resultado.erro] ?? resultado.erro);
  console.log(`✓ ${mensagemOk(normalizarLogin(login))}`);
}

const [comando, ...argumentos] = process.argv.slice(2);

switch (comando) {
  case 'criar':
    await comandoCriar(argumentos[0], argumentos.slice(1).join(' '));
    break;
  case 'senha':
    await comandoSenha(argumentos[0]);
    break;
  case 'listar':
    comandoListar();
    break;
  case 'desativar':
    comandoSimples(l => definirAtivo(l, false), argumentos[0], l => `Conta "${l}" desativada. Ela não consegue mais entrar.`);
    break;
  case 'ativar':
    comandoSimples(l => definirAtivo(l, true), argumentos[0], l => `Conta "${l}" ativada.`);
    break;
  case 'desbloquear':
    comandoSimples(desbloquear, argumentos[0], l => `Conta "${l}" desbloqueada.`);
    break;
  default:
    console.log(AJUDA);
    if (comando && !['ajuda', 'help', '-h', '--help'].includes(comando)) process.exitCode = 1;
}

process.stdin.pause();
if (linhasPendentes) process.stdin.destroy();