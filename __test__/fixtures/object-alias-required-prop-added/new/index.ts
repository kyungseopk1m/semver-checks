export type LimitFunction = {
  readonly activeCount: number;
  concurrency: number;
  clearQueue: () => void;
};
