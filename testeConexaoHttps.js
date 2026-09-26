import https from 'https';

function testarConexao(url, nome) {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: 8000 }, (res) => {
      console.log(`✅ ${nome}: funcionou! Status:`, res.statusCode);
      res.resume();
      resolve();
    });

    req.on('timeout', () => {
      console.log(`❌ ${nome}: deu timeout (não respondeu a tempo)`);
      req.destroy();
      resolve();
    });

    req.on('error', (erro) => {
      console.log(`❌ ${nome}: falhou -`, erro.code || erro.message);
      resolve();
    });
  });
}

console.log('Testando conexão com módulo https clássico...\n');
await testarConexao('https://api.github.com', 'api.github.com');
await testarConexao('https://nominatim.openstreetmap.org/search?format=json&q=Campinas', 'nominatim.openstreetmap.org');