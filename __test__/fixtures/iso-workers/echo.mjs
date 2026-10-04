import { parentPort, workerData } from 'worker_threads';
parentPort.postMessage(workerData);
