// Transcribed from pino's documented quickstart: create a logger with options,
// log at the standard levels, bind child context, and read the level back.
import pino from 'pino';
import type { Logger, LoggerOptions, DestinationStream } from 'pino';

const options: LoggerOptions = {
  level: 'info',
  name: 'app',
  redact: ['password'],
  formatters: {
    level: (label: string) => ({ level: label }),
  },
};

const logger: Logger = pino(options);

logger.info('hello');
logger.info({ requestId: '1' }, 'with context');
logger.warn('careful');
logger.error(new Error('boom'), 'failed');
logger.debug('verbose');

const child: Logger = logger.child({ module: 'db' });
child.info('from child');

const level: string = logger.level;
const enabled: boolean = logger.isLevelEnabled('info');

const destination: DestinationStream = pino.destination('/dev/null');
const toFile = pino(options, destination);
toFile.info('to file');

export { logger, child, level, enabled };
