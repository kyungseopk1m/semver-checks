import v8 from 'v8';
import { Worker } from 'worker_threads';
import type { ApiSnapshot } from './api-snapshot.js';
import { extractWorkerPath } from './worker-path.js';

export interface ExtractOptions {
  projectPath: string;
  entry?: string | string[];
}

// Extraction runs in a worker thread because a package whose types exhaust the
// V8 heap would otherwise abort the whole process (exit 134), skipping every
// `finally` that removes temp dirs and breaking the 0/1/2 exit contract. A worker
// that runs out of heap is terminated on its own and reported here as an error.
export async function extract(options: ExtractOptions): Promise<ApiSnapshot> {
  return extractAs(options, options.projectPath);
}

/** @internal `extract()` with the name the user knows the source by (`type-fest@4.0.0`, not its temp dir) for errors. */
export async function extractAs(options: ExtractOptions, label: string): Promise<ApiSnapshot> {
  if (!extractWorkerPath) {
    const { extractFromPath } = await import('./ts-morph-backend.js');
    return extractFromPath(options.projectPath, options.entry);
  }
  return runWorker<ApiSnapshot>(extractWorkerPath, { projectPath: options.projectPath, entry: options.entry }, label);
}

// The same heap the main thread was given, so isolation never lowers the
// ceiling a package used to fit under, and `--max-old-space-size` in
// NODE_OPTIONS still moves it.
function mainThreadHeapMb(): number {
  return Math.ceil(v8.getHeapStatistics().heap_size_limit / (1024 * 1024));
}

// A wall-clock limit, so a package whose types send the checker into a loop that
// never grows the heap still ends with an error instead of hanging CI. The
// slowest side measured for 0.15.0 (effect@3.22.2) took 85 s on a heavily loaded
// machine; 10 minutes is about 7 times that. SEMVER_CHECKS_EXTRACT_TIMEOUT
// (seconds) moves it. setTimeout fires at once for anything past 2^31-1 ms, so a
// huge value meant to switch the limit off is capped there instead.
function extractTimeoutMs(): number {
  const seconds = Number(process.env.SEMVER_CHECKS_EXTRACT_TIMEOUT);
  return Math.min(seconds > 0 ? seconds : 600, 2_147_483) * 1000;
}

/** @internal Exported for tests, which pass a small heap or timeout to provoke the failure paths. */
export function runWorker<T>(
  file: string,
  workerData: unknown,
  label: string,
  heapMb = mainThreadHeapMb(),
  timeoutMs = extractTimeoutMs(),
): Promise<T> {
  return new Promise((resolve, reject) => {
    // execArgv: [] because a worker inherits the parent's by default, and some of
    // them refuse a file entry point (`node --input-type=module -e ...` would
    // fail every extraction). The compiled worker needs none of them.
    const worker = new Worker(file, { workerData, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: heapMb } });
    let answered = false;
    let result: T;
    // An answer that already arrived still stands; terminating only cuts the drain short.
    const timer = setTimeout(() => {
      if (!answered)
        reject(
          new Error(
            `extracting '${label}' did not finish within ${timeoutMs / 1000} s, not an answer.\n` +
              `  Raise the limit with SEMVER_CHECKS_EXTRACT_TIMEOUT=<seconds>.`,
          ),
        );
      void worker.terminate();
    }, timeoutMs);
    worker.on('message', (message: T) => {
      answered = true;
      result = message;
    });
    worker.on('error', (err: any) => {
      reject(
        err?.code === 'ERR_WORKER_OUT_OF_MEMORY'
          ? new Error(
              `ran out of memory extracting '${label}' (heap limit about ${heapMb} MB), not an answer.\n` +
                `  Raise the limit with NODE_OPTIONS=--max-old-space-size=<MB>.`,
            )
          : err,
      );
    });
    // Settling on 'exit' rather than 'message' lets the worker's console output
    // (SEMVER_CHECKS_VERBOSE warnings) drain first. After an 'error' the promise
    // is already rejected and this does nothing; the same holds after a timeout.
    worker.on('exit', (code) => {
      clearTimeout(timer);
      if (answered) resolve(result);
      else reject(new Error(`extraction of '${label}' stopped (worker exit code ${code}) before answering`));
    });
  });
}
