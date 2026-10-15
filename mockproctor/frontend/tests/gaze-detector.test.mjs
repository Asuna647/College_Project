import test from 'node:test';
import assert from 'node:assert/strict';
import { ScreenGazeEventDetector } from '../src/lib/advancedGazeDetection.js';

test('requires sustained high-confidence gaze outside the screen boundary', () => {
  const detector = new ScreenGazeEventDetector({ margin: 0.04, sustainedSeconds: 1.8, minConfidence: 0.78 });
  assert.equal(detector.evaluate({ x: 1.02, y: 0.5, confidence: 0.9 }, 0), null);
  assert.equal(detector.evaluate({ x: 1.06, y: 0.5, confidence: 0.9 }, 100), null);
  assert.equal(detector.evaluate({ x: 1.06, y: 0.5, confidence: 0.9 }, 1000), null);
  assert.equal(detector.evaluate({ x: 1.06, y: 0.5, confidence: 0.9 }, 1900)?.type, 'looking_away');
});

test('ignores low confidence and resets the timer when gaze returns inside', () => {
  const detector = new ScreenGazeEventDetector({ margin: 0.04, sustainedSeconds: 1.8, minConfidence: 0.78 });
  assert.equal(detector.evaluate({ x: 1.2, y: 0.5, confidence: 0.6 }, 0), null);
  assert.equal(detector.evaluate({ x: 1.2, y: 0.5, confidence: 0.9 }, 100), null);
  assert.equal(detector.evaluate({ x: 0.9, y: 0.5, confidence: 0.9 }, 500), null);
  assert.equal(detector.evaluate({ x: 1.2, y: 0.5, confidence: 0.9 }, 600), null);
  assert.equal(detector.evaluate({ x: 1.2, y: 0.5, confidence: 0.9 }, 2500)?.type, 'looking_away');
});
