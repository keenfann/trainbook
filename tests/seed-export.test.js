import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('scripts seed export fixture', () => {
  it('is parseable and exposes expected top-level fields', () => {
    const filePath = path.resolve(process.cwd(), 'scripts', 'seed-export.json');
    const raw = fs.readFileSync(filePath, 'utf8');
    const payload = JSON.parse(raw);

    expect(payload.version).toBe(8);
    expect(payload.exportedAt).toBeTypeOf('string');
    expect(payload.user).toBeTypeOf('object');
    expect(Array.isArray(payload.exercises)).toBe(true);
    expect(Array.isArray(payload.routines)).toBe(true);
    expect(Array.isArray(payload.sessions)).toBe(true);
    expect(Array.isArray(payload.weights)).toBe(true);
    expect(payload.exercises.length).toBeGreaterThanOrEqual(1);
    expect(payload.routines.length).toBeGreaterThanOrEqual(1);
    expect(payload.sessions.length).toBeGreaterThanOrEqual(1);
    expect(payload.routines[0]?.routineType).toBeTypeOf('string');
    expect(payload.sessions[0]?.routineType).toBeTypeOf('string');
  });
});
