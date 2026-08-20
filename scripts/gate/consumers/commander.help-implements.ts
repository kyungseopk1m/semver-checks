// Probe for commander 9.4.1 -> 9.5.0. `Help` gained `showGlobalOptions` plus two
// methods. A subclass inherits them and keeps compiling, which is why nothing
// caught this; a stand-in that implements `Help` and is returned from the
// documented `createHelp()` override point does not.
import { Argument, Command, Help, Option } from 'commander';

class RecordingHelp implements Help {
  helpWidth?: number;
  sortSubcommands = false;
  sortOptions = false;
  readonly calls: string[] = [];

  subcommandTerm(cmd: Command): string { return cmd.name(); }
  subcommandDescription(cmd: Command): string { return cmd.description(); }
  optionTerm(option: Option): string { return option.flags; }
  optionDescription(option: Option): string { return option.description; }
  argumentTerm(argument: Argument): string { return argument.name(); }
  argumentDescription(argument: Argument): string { return argument.description; }
  commandUsage(cmd: Command): string { return cmd.usage(); }
  commandDescription(cmd: Command): string { return cmd.description(); }
  visibleCommands(_cmd: Command): Command[] { return []; }
  visibleOptions(_cmd: Command): Option[] { return []; }
  visibleArguments(_cmd: Command): Argument[] { return []; }
  longestSubcommandTermLength(_cmd: Command, _helper: Help): number { return 0; }
  longestOptionTermLength(_cmd: Command, _helper: Help): number { return 0; }
  longestArgumentTermLength(_cmd: Command, _helper: Help): number { return 0; }
  padWidth(_cmd: Command, _helper: Help): number { return 0; }
  wrap(str: string, _width: number, _indent: number, _minColumnWidth?: number): string { return str; }
  formatHelp(_cmd: Command, _helper: Help): string { return this.calls.join(','); }
}

class MyCommand extends Command {
  createHelp(): Help { return new RecordingHelp(); }
}

const program = new MyCommand();
program.option('-c, --cheese <type>', 'cheese type');

export { RecordingHelp, MyCommand, program };
