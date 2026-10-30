const form = document.getElementById('form-entrar');
const mensagem = document.getElementById('mensagem');
const botao = form.querySelector('button[type="submit"]');

function mostrarErro(texto) {
  mensagem.textContent = texto;
  mensagem.hidden = false;
}

form.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const login = form.login.value.trim();
  const senha = form.senha.value;

  if (!login || !senha) {
    mostrarErro('Preencha o login e a senha.');
    (login ? form.senha : form.login).focus();
    return;
  }

  mensagem.hidden = true;
  botao.disabled = true;
  botao.textContent = 'Entrando…';

  try {
    const resposta = await fetch('/api/entrar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ login, senha }),
    });
    if (resposta.ok) {
      window.location.replace('/');
      return;
    }
    const dados = await resposta.json().catch(() => ({}));
    mostrarErro(dados.mensagem || 'Não foi possível entrar. Tente de novo.');
    form.senha.value = '';
    form.senha.focus();
  } catch {
    mostrarErro('Sem conexão com o painel. Confira se ele está ligado no computador da loja.');
  } finally {
    botao.disabled = false;
    botao.textContent = 'Entrar';
  }
});