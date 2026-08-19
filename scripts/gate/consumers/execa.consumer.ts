// Transcribed from execa's documented quickstart: the template-tag form, the
// options form, sync execution, piping, and error handling.
import { execa, execaSync, ExecaError } from 'execa';

async function main(): Promise<void> {
  const { stdout } = await execa`echo hello`;
  void stdout.toUpperCase();

  const result = await execa('echo', ['hello'], { cwd: '/tmp', env: { FOO: 'bar' } });
  void result.stdout;
  void result.exitCode;
  void result.command;
  void result.failed;

  const piped = await execa('echo', ['hello']).pipe('cat');
  void piped.stdout;

  const lines = await execa('echo', ['a\nb'], { lines: true });
  void lines.stdout.length;

  try {
    await execa('false');
  } catch (error) {
    if (error instanceof ExecaError) {
      void error.exitCode;
      void error.stderr;
      void error.shortMessage;
    }
  }
}

const sync = execaSync('echo', ['hello']);
void sync.stdout;

export { main, sync };
