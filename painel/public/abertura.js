const corpo = document.body;
const palco = document.getElementById('palco');
const figura = document.getElementById('marca-figura');
const botaoPular = document.getElementById('pular');
const FIGURA_SRC = '/static/marca/primos-figura.svg';

const PERSPECTIVA = 1000;
const HEROI_PARA = 3300;
const TROCA = 3550;
const NOME = 3700;
const LEGENDA = 4800;
const PRONTO = 5700;

let quadro = 0;
let terminou = false;

const limitar = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const suavizar = (t) => 1 - Math.pow(1 - t, 3);
const sorteio = (a, b) => a + Math.random() * (b - a);

function finalizar() {
  if (terminou) return;
  terminou = true;
  cancelAnimationFrame(quadro);
  palco.replaceChildren();
  corpo.classList.remove('abrindo');
  corpo.classList.add('figura-visivel', 'nome-visivel', 'legenda-visivel', 'pronto');
  setTimeout(() => document.getElementById('login')?.focus({ preventScroll: true }), 500);
}

function criarDancarino(classeExtra = '') {
  const el = document.createElement('div');
  el.className = `dancarino ${classeExtra}`.trim();
  const sombra = document.createElement('div');
  sombra.className = 'sombra';
  const corpoD = document.createElement('div');
  corpoD.className = 'dancarino-corpo';
  const cabeca = new Image();
  cabeca.src = FIGURA_SRC;
  cabeca.alt = '';
  cabeca.className = 'd-cabeca';
  const saia = new Image();
  saia.src = FIGURA_SRC;
  saia.alt = '';
  saia.className = 'd-saia';
  corpoD.append(cabeca, saia);
  el.append(sombra, corpoD);
  palco.append(el);
  return { el, corpoD, saia, sombra };
}

function profundidade(z) {
  const t = limitar((z + 4200) / 4200);
  let opacidade = 0.05 + 0.95 * Math.pow(t, 1.6);
  if (z > 250) opacidade *= limitar(1 - (z - 250) / 450);
  let desfoque = (1 - t) * 2.4;
  if (z > 150) desfoque = Math.max(desfoque, (z - 150) / 90);
  return { opacidade, desfoque: Math.round(desfoque * 2) / 2 };
}

function aplicar(d, x, y, z, opacidade, desfoque, danca, tempo) {
  d.el.style.transform = `translate3d(${x}px, ${y}px, ${z}px)`;
  d.el.style.opacity = opacidade.toFixed(3);
  d.el.style.zIndex = String(Math.round(z + 6000));
  const filtro = desfoque > 0.4 ? `blur(${desfoque}px)` : 'none';
  if (d.ultimoFiltro !== filtro) {
    d.el.style.filter = filtro;
    d.ultimoFiltro = filtro;
  }
  const fase = (tempo / 1000) * d.frequencia * Math.PI * 2 + d.fase;
  const pulo = -Math.abs(Math.sin(fase)) * d.altura * 0.045 * danca;
  const giro = Math.sin(fase / 2) * d.giro * danca;
  d.corpoD.style.transform = `translateY(${pulo}px) rotate(${giro}deg) scaleX(${d.espelho})`;
  d.saia.style.transform = `skewX(${Math.sin(fase + 0.7) * d.saiaGiro * danca}deg)`;
  d.sombra.style.transform = `scaleX(${1 - 0.25 * Math.abs(Math.sin(fase)) * danca})`;
  d.sombra.style.opacity = danca.toFixed(3);
}

