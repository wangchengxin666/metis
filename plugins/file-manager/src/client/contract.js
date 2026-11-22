/**
 * File manager — Typert wire descriptors.
 *
 * The published DSH build ships no Typert generator, so a plugin cannot emit
 * `typert.host.js` / `typert.remote-client.js` from TypeScript decorators.
 * The gateway still needs the Client half, so this module states it by hand
 * as a contribution handed to `ctx.remote.$mount()`, which installs
 * `remote.fileManager.*` as ordinary methods. The Host half needs no artifact
 * at all: the `fileManager` service marks its methods with the same
 * `@Remote` protocol marker a compiled service carries, and the Gateway
 * derives the endpoints from that marker directly.
 *
 * `SPECS` is therefore the wire contract's single authored source, and its
 * strict schemas validate both the named input and the result the Host sends.
 *
 * The bundle cannot import the protocol package, so the small part of
 * `createTypertRemoteInfo` this plugin uses is reimplemented below, keeping the
 * descriptor shape, the lazy `input()` and the `invoke()` path the Gateway
 * expects.
 */

/** Package name that owns the endpoints. */
export const PACKAGE_NAME = '@metis/file-manager'
/** Namespace both halves bind to. */
export const NAMESPACE = 'fileManager'

/** `readonly { path }`. */
const ackShape = z => z.object({ path: z.string() }).readonly()

/**
 * The wire contract of every endpoint: ordered parameters and result schema.
 * Each entry is a factory over `zod` so both halves build fresh instances.
 */
export const SPECS = {
  list: {
    description: 'List one server directory: its direct children, the parent to offer, and the browsable roots.',
    parameters: [
      { name: 'path', description: 'Absolute directory path.', schema: z => z.string() },
      { name: 'showHidden', description: 'Include dot entries.', schema: z => z.boolean() },
    ],
    result: z => z.object({
      path: z.string(),
      parent: z.string().nullable(),
      roots: z.array(z.string()).readonly(),
      entries: z.array(z.object({
        name: z.string(),
        path: z.string(),
        type: z.enum(['file', 'directory', 'other']),
        size: z.number().int().nonnegative(),
        modified: z.number().nonnegative(),
        mode: z.number().int().nonnegative().optional(),
      }).readonly()).readonly(),
      truncated: z.boolean(),
      unaddressable: z.number().int().nonnegative(),
      hiddenForced: z.boolean(),
    }).readonly(),
  },
  createDirectory: {
    description: 'Create one directory under a parent directory.',
    parameters: [
      { name: 'parent', description: 'Absolute parent directory.', schema: z => z.string() },
      { name: 'name', description: 'New directory name.', schema: z => z.string() },
    ],
    result: ackShape,
  },
  rename: {
    description: 'Rename one file or directory in place.',
    parameters: [
      { name: 'path', description: 'Absolute path to rename.', schema: z => z.string() },
      { name: 'name', description: 'The new base name.', schema: z => z.string() },
    ],
    result: ackShape,
  },
  deleteEntries: {
    description: 'Delete files and directories; a directory is removed together with its contents. Every path is reported.',
    parameters: [
      { name: 'paths', description: 'Absolute paths to delete.', schema: z => z.array(z.string()) },
    ],
    result: z => z.array(z.object({
      path: z.string(),
      ok: z.boolean(),
      error: z.string().optional(),
    }).readonly()).readonly(),
  },
  preview: {
    description: 'Read one file for an inline preview as text, image or PDF bytes, or a binary notice.',
    parameters: [
      { name: 'path', description: 'Absolute file path.', schema: z => z.string() },
    ],
    result: z => z.object({
      path: z.string(),
      kind: z.enum(['text', 'image', 'pdf', 'binary']),
      mediaType: z.string(),
      text: z.string().optional(),
      size: z.number().int().nonnegative(),
      truncated: z.boolean(),
    }).readonly(),
  },
  startPath: {
    description: 'The directory the page opens at when it has no other preference.',
    parameters: [],
    result: z => z.string(),
  },
  chmod: {
    description: 'Change POSIX permission bits on one file or directory.',
    parameters: [
      { name: 'path', description: 'Absolute path to modify.', schema: z => z.string() },
      { name: 'mode', description: 'POSIX permission bits (0..4095 integer).', schema: z => z.number().int().min(0).max(0o7777) },
    ],
    result: z => z.object({
      path: z.string(),
      mode: z.number().int().nonnegative(),
    }).readonly(),
  },
  writeText: {
    description: 'Overwrite an existing text file with UTF-8 content.',
    parameters: [
      { name: 'path', description: 'Absolute file path.', schema: z => z.string() },
      { name: 'content', description: 'Full UTF-8 text content.', schema: z => z.string() },
    ],
    result: z => z.object({
      path: z.string(),
      size: z.number().int().nonnegative(),
      modified: z.number().nonnegative(),
    }).readonly(),
  },
  moveEntries: {
    description: 'Move files or directories into a destination directory.',
    parameters: [
      { name: 'paths', description: 'Absolute source paths to move.', schema: z => z.array(z.string()) },
      { name: 'destinationDir', description: 'Absolute destination directory path.', schema: z => z.string() },
    ],
    result: z => z.array(z.object({
      from: z.string(),
      path: z.string(),
      ok: z.boolean(),
      error: z.string().optional(),
    }).readonly()).readonly(),
  },
  search: {
    description: 'Search recursively inside a directory by entry name or file text content.',
    parameters: [
      { name: 'directory', description: 'Absolute directory path to search.', schema: z => z.string() },
      { name: 'query', description: 'Search substring.', schema: z => z.string() },
      { name: 'mode', description: 'Search by entry name or file text content.', schema: z => z.enum(['name', 'content']) },
      { name: 'showHidden', description: 'Include dotfiles in search results.', schema: z => z.boolean() },
    ],
    result: z => z.object({
      directory: z.string(),
      query: z.string(),
      mode: z.enum(['name', 'content']),
      truncated: z.boolean(),
      entries: z.array(z.object({
        name: z.string(),
        path: z.string(),
        relativePath: z.string(),
        type: z.enum(['file', 'directory', 'other']),
        size: z.number().int().nonnegative(),
        modified: z.number().nonnegative(),
        mode: z.number().int().nonnegative().optional(),
        matchLine: z.number().int().positive().optional(),
        matchText: z.string().optional(),
      }).readonly()).readonly(),
    }).readonly(),
  },
}

