// Acceptance Test
// Traces to: L2-009, L2-012, L2-014, L2-018, L2-027, L2-030
// Description: Verify dedicated ML Web Worker client (including on-device Qwen2.5-0.5B-Instruct fallback wiring), Chrome Built-in AI fallback adapter, and BLE Heart Rate / Battery GATT payload parsers.

import { TestBed } from '@angular/core/testing';
import { ChromeAiService } from './chrome-ai.service';
import { MlWorkerClient } from './ml-worker.client';
import {
  parseBleBatteryLevel,
  parseBleHeartRateMeasurement,
} from '../wearables/web-bluetooth.adapter';

describe('ML Worker, Chrome AI & BLE GATT Adapters', () => {
  let worker: MlWorkerClient;
  let chromeAi: ChromeAiService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    worker = TestBed.inject(MlWorkerClient);
    chromeAi = TestBed.inject(ChromeAiService);
  });

  it('steps pose estimation and parses Whisper voice commands via MlWorkerClient (L2-009, L2-030)', async () => {
    const pose = await worker.stepPose(8, 12, 'WebGPU');
    expect(pose.completedReps).toBe(9);
    expect(pose.formScorePercent).toBeGreaterThanOrEqual(88);

    expect(await worker.parseVoiceCommand('pause workout')).toBe('pause');
    expect(await worker.parseVoiceCommand('next set please')).toBe('next-set');
  });

  it('generates on-device Coach replies cleanly via ChromeAiService fallback (L2-012, L2-027)', async () => {
    const reply = await chromeAi.promptCoach('Give me a breath prayer before plank holds');
    expect(reply.text.length).toBeGreaterThan(20);
    expect(reply.engine).toContain('Haloop Coach');
  });

  it('returns a non-empty reply and engine label from the Qwen worker path (L2-012, L2-027, L2-030)', async () => {
    const output = await worker.generateCoachReply('Coach me through steady squats');
    expect(output.reply.length).toBeGreaterThan(0);
    expect(output.reflection).toContain('Hebrews 12:1');
    expect(output.engine.length).toBeGreaterThan(0);
  });

  it('reports the worker-reported engine label when falling back from Gemini Nano (L2-012)', async () => {
    const reply = await chromeAi.promptCoach('How should I pace my run today?');
    expect(reply.text.length).toBeGreaterThan(20);
    expect(reply.engine).toMatch(/^Haloop Coach · /);
  });

  it('parses standard BLE 8-bit and 16-bit Heart Rate and Battery characteristics (L2-018)', () => {
    const hr8 = new DataView(new Uint8Array([0x00, 134]).buffer);
    expect(parseBleHeartRateMeasurement(hr8)).toBe(134);

    const hr16 = new DataView(new Uint8Array([0x01, 0x98, 0x00]).buffer);
    expect(parseBleHeartRateMeasurement(hr16)).toBe(152);

    const bat = new DataView(new Uint8Array([88]).buffer);
    expect(parseBleBatteryLevel(bat)).toBe(88);
  });
});
