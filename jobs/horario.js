// Ajuste aqui os horários de funcionamento do pedido.
const HORA_ABERTURA_MINUTOS = 6 * 60 + 30; // 06:30
const HORA_FECHAMENTO_MINUTOS = 18 * 60;   // 18:00

function minutosAgora() {
  const agora = new Date();
  return agora.getHours() * 60 + agora.getMinutes();
}

// Retorna 'aberto', 'antes_da_abertura' ou 'fechado'
export function statusHorario() {
  const minutos = minutosAgora();
  if (minutos < HORA_ABERTURA_MINUTOS) return 'antes_da_abertura';
  if (minutos >= HORA_FECHAMENTO_MINUTOS) return 'fechado';
  return 'aberto';
}

export function dentroDoHorario() {
  return statusHorario() === 'aberto';
}