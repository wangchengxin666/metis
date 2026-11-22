import assert from 'node:assert/strict'
import {
  CLEAR_ENDPOINT,
  CREATE_ENDPOINT,
  DELETE_ENDPOINT,
  ENV_REFRESH_ENDPOINT,
  EXPORT_ENDPOINT,
  IMPORT_ENDPOINT,
  SEARCH_ENDPOINT,
  SETTINGS_ENDPOINT,
  STATE_ENDPOINT,
  UPDATE_ENDPOINT,
} from '../index.js'

const ENDPOINT_RE = /^\/api\/[a-z0-9-]+(?:\.[a-z0-9-]+)+$/

for (const ep of [
  STATE_ENDPOINT,
  CREATE_ENDPOINT,
  UPDATE_ENDPOINT,
  DELETE_ENDPOINT,
  CLEAR_ENDPOINT,
  SETTINGS_ENDPOINT,
  ENV_REFRESH_ENDPOINT,
  EXPORT_ENDPOINT,
  IMPORT_ENDPOINT,
  SEARCH_ENDPOINT,
]) {
  assert.match(ep, ENDPOINT_RE, `Endpoint ${ep} must follow /api/<plugin>.<action> convention`)
}
console.log('endpoint-names ok')
