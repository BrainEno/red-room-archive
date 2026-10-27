// Route adapter only — logic lives in src/server/http/endpoints.
// PUT is kept as an alias of PATCH (both are partial updates).
export { read as GET, update as PATCH, update as PUT, remove as DELETE } from '../../../server/http/endpoints/posts.ts';
