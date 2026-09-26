console.log('Testando conexão do Node.js...\n');

try {
  const r1 = await fetch('https://api.github.com');
  console.log('✅ api.github.com: funcionou! Status:', r1.status);
} catch (e) {
  console.log('❌ api.github.com: falhou -', e.cause?.code || e.message);
}

try {
  const r2 = await fetch('https://nominatim.openstreetmap.org/search?format=json&q=Campinas');
  console.log('✅ nominatim.openstreetmap.org: funcionou! Status:', r2.status);
} catch (e) {
  console.log('❌ nominatim.openstreetmap.org: falhou -', e.cause?.code || e.message);
}