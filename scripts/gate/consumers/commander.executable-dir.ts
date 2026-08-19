// Probe for commander 11.0.0 -> 11.1.0, where `Command#executableDir()` widened its
// return type from `string` to `string | null`. Assigning the result to a `string`
// is the ordinary way to use a getter like this, and it is what a widened return
// breaks.
import { Command } from 'commander';

const program = new Command();
const dir: string = program.executableDir();

export { dir };
