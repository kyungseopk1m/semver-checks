import { parentPort, workerData } from 'worker_threads';
import { extractFromPath } from './ts-morph-backend.js';
import type { ExtractOptions } from './extractor.js';

// One extraction per worker. A throw here surfaces on the parent's Worker as an
// 'error' event carrying the same message, and a heap that runs out ends the
// worker instead of the whole process (see extractor.ts).
const { projectPath, entry } = workerData as ExtractOptions;
parentPort!.postMessage(extractFromPath(projectPath, entry));
