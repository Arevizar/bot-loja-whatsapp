// Script só pra testar o cálculo de frete, sem precisar do WhatsApp conectado.
// Rode com: node testarFrete.js
import { calcularFrete } from './database/frete.js';

// Edite esses endereços de teste com endereços reais pra conferir se bate com a distância real
const enderecosParaTestar = [
  'Rua Walter Schimidt, 241, Parque dos Jacarandás, Campinas', // o próprio endereço da loja (deveria dar 0km, frete grátis)
  'Rua Ferreira Penteado, 200, Centro, Campinas', // exemplo mais longe, deve ter frete
  'Avenida Norte Sul, 100, Vila Industrial, Campinas', // outro exemplo pra comparar
];

async function rodarTestes() {
  console.log('Calculando frete para os endereços de teste...\n');

  for (const endereco of enderecosParaTestar) {
    console.log(`📍 Endereço: ${endereco}`);
    const resultado = await calcularFrete(endereco);

    if (!resultado.sucesso) {
      console.log(`   ❌ Não conseguiu localizar (motivo: ${resultado.motivo})\n`);
      continue;
    }

    if (resultado.gratis) {
      console.log(`   ✅ Distância: ${resultado.distanciaKm.toFixed(2)}km — Frete GRÁTIS\n`);
    } else {
      console.log(`   ✅ Distância: ${resultado.distanciaKm.toFixed(2)}km — Frete: R$ ${resultado.valorFrete.toFixed(2)}\n`);
    }
  }
}

rodarTestes();