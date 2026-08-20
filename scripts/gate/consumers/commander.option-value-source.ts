// Probe for commander 9.4.0 -> 9.4.1, a patch that shipped two type-level breaks.
// `OptionValueSource` gained `implied`, which breaks a table keyed by the union,
// and `getOptionValueSource` started returning `| undefined`, which breaks the
// round trip commander's own API invites: read the source out, hand it back to
// `setOptionValueWithSource`.
import { Command, OptionValueSource } from 'commander';

const sourceLabels: Record<OptionValueSource, string> = {
  default: 'from default',
  config: 'from config file',
  env: 'from environment',
  cli: 'from command line',
};

const program = new Command();
program.option('-c, --cheese <type>', 'cheese type', 'blue');

const source: OptionValueSource = program.getOptionValueSource('cheese');
program.setOptionValueWithSource('cheese', 'gouda', source);

export { program, sourceLabels, source };
