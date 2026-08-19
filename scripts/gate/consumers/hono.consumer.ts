import { Hono } from 'hono';
import { bearerAuth } from 'hono/bearer-auth';
import { jwt } from 'hono/jwt';
import { jwk } from 'hono/jwk';
import { cache } from 'hono/cache';
import {
  jsx,
  createElement,
  useRef,
  forwardRef,
  createRef,
  useImperativeHandle,
  ErrorBoundary,
  Suspense,
} from 'hono/jsx';

const app = new Hono();

app.use('/api/*', bearerAuth({ token: 'secret-token' }));
app.use('/jwt/*', jwt({ secret: 'secret-key', alg: 'HS256' }));
app.use('/jwk/*', jwk({ jwks_uri: 'https://example.com/.well-known/jwks.json', alg: ['RS256'] }));
app.get('/cached', cache({ cacheName: 'my-cache', cacheControl: 'max-age=3600' }));

app.get('/', (c) => c.text('Hello Hono'));

// jsx runtime calls (no JSX syntax, file stays .ts per spec) — exercises
// jsx()/createElement() `children` param directly, which is the flagged symbol.
const ref = useRef<HTMLDivElement>(null);
const ref2 = createRef<HTMLSpanElement>();

const Inner = forwardRef<HTMLDivElement, { label: string }>((props, fref) => {
  useImperativeHandle(fref!, () => ({} as HTMLDivElement), []);
  return jsx('div', { ref: fref }, props.label) as any;
});

function App() {
  return jsx(
    ErrorBoundary as any,
    { fallback: jsx('div', {}, 'error') },
    jsx(
      Suspense as any,
      { fallback: jsx('div', {}, 'loading') },
      createElement(Inner as any, { label: 'hi' }),
      jsx('div', { ref }, ref2.current?.textContent)
    )
  );
}

export { app, App };
