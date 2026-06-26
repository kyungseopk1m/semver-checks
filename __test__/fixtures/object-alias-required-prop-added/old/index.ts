export type LimitFunction = {
  readonly activeCount: number;
  clearQueue: () => void;
};
