import { Store, useStore, shallow } from '@tanstack/react-store';
import type { NoInfer } from '@tanstack/react-store';

// 0.9.0 dropped the one-argument `useStore(store)` form (selector became
// required) and stopped re-exporting `NoInfer` - a real break shipped in a
// minor bump, so both are exercised deliberately.
const store = new Store({ count: 0, label: 'x' });

const whole = useStore(store);
const count = useStore(store, (s) => s.count);

type Pinned = NoInfer<{ count: number }>;
const pinned: Pinned = { count: 1 };

store.setState((s) => ({ ...s, count: s.count + 1 }));

const same = shallow({ a: 1 }, { a: 1 });

export { whole, count, pinned, same };
