
const ACTIONS = [
  'create_batch',
  'confirm_pickup',
  'start_transit',
  'confirm_reception',
  'confirm_valorization'
];

const ROLES = [
  'company',
  'carrier',
  'carrier',
  'plant',
  'plant'
];

export function prepareTrackingDemo(data) {
  if (
    data?.source !== 'synthetic_local_demo' ||
    data.verifiedOnStellar !== false ||
    !Array.isArray(data.events) ||
    data.events.length !== 5
  ) {
    throw new Error('Datos de demostración no válidos');
  }

  const masses = [
    data.massesKg.declared,
    data.massesKg.pickedUp,
    data.massesKg.received,
    data.massesKg.valorized
  ];

  if (
    masses.some(value => !Number.isFinite(value) || value < 0) ||
    masses[0] < masses[1] ||
    masses[1] < masses[2] ||
    masses[2] < masses[3]
  ) {
    throw new Error('Mediciones de masa no válidas');
  }

  data.events.forEach((event, index) => {
    if (
      event.action !== ACTIONS[index] ||
      event.role !== ROLES[index] ||
      event.synthetic !== true
    ) {
      throw new Error(`Evento sintético inválido: ${index + 1}`);
    }
  });

  return Object.freeze({
    batchId: data.batch.id,
    source: data.source,
    verifiedOnStellar: false,
    participants: data.participants,
    massesKg: Object.freeze([...masses]),
    events: Object.freeze(
      data.events.map(event => Object.freeze({ ...event }))
    )
  });
}
