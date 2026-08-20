// Probe for ky 1.12.0 -> 1.13.0. `NormalizedOptions` gained a required `context`
// property, so an options object built by hand, which is what a hook test or a
// middleware layer does, stops satisfying it.
import type { NormalizedOptions } from 'ky';

const normalized: NormalizedOptions = {
  method: 'get',
  retry: { limit: 2 },
  prefixUrl: 'https://example.com',
  onDownloadProgress: undefined,
  onUploadProgress: undefined,
};

export { normalized };
