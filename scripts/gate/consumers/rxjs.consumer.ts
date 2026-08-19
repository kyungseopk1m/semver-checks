import { Observable, Subject, Subscriber, of, from, interval } from 'rxjs';
import { map, filter, take, mergeMap, catchError } from 'rxjs/operators';

// `next(value?: T)` became `next(value: T)` in 7.8.2 - a real break shipped in a
// published patch. A `void` subscriber would dodge it (an omitted `void` argument
// is still legal), so the stream carries a value type that can be undefined,
// which is how a consumer ends up calling `next()` bare.
const optional = new Subscriber<number | undefined>();
optional.next();
optional.complete();

const sub = new Subscriber<void>();
sub.next();
sub.complete();

const custom = new Observable<number>((observer) => {
  observer.next(1);
  observer.complete();
  return () => {};
});

const subject = new Subject<string>();
subject.next('a');
subject.subscribe((v) => console.log(v));

of(1, 2, 3)
  .pipe(
    map((n) => n * 2),
    filter((n) => n > 2),
    take(2),
    mergeMap((n) => from([n])),
    catchError(() => of(0)),
  )
  .subscribe({ next: (n) => console.log(n), error: () => {}, complete: () => {} });

interval(1000).pipe(take(1)).subscribe();

export { custom, subject };
