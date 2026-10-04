// Allocates until the worker's heap limit ends it.
const hoard = [];
for (;;) hoard.push(new Array(1e5).fill(Math.random()));
