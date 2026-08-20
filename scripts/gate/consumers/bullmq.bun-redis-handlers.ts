// Probe for bullmq 5.80.11 -> 5.80.12. The bun client's handler properties gained
// `| null`. Assigning a handler still checks out, which is why the main consumer
// sees nothing; reading one back to hand to something typed the old way does not.
import type { BunRedisRawClient } from 'bullmq';

type Handler = () => void;

declare const raw: BunRedisRawClient;

const onConnect: Handler | undefined = raw.onconnect;
const onClose: Handler | undefined = raw.onclose;
const onError: Handler | undefined = raw.onerror;

export { onConnect, onClose, onError };
