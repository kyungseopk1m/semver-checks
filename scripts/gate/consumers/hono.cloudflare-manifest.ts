// Probe for hono 4.12.18 -> 4.12.19. `ServeStaticOptions.manifest` went from
// required to optional, so reading it back gains `| undefined`. The type is not
// re-exported from `hono/cloudflare-workers`, so it is recovered from the exported
// function the way a wrapper around `serveStatic` would have to.
//
// Worth noting against the tool's output: this change is not among the findings it
// reports for this pair, so the pair is a detection gap rather than a grading one.
import { serveStatic } from 'hono/cloudflare-workers';

type StaticOptions = Parameters<typeof serveStatic>[0];

export function manifestOf(options: StaticOptions): object | string {
  return options.manifest;
}
