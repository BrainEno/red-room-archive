// Route adapter only — logic lives in src/server/http/endpoints.
// PUT is kept as an alias of PATCH (both are partial updates).
export { readSettings as GET, writeSettings as PATCH, writeSettings as PUT } from '../../server/http/endpoints/admin.ts';
