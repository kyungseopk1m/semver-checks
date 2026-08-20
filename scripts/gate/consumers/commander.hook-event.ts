// Probe for commander 9.3.0 -> 9.4.0. The exported `HookEvent` union gained
// `preSubcommand`. Passing a member of it to `hook()` is a parameter position and
// keeps compiling; a lookup table keyed by the union, or an exhaustive switch, is
// the position that stops. The main consumer only ever passes one in.
import { Command, HookEvent } from 'commander';

const hookLabels: Record<HookEvent, string> = {
  preAction: 'running action',
  postAction: 'finished action',
};

const program = new Command();
const event: HookEvent = 'preAction';
program.hook(event, () => {
  void hookLabels[event];
});

export { program, hookLabels };
