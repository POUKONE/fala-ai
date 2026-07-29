import { getPostgres } from "./postgres";

export function getDb() {
  return getPostgres();
}
