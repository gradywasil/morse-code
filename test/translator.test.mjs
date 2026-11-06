import test from 'node:test';
import assert from 'node:assert/strict';
import { textToMorse, morseToText } from '../js/translator.js';

test('text becomes dots and dashes: a space between letters, a slash between words', () => {
  const { morse, unknown } = textToMorse('Hello World');
  assert.equal(morse, '.... . .-.. .-.. --- / .-- --- .-. .-.. -..');
  assert.deepEqual(unknown, []);
});

test('characters with no Morse sign are flagged and left unspoken, never turned into noise', () => {
  const { morse, unknown } = textToMorse('A é B');
  assert.equal(morse, '.- / -...');
  assert.deepEqual(unknown, ['é']);
});

test('repeated whitespace is one word gap and edges add nothing', () => {
  assert.equal(textToMorse('  SOS   SOS \n').morse, '... --- ... / ... --- ...');
  assert.equal(textToMorse('').morse, '');
});

test('written Morse reads back to text, round-tripping every letter and digit', () => {
  const all = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789';
  assert.equal(morseToText(textToMorse(all).morse).text, all);
});

test('the reader accepts what phone keyboards and chats produce', () => {
  assert.equal(morseToText('·−·· ·−−·').text, 'LP'); // typographic dot/dash
  assert.equal(morseToText('._.. .__.').text, 'LP'); // underscore dashes
  assert.equal(morseToText('... --- ... | ... --- ...').text, 'SOS SOS');
  assert.equal(morseToText('... --- ...   ... --- ...').text, 'SOS SOS'); // 3+ spaces
  assert.equal(morseToText('... --- ...\n... --- ...').text, 'SOS SOS'); // new line
  assert.equal(morseToText('/ ... / ').text, 'S'); // stray separators
});

test('unreadable signs show as ? and are reported, so a typo is visible', () => {
  const result = morseToText('.... ......... .. HI');
  assert.equal(result.text, 'H?I?');
  assert.deepEqual(result.unknown, ['.........', 'HI']);
  assert.equal(result.items[1].known, false);
});

test('both directions describe the same letters, so the breakdown reads the same either way', () => {
  const fromText = textToMorse('SOS').items;
  const fromMorse = morseToText('... --- ...').items;
  assert.deepEqual(fromText, fromMorse);
  assert.deepEqual(fromText[0], { char: 'S', code: '...', known: true });
});

test('absurdly long input is clipped instead of freezing the page', () => {
  const huge = 'E '.repeat(20000);
  assert.ok(textToMorse(huge).items.length <= 5000);
});
