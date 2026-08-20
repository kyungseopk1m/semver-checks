// Transcribed from dayjs's documented quickstart plus the plugins it ships.
// dayjs declares its surface the legacy way: `export =` over a namespace, and
// each plugin reopens `declare module 'dayjs'` to add to the same interface.
// Calling the added members is what forces those ambient blocks to be read.
import dayjs from 'dayjs';
import type { Dayjs, ConfigType, OpUnitType, ManipulateType, QUnitType, PluginFunc } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import duration from 'dayjs/plugin/duration';
import relativeTime from 'dayjs/plugin/relativeTime';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import advancedFormat from 'dayjs/plugin/advancedFormat';
import isBetween from 'dayjs/plugin/isBetween';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter';
import weekOfYear from 'dayjs/plugin/weekOfYear';
import quarterOfYear from 'dayjs/plugin/quarterOfYear';
import minMax from 'dayjs/plugin/minMax';
import localeData from 'dayjs/plugin/localeData';
import isLeapYear from 'dayjs/plugin/isLeapYear';
import type { Duration } from 'dayjs/plugin/duration';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(duration);
dayjs.extend(relativeTime);
dayjs.extend(customParseFormat);
dayjs.extend(advancedFormat);
dayjs.extend(isBetween);
dayjs.extend(isSameOrBefore);
dayjs.extend(isSameOrAfter);
dayjs.extend(weekOfYear);
dayjs.extend(quarterOfYear);
dayjs.extend(minMax);
dayjs.extend(localeData);
dayjs.extend(isLeapYear);

const now: Dayjs = dayjs();
const parsed: Dayjs = dayjs('2026-08-19T12:00:00Z');
const fromFormat: Dayjs = dayjs('19/08/2026', 'DD/MM/YYYY', true);

// Core surface, declared inside `declare namespace dayjs`.
const iso: string = now.toISOString();
const formatted: string = now.format('YYYY-MM-DD HH:mm:ss');
const added: Dayjs = now.add(3, 'day' satisfies ManipulateType);
const started: Dayjs = now.startOf('month' satisfies OpUnitType);
const diffed: number = added.diff(now, 'hour');
const unix: number = now.unix();
const valid: boolean = now.isValid();
const before: boolean = parsed.isBefore(now, 'day');
const cloned: Dayjs = now.clone();

// Members that only exist because a plugin reopened the interface.
const asUtc: Dayjs = now.utc();
const backToLocal: Dayjs = asUtc.local();
const isUtc: boolean = asUtc.isUTC();
const offset: Dayjs = now.utcOffset(540);
const zoned: Dayjs = now.tz('Asia/Seoul');
const guessed: string = dayjs.tz.guess();
const relative: string = now.from(parsed);
const toNow: string = now.toNow();
const ordinal: string = now.format('Do [of] MMMM');
const between: boolean = now.isBetween(parsed, added);
const sameOrBefore: boolean = parsed.isSameOrBefore(now);
const sameOrAfter: boolean = added.isSameOrAfter(now);
const week: number = now.week();
const quarter: number = now.quarter();
const leap: boolean = now.isLeapYear();
const months: string[] = now.localeData().months();
const latest: Dayjs = dayjs.max([now, parsed, added]) ?? now;
const earliest: Dayjs = dayjs.min([now, parsed, added]) ?? now;

// A plugin whose own namespace carries types alongside the module block.
const span: Duration = dayjs.duration(90, 'minutes');
const humanized: string = span.humanize(true);
const asHours: number = span.asHours();
const composed: Duration = dayjs.duration({ hours: 2, minutes: 30 });

// PluginFunc is the extension point's own generic, so it is written out here
// rather than left to inference.
const noopPlugin: PluginFunc<{ label: string }> = (option, Klass, factory) => {
  void option?.label;
  void Klass.prototype;
  void factory.isDayjs;
};
dayjs.extend<{ label: string }>(noopPlugin, { label: 'noop' });

function accepts(input: ConfigType, unit: OpUnitType): boolean {
  return dayjs(input).isSame(now, unit);
}

function span2(input: ConfigType, unit: QUnitType | OpUnitType): number {
  return dayjs(input).diff(now, unit);
}

export {
  now,
  parsed,
  fromFormat,
  iso,
  formatted,
  added,
  started,
  diffed,
  unix,
  valid,
  before,
  cloned,
  asUtc,
  backToLocal,
  isUtc,
  offset,
  zoned,
  guessed,
  relative,
  toNow,
  ordinal,
  between,
  sameOrBefore,
  sameOrAfter,
  week,
  quarter,
  leap,
  months,
  latest,
  earliest,
  span,
  humanized,
  asHours,
  composed,
  accepts,
  span2,
};
