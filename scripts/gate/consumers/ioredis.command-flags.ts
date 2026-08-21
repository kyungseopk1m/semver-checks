import { Command } from "ioredis";

// A diagnostics helper: label every command-flag bucket ioredis exposes,
// and report which buckets a given command name falls into.
type FlagName = keyof typeof Command.FLAGS;

const FLAG_LABELS: Record<FlagName, string> = {
  VALID_IN_SUBSCRIBER_MODE: "allowed while subscribed",
  VALID_IN_MONITOR_MODE: "allowed while monitoring",
  ENTER_SUBSCRIBER_MODE: "enters subscriber mode",
  EXIT_SUBSCRIBER_MODE: "exits subscriber mode",
  WILL_DISCONNECT: "closes the connection",
};

export function describe(commandName: string): string[] {
  return (Object.keys(FLAG_LABELS) as FlagName[])
    .filter((flag) =>
      Command.FLAGS[flag].some((c: string) => c === commandName)
    )
    .map((flag) => FLAG_LABELS[flag]);
}