function comecar() {
  const alvo = figura.getBoundingClientRect();
  const largura = alvo.width;
  const altura = alvo.height;
  const telaL = window.innerWidth;
  const celular = telaL < 640;

  palco.style.perspective = `${PERSPECTIVA}px`;
  palco.style.perspectiveOrigin = `${alvo.left + largura / 2}px ${alvo.top + altura * 0.3}px`;

  const montar = (d, extras) => {
    Object.assign(d, {
      largura, altura,
      frequencia: sorteio(1.5, 2.3),
      fase: sorteio(0, Math.PI * 2),
      giro: sorteio(2.5, 5),
      saiaGiro: sorteio(8, 14),
      espelho: Math.random() < 0.5 ? -1 : 1,
      ultimoFiltro: '',
      ...extras,
    });
    d.el.style.width = `${largura}px`;
    d.el.style.height = `${altura}px`;
    return d;
  };

  const heroi = montar(criarDancarino('heroi'), { espelho: 1, frequencia: 1.9 });
  const quantos = celular ? 7 : 12;
  const outros = [];
  for (let i = 0; i < quantos; i++) {
    const lado = i % 2 === 0 ? -1 : 1;
    const escala = sorteio(0.8, 1.1);
    outros.push(montar(criarDancarino(), {
      nasce: sorteio(0, 1900),
      some: sorteio(3300, 3900),
      z0: sorteio(-4200, -2700),
      z1: sorteio(700, 900),
      x0: alvo.left + lado * sorteio(telaL * 0.35, telaL * 0.75),
      x1: alvo.left - lado * sorteio(telaL * 0.45, telaL * 0.95),
      escala,
    }));
  }
  for (const d of outros) {
    d.el.style.width = `${largura * d.escala}px`;
    d.el.style.height = `${altura * d.escala}px`;
    d.altura = altura * d.escala;
  }

  let inicio = 0;
  const etapas = new Set();

  function passo(agora) {
    if (terminou) return;
    if (!inicio) inicio = agora;
    const t = agora - inicio;

    for (const d of outros) {
      if (t < d.nasce || d.fora) continue;
      const p = limitar((t - d.nasce) / (d.some - d.nasce));
      if (p >= 1) {
        d.el.remove();
        d.fora = true;
        continue;
      }
      const z = d.z0 + (d.z1 - d.z0) * Math.pow(p, 1.35);
      const x = d.x0 + (d.x1 - d.x0) * p;
      const y = alvo.top + altura - d.altura;
      const { opacidade, desfoque } = profundidade(z);
      const surgir = limitar((t - d.nasce) / 500);
      aplicar(d, x, y, z, opacidade * surgir, desfoque, 1, t);
    }

    if (!heroi.trocado) {
      const p = limitar(t / HEROI_PARA);
      const z = -4400 * (1 - suavizar(p));
      const x = alvo.left + Math.sin(p * Math.PI * 1.5) * largura * 0.35 * (1 - p);
      const danca = 1 - limitar((t - (HEROI_PARA - 700)) / 700);
      const { opacidade, desfoque } = profundidade(z);
      aplicar(heroi, x, alvo.top, z, Math.max(opacidade, p >= 1 ? 1 : 0), p >= 1 ? 0 : desfoque, danca, t);
      if (t >= TROCA) {
        heroi.trocado = true;
        corpo.classList.add('figura-visivel');
        heroi.el.remove();
      }
    }

    if (t >= NOME && !etapas.has('nome')) { etapas.add('nome'); corpo.classList.add('nome-visivel'); }
    if (t >= LEGENDA && !etapas.has('legenda')) { etapas.add('legenda'); corpo.classList.add('legenda-visivel'); }
    if (t >= PRONTO) { finalizar(); return; }

    quadro = requestAnimationFrame(passo);
  }

  quadro = requestAnimationFrame(passo);
}

const TECLAS_PULAR = ['Escape', 'Enter', ' ', 'Tab'];

const larguraInicial = window.innerWidth;
botaoPular.addEventListener('click', finalizar);
window.addEventListener('keydown', (e) => {
  if (terminou || e.ctrlKey || e.altKey || e.metaKey) return;
  if (TECLAS_PULAR.includes(e.key)) {
    e.preventDefault();
    finalizar();
  }
});
window.addEventListener('resize', () => {
  if (!terminou && Math.abs(window.innerWidth - larguraInicial) > 40) finalizar();
});

const carregar = new Image();
carregar.src = FIGURA_SRC;
carregar.decode().catch(() => {}).then(() => requestAnimationFrame(comecar));
