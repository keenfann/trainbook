import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('default exercise seed data', () => {
  it('includes Dumbbell Lateral Raise with routine-ready metadata and image', () => {
    const seedPath = path.resolve(process.cwd(), 'server', 'seed-exercises.json');
    const exercises = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
    const exercise = exercises.find((item) => item.name === 'Dumbbell Lateral Raise');

    expect(exercise).toMatchObject({
      force: 'push',
      level: 'beginner',
      mechanic: 'isolation',
      equipment: 'dumbbell',
      category: 'strength',
      primaryMuscles: ['shoulders'],
      images: ['/exercise-images/dumbbell-lateral-raise.png'],
    });
    expect(exercise.instructions).toHaveLength(4);
    expect(fs.existsSync(path.resolve(process.cwd(), 'public', 'exercise-images', 'dumbbell-lateral-raise.png'))).toBe(
      true
    );
  });
});
