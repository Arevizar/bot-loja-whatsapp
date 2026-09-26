import https from 'https';

function testarConexao(url, nome) {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: 8000 }, (res) => {
      console.log(`✅ ${nome}: funcionou! Status:`, res.statusCode);
      res.resume();
      resolve();
    });

    req.on('timeout', () => {
      console.log(`❌ ${nome}: timeout`);
      req.destroy();
      resolve();
    });

    req.on('error', (erro) => {
      console.log(`❌ ${nome}: falhou -`, erro.code || erro.message);
      resolve();
    });
  });
}

console.log('Comparando vários sites...\n');
await testarConexao('https://registry.npmjs.org', 'registry.npmjs.org (sabemos que funciona)');
await testarConexao('https://www.google.com', 'google.com');
await testarConexao('https://api.github.com', 'api.github.com');
await testarConexao('https://nominatim.openstreetmap.org', 'nominatim.openstreetmap.org');
await testarConexao('https://www.openstreetmap.org', 'openstreetmap.org (site normal, sem "nominatim")');