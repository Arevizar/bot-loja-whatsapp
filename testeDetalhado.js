import https from 'https';

function requisicaoDetalhada(url) {
  return new Promise((resolve, reject) => {
    const opcoes = {
      headers: {
        'User-Agent': 'BotLojaWhatsApp/1.0 (uso interno para calculo de frete)',
      },
      timeout: 15000,
    };

    const req = https.get(url, opcoes, (res) => {
      let dados = '';
      res.on('data', (chunk) => (dados += chunk));
      res.on('end', () => {
        resolve({ status: res.statusCode, corpo: dados });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });

    req.on('error', reject);
  });
}

async function testar(enderecoTexto) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(enderecoTexto)}`;
  console.log('🔍 Testando:', enderecoTexto);
  console.log('URL completa:', url);

  try {
    const resultado = await requisicaoDetalhada(url);
    console.log('Status HTTP:', resultado.status);
    console.log('Resposta bruta:', resultado.corpo);
  } catch (erro) {
    console.log('Erro:', erro.message);
  }
  console.log('---\n');
}

await testar('Rua Walter Schimidt, 241, Parque dos Jacarandás, Campinas, SP, Brasil');
await testar('Rua Walter Schimidt, Campinas');
await testar('Campinas, SP, Brasil');