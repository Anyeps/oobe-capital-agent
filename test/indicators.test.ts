/** Unit tests for indicators (node:test, no dependencies). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { sma, rsi, atr } from '../dist/indicators.js';

test('sma: averages the last N closes', () => {
  const closes = [10, 12, 14, 16, 18];
  assert.equal(sma(closes, 3, 4), 16);
  assert.equal(sma(closes, 5, 4), 14);
  assert.equal(sma(closes, 3, 1), null);
});

test('rsi: 100 on an all-up window, 0 on an all-down window', () => {
  const up = [10, 11, 12, 13, 14, 15];
  assert.equal(rsi(up, 5, 5), 100);
  const down = [15, 14, 13, 12, 11, 10];
  assert.equal(rsi(down, 5, 5), 0);
  const flat = [10, 10, 10, 10, 10, 10];
  assert.equal(rsi(flat, 5, 5), 100); // no losses -> 100 by definition
});

test('rsi: mixed window lands between 0 and 100', () => {
  const closes = [44, 45, 46, 45, 44, 46, 48, 47, 49, 50, 49, 51, 52, 53, 54];
  const v = rsi(closes, 14, 14);
  assert.ok(v !== null && v > 50 && v < 100, `rsi=${v}`);
});

test('atr: positive and tracks range', () => {
  const high = [10, 12, 13];
  const low = [9, 10, 11];
  const close = [9.5, 11, 12];
  const v = atr(high, low, close, 2, 2);
  assert.ok(v !== null && v > 0, `atr=${v}`);
  assert.equal(atr(high, low, close, 5, 2), null);
});
