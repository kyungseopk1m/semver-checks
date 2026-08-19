import { Command, Option, Help } from 'commander';

const program = new Command();

program
  .name('my-cli')
  .option('-p, --port <number>', 'port number')
  .hook('preAction', (thisCommand, actionCommand) => {
    console.log(thisCommand.name(), actionCommand.name());
  })
  .action(() => {});

const opt = new Option('-p, --port <number>', 'port number');
const flags: string = opt.optionFlags;
const desc: string = opt.fullDescription();

class MyHelp extends Help {}
program.configureHelp({ helpWidth: 80 });
program.createHelp = () => new MyHelp();

const src = program.getOptionValueSource('port');
if (src === 'cli') {
  console.log('from cli');
}

program.outputHelp();
program.help();

export { program };
