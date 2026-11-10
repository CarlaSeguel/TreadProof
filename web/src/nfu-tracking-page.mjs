import {verifyTrackingEvidence} from './nfu-tracking-evidence.mjs';
import { prepareTrackingDemo } from './nfu-tracking.mjs';
import demoData from './nfu-tracking-demo.json';

const actions = [
  'CreaciÃ³n', 'Retiro', 'Traslado', 'RecepciÃ³n', 'ValorizaciÃ³n'
];

const participants = [
  'company', 'carrier', 'carrier', 'plant', 'plant'
];

async function loadTracking() {
  const demo = prepareTrackingDemo(demoData);
  const formatMass = value =>
    new Intl.NumberFormat('es-CL').format(value) + ' kg';

  document.querySelector('#batch-title').textContent = demo.batchId;

  const participantRows = document.querySelectorAll(
    '#participants .account-details dd'
  );

  ['company', 'carrier', 'plant'].forEach((role, index) => {
    participantRows[index].textContent = demo.participants[role];
  });

  const massRows = document.querySelectorAll(
    '#mass .tracking-masses dd'
  );

  demo.massesKg.forEach((mass, index) => {
    massRows[index].textContent = formatMass(mass);
  });

  const cycleItems = document.querySelectorAll('#cycle ol li');

  demo.events.forEach((event, index) => {
    const participant = demo.participants[participants[index]];
    const measured = event.massKg === null
      ? 'Sin nueva mediciÃ³n'
      : formatMass(event.massKg);

    cycleItems[index].querySelector('p').textContent =
      participant + ' Â· Evento sintÃ©tico';

    cycleItems[index].querySelector('.status').textContent =
      'Simulado Â· ' + measured;
  });

  const history = document.querySelector('#history .tracking-history');
  history.replaceChildren();

  demo.events.forEach((event, index) => {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    const time = document.createElement('time');
    const description = document.createElement('p');
    const reference = document.createElement('code');

    time.dateTime = event.time;
    time.textContent = event.time.slice(11, 16);

    summary.append(
      time,
      ' Â· ' + actions[index] + ' Â· SintÃ©tico'
    );

    description.append(
      demo.participants[event.role] +
      ' Â· ' +
      (event.massKg === null
        ? 'Sin nueva mediciÃ³n'
        : formatMass(event.massKg)) +
      '. Referencia local: '
    );

    reference.textContent = event.id;
    description.append(
      reference,
      '. Sin hash de transacciÃ³n Stellar.'
    );

    details.append(summary, description);
    history.append(details);
  });


  const evidenceRecord = demoData.evidence;
  const evidencePath = './evidence/nfu-demo-d2-001-valorization.txt';

  if (
    evidenceRecord?.file !== evidencePath ||
    !/^[A-Fa-f0-9]{64}$/.test(evidenceRecord.sha256)
  ) {
    throw new Error('Referencia de evidencia invÃ¡lida');
  }

  const evidenceRow = document.querySelector('#evidence-file');
  const evidenceLink = document.createElement('a');
  evidenceLink.href = evidencePath;
  evidenceLink.textContent = 'Ver declaraciÃ³n sintÃ©tica de valorizaciÃ³n';
  evidenceRow.replaceChildren(evidenceLink);

  const evidenceStatus = document.querySelector('#evidence-sha256');
  evidenceStatus.textContent = evidenceRecord.sha256 + ' · Comprobando bytes…';
  try {
    const verified = await verifyTrackingEvidence(evidenceRecord);
    evidenceStatus.textContent = verified.sha256 + ' · SHA-256 verificado sobre ' + verified.byteSize + ' bytes. Documento sintético; sin firma de planta ni anclaje Stellar.';
  } catch {
    evidenceStatus.textContent = 'NO VERIFICADO · No se pudo comprobar la integridad del documento sintético.';
    evidenceLink.removeAttribute('href');
  }

  console.log('TreadProof D2: datos sintÃ©ticos cargados');
}

loadTracking().catch(error => {
  console.error('TreadProof D2:', error);
  const title = document.querySelector('#batch-title');
  if (title) title.textContent = 'Error al cargar datos sintÃ©ticos';
});
