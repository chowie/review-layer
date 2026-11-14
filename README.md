# review-layer

Let people review a website by commenting directly on it, then work through
their comments as a to-do list.

- **Reviewers** open the site in review mode, point at a section, heading,
  image or button, or highlight some text, and leave a comment. They don't
  need an account; they type a shared passcode and their name once.
- **Comments become to-dos.** Each one links back to the exact spot it's about,
  scrolled to and highlighted. Anchors survive small edits: if the text changed,
  the item says so instead of pointing at the wrong thing.
- **The site can seed the list** with its own to-dos (for example "review this
  search description"), published as a static `seed.json`.
- **One admin closes items.** Reviewers comment and reply; only the admin
  passcode can mark an item done or reopen it.
- **A CLI** lists, comments on and closes items, so the person (or AI
  assistant) doing the fixes can work from the same list.

Status: **v0.1** is the server side (API, storage, merge, anchor matching) and
the CLI. The in-page overlay and the to-do list page arrive in v0.2.

## Install

```sh
npm install github:chowie/review-layer#v0.1.0
```

No build step: it's plain ES modules (Node 20+, or any runtime with Web
`Request`/`Response`).

## Server

`createHandler` turns a `Request` into a `Response`. Mount it wherever your
host runs functions. A Netlify Function (v2):

```js
// netlify/functions/review.mjs
import { createHandler } from 'review-layer/server';
import { netlifyBlobsStore } from 'review-layer/stores/netlify-blobs';

const handler = createHandler({
  store: netlifyBlobsStore('review-layer'),
  reviewerPasscode: process.env.REVIEW_PASSCODE,
  adminPasscode: process.env.REVIEW_ADMIN_PASSCODE,
  // Turn review off for good, e.g. once the site goes live:
  enabled: process.env.REVIEW !== 'off',
});

export default (req) => handler(req);
export const config = { path: '/api/review/*' };
```

`@netlify/blobs` is an optional peer dependency; install it only if you use
that store. `review-layer/stores/memory` is an in-memory store for tests and
local development. Any object with `get(key)`, `set(key, value)` and
`list(prefix)` works as a store.

### API

All routes need `Authorization: Bearer <passcode>`. The API answers 404 to
everything when `enabled` is false or no reviewer passcode is set.

| Request | Who | Does |
|---|---|---|
| `GET /api/review/session` | reviewer | `{ role }`; also checks a passcode |
| `GET /api/review/items[?page=/x/]` | reviewer | `{ items, comments, statuses }` |
| `POST /api/review/items` | reviewer | `{ page, kind, anchor, body, author, title? }` creates an item and its first comment |
| `POST /api/review/items/:id/comments` | reviewer | `{ author, body }` adds a reply (seed ids allowed) |
| `PATCH /api/review/items/:id` | admin | `{ status: 'open' \| 'done', author?, anchorLost? }` |

Storage keys are `items/<id>`, `comments/<itemId>/<time>-<id>` and
`status/<id>`. Items and comments are written once, so two reviewers posting
at the same moment can't overwrite each other.

## Seeds

A site can publish its own to-dos as JSON (by default at `/review/seed.json`):

```json
[{ "id": "meta-home", "page": "/", "kind": "meta", "title": "Review the Home search description",
   "anchor": { "v": 1, "meta": "description" }, "group": "content" }]
```

Seed ids must be stable, so comments and status stay attached across builds.
`mergeItems` (from `review-layer/merge`) combines seeds with stored items;
a seed the site no longer lists but that has comments comes back with
`orphan: true`, so nothing is lost.

## CLI

```sh
export REVIEW_URL=https://example.com REVIEW_PASSCODE=…   # or REVIEW_ADMIN_PASSCODE
npx review-layer list --open            # [--done] [--page /about/] [--json]
npx review-layer show meta-home
npx review-layer comment meta-home "Fixed in PR #31"
npx review-layer close meta-home        # admin passcode
npx review-layer reopen meta-home       # admin passcode
```

`REVIEW_AUTHOR` sets the name on comments (default "Claude"), `REVIEW_API` the
API path and `REVIEW_SEEDS` the seed path (`none` to skip).

## Anchors

`review-layer/anchor` has the matching logic, with no DOM dependency:
`normalize`, `similarity` (word overlap), `makeQuote`/`findQuote` (a quote with
32 characters of context on each side) and `bestBlock`, which picks the block
an anchor now points at, either exactly or by a fuzzy match at 0.6 or above.

## Development

```sh
npm test
```

## License

MIT
