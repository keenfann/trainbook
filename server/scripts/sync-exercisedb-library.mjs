#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outputPath = path.resolve(__dirname, '..', 'resources', 'exercisedb-library.json');

const candidates = [
  {
    provider: 'keenfann/free-exercise-db',
    url: 'https://raw.githubusercontent.com/keenfann/free-exercise-db/main/dist/exercises.json',
  },
  {
    provider: 'yuhonas/free-exercise-db',
    url: 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json',
  },
];

const normalizeExercise = (item) => ({
  id: typeof item?.id === 'string' ? item.id : '',
  name: typeof item?.name === 'string' ? item.name : '',
  force: item?.force ?? null,
  level: item?.level ?? null,
  mechanic: item?.mechanic ?? null,
  equipment: item?.equipment ?? null,
  primaryMuscles: Array.isArray(item?.primaryMuscles) ? item.primaryMuscles : [],
  secondaryMuscles: Array.isArray(item?.secondaryMuscles) ? item.secondaryMuscles : [],
  instructions: Array.isArray(item?.instructions) ? item.instructions : [],
  category: item?.category ?? null,
  images: Array.isArray(item?.images) ? item.images : [],
});

async function fetchCandidate(candidate) {
  const response = await fetch(candidate.url);
  if (!response.ok) {
    throw new Error(`${candidate.provider}: ${response.status}`);
  }
  const payload = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error(`${candidate.provider}: expected array payload`);
  }
  return {
    provider: candidate.provider,
    etag: response.headers.get('etag') || null,
    exercises: payload
      .map(normalizeExercise)
      .filter((item) => item.id && item.name)
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

async function main() {
  let selected = null;
  let fallbackProvider = null;
  for (const candidate of candidates) {
    try {
      selected = await fetchCandidate(candidate);
      break;
    } catch (error) {
      fallbackProvider = candidate.provider;
      console.warn(`Skipping ${candidate.provider}: ${error.message}`);
    }
  }
  if (!selected) {
    throw new Error('No valid library source found.');
  }
  const payload = {
    source: {
      provider: selected.provider,
      fallbackProvider,
      etag: selected.etag,
      generatedAt: new Date().toISOString(),
    },
    count: selected.exercises.length,
    exercises: selected.exercises,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Wrote ${selected.exercises.length} exercises to ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
