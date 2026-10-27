// Route adapter only — logic lives in src/server/http/endpoints.
export {
  readMoreDocument as GET,
  writeMoreDocument as PUT,
  resetMoreDocument as DELETE,
} from '../../../server/http/endpoints/more.ts';
