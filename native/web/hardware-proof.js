import { registerPlugin } from './capacitor.js';

const hardware = registerPlugin('HardwareProof');
const button = document.querySelector('#hardware');
button.addEventListener('click', async () => {
  button.disabled = true;
  try {
    await hardware.open();
    document.querySelector('#result').textContent = 'Native hardware test opened.';
  } catch (error) {
    document.querySelector('#result').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
