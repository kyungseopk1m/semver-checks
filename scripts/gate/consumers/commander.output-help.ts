// Probe for commander 14.0.1 -> 14.0.2, where the `cb` parameter of
// `Command#outputHelp()` and `Command#help()` stopped being optional. The
// no-argument call is the documented, ordinary usage of both, and it is what a
// newly-required parameter would break.
//
// Both methods are overloaded: the `cb` form is the deprecated one, and a
// `(context?: HelpContext)` overload sits ahead of it. So the zero-argument call
// still resolves. This probe records that.
import { Command } from 'commander';

const program = new Command();

export function showHelp(): void {
  program.outputHelp();
}

export function showHelpWithFormatter(): void {
  program.outputHelp((str) => str.toUpperCase());
}

export function exitWithHelp(): void {
  program.help();
}