/**
 * One strict codec view of a schema factory.
 * @param factory - schema factory over `zod`.
 * @param z - the `zod` runtime.
 * @param typeSymbol - canonical symbol the generator would record.
 * @returns the codec.
 */
function codec(factory, z, typeSymbol) {
  let cached
  return {
    mode: 'strict',
    typeSymbol,
    create: () => (cached ??= factory(z)),
  }
}

/**
 * Build the mountable Client contribution over the same wire contract.
 * @param z - the browser module table's `zod`.
 * @returns the contribution for `ctx.remote.$mount()`.
 */
export function clientContribution(z) {
  const methods = {}
  for (const [method, spec] of Object.entries(SPECS)) {
    const id = `${PACKAGE_NAME}#${NAMESPACE}/${method}`
    methods[`${NAMESPACE}/${method}`] = {
      service: NAMESPACE,
      description: spec.description,
      invocation: { kind: 'direct' },
      parameters: spec.parameters.map(parameter => {
        const symbol = `${id}:${parameter.name}`
        return {
          name: parameter.name,
          wire: parameter.name,
          description: parameter.description,
          source: 'json',
          codec: codec(parameter.schema, z, symbol),
          strictCodec: codec(parameter.schema, z, symbol),
        }
      }),
      cancellation: { parameter: 'signal' },
      result: codec(spec.result, z, `${id}:result`),
      sourceLocation: { file: 'file-manager/src/client/contract.js', line: 1, column: 1 },
    }
  }
  return createRemoteInfo({ package: PACKAGE_NAME, methods }, z)
}

/**
 * Build the lazy descriptor index and the direct client methods.
 * @param spec - package name and per-endpoint method facts.
 * @param z - zod runtime used for named-input parsing.
 * @returns `{ package, descriptors, methods }`.
 */
function createRemoteInfo(spec, z) {
  let index
  return {
    package: spec.package,
    get descriptors() { return resolve().descriptors },
    get methods() { return resolve().methods },
  }

  /**
   * Materialize the descriptor index once.
   * @returns the descriptors and the callable methods.
   */
  function resolve() {
    if (index !== undefined) return index
    const descriptors = []
    const methods = Object.create(null)
    for (const [endpoint, definition] of Object.entries(spec.methods)) {
      const separator = endpoint.indexOf('/')
      const namespace = endpoint.slice(0, separator)
      const method = endpoint.slice(separator + 1)
      const parameters = definition.parameters.map(parameter => ({ ...parameter, wire: parameter.wire ?? parameter.name }))
      const descriptor = {
        ...definition,
        id: `${spec.package}#${endpoint}`,
        namespace,
        method,
        parameters,
      }
      if (definition.invocation.kind === 'direct') {
        let strictInput
        let looseInput
        const direct = Object.assign(descriptor, {
          /**
           * Named-input parser for this endpoint.
           * @param options - strictness; omission keeps undeclared fields.
           * @returns the cached parser view.
           */
          input(options) {
            const strict = options?.strict === true
            return strict ? (strictInput ??= namedInput(parameters, true, z)) : (looseInput ??= namedInput(parameters, false, z))
          },
          /**
           * Call the mounted namespace method with named wire arguments.
           * @param remote - the Client Remote service.
           * @param input - named wire arguments.
           * @param signal - caller-owned cancellation.
           * @returns the namespace method's promise.
           */
          invoke(remote, input, signal) {
            const values = parameters.map(parameter => input[parameter.wire])
            if (definition.cancellation !== undefined) values.push(signal)
            const receiver = remote[namespace]
            return receiver[method](...values)
          },
        })
        methods[endpoint] = direct
      }
      descriptors.push(descriptor)
    }
    index = { descriptors, methods }
    return index
  }
}

/**
 * Strict named-input parser over one endpoint's parameters.
 * @param parameters - ordered wire parameters.
 * @param strict - reject undeclared fields when true.
 * @param z - zod runtime.
 * @returns the cached parser view.
 */
function namedInput(parameters, strict, z) {
  let schema
  return {
    /**
     * Materialize the parser.
     * @returns a zod object schema over the wire fields.
     */
    create() {
      return (schema ??= z.strictObject(Object.fromEntries(parameters.map(parameter => [
        parameter.wire,
        (strict ? parameter.strictCodec : parameter.codec).create(),
      ]))))
    },
  }
}