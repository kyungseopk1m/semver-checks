// Transcribed from zustand's documented quickstart: create a store with typed
// state and actions, read it with a selector, and use the vanilla store API.
import { create } from 'zustand';
import { createStore } from 'zustand/vanilla';

interface BearState {
  bears: number;
  increase: (by: number) => void;
  reset: () => void;
}

const useBearStore = create<BearState>()((set) => ({
  bears: 0,
  increase: (by) => set((state) => ({ bears: state.bears + by })),
  reset: () => set({ bears: 0 }),
}));

function Component(): number {
  const bears = useBearStore((state) => state.bears);
  const increase = useBearStore((state) => state.increase);
  increase(1);
  return bears;
}

const snapshot: BearState = useBearStore.getState();
const unsubscribe = useBearStore.subscribe((state) => {
  void state.bears;
});
unsubscribe();

const vanilla = createStore<BearState>()((set) => ({
  bears: 0,
  increase: (by) => set((state) => ({ bears: state.bears + by })),
  reset: () => set({ bears: 0 }),
}));
void vanilla.getState().bears;

export { useBearStore, Component, snapshot, vanilla };
